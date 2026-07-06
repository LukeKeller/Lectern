/**
 * Post-sanitize cleanup for captured article HTML. Extraction often leaves the
 * article's own <h1> at the top, duplicating the title the reader chrome
 * already renders. Strip that leading h1 when it fuzzy-matches the document
 * title, and demote any remaining in-content h1s to h2 so the page keeps a
 * single h1 (the chrome title) and the prose heading styles apply. Pure DOM
 * string -> string; returns the input untouched where DOMParser is unavailable
 * (SSR / node tests), mirroring splitBands in FlipReader.
 */

/** Lowercase, strip everything but letters/digits, collapse runs to spaces. */
function comparable(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * True when a heading and the document title are the same article title,
 * tolerating punctuation/case differences and truncation or site suffixes
 * (one contains the other and the shorter side is substantial).
 */
export function titlesMatch(heading: string, title: string): boolean {
	const a = comparable(heading);
	const b = comparable(title);
	if (!a || !b) return false;
	if (a === b) return true;
	const shorter = a.length <= b.length ? a : b;
	const longer = a.length <= b.length ? b : a;
	return shorter.length >= 10 && longer.includes(shorter);
}

/** Characters of rendered text that precede `el` within `root`. */
function textBefore(root: Element, el: Element): number {
	const range = root.ownerDocument.createRange();
	range.setStart(root, 0);
	range.setEndBefore(el);
	return range.toString().trim().length;
}

/**
 * Drop colour-bearing declarations (`color`, `background[-color]`,
 * `-webkit-text-fill-color`) from an inline `style` value, leaving the rest
 * (alignment, etc.) intact. The reader owns text/surface colour — a source's
 * captured inline colours must not override the theme (or a re-skin), which is
 * how a dark-site capture renders as light text on the reader's light ground.
 * Returns the trimmed remainder (possibly empty).
 */
export function stripInlineColors(style: string): string {
	return style
		.split(';')
		.map((d) => d.trim())
		.filter((d) => d && !/^(color|background|background-color|-webkit-text-fill-color)\s*:/i.test(d))
		.join('; ');
}

export function cleanArticleHtml(html: string, title?: string | null): string {
	if (!html || typeof DOMParser === 'undefined') return html;
	const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	const body = doc.body;
	// Strip captured inline colours so the reader's theme/re-skin governs ink and
	// surface — never the source's own (often dark-site) colours.
	for (const el of Array.from(body.querySelectorAll<HTMLElement>('[style]'))) {
		const cleaned = stripInlineColors(el.getAttribute('style') ?? '');
		if (cleaned) el.setAttribute('style', cleaned);
		else el.removeAttribute('style');
	}
	// Strip the leading h1 when it repeats the document title. "Leading" allows
	// a little front matter (a kicker or byline) before it, but not body prose.
	const first = body.querySelector('h1');
	if (
		first &&
		title &&
		textBefore(body, first) < 80 &&
		titlesMatch(first.textContent ?? '', title)
	) {
		first.remove();
	}
	// Demote any remaining in-content h1s — the reader chrome owns the h1.
	for (const h1 of Array.from(body.querySelectorAll('h1'))) {
		const h2 = doc.createElement('h2');
		for (const attr of Array.from(h1.attributes)) h2.setAttribute(attr.name, attr.value);
		while (h1.firstChild) h2.appendChild(h1.firstChild);
		h1.replaceWith(h2);
	}
	return body.innerHTML;
}
