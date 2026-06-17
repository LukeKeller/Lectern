/**
 * Server-side HTML → plain text for TTS synthesis. No DOM: strips script/style,
 * turns block-level boundaries into paragraph breaks (so the chunker can split
 * sensibly), removes remaining tags, decodes common entities, and normalizes
 * whitespace. Good enough to read an article aloud — not a full HTML parser.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(
    /<\/(p|div|section|article|h[1-6]|li|blockquote|figcaption|tr|table|ul|ol|pre|header|footer)>/gi,
    "\n\n",
  );
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v\u00a0]+/g, " ");
  s = s
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

/**
 * A short single-line preview snippet: collapse whitespace, cut at ~`max` chars
 * on a word boundary, append an ellipsis. Returns null when empty.
 */
export function snippet(text: string, max = 280): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * Remove URLs from text destined for speech so the voice doesn't read them out.
 * Strips http(s) links and bare www. hosts, then tidies the leftover spacing and
 * any now-empty parentheses/brackets.
 */
export function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)\]]+/gi, "")
    .replace(/\bwww\.[^\s)\]]+/gi, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}

/**
 * Does this HTML carry any readable text, or is it empty markup like
 * `<p></p><p></p>`? Used to avoid caching/serving bodies that failed to extract.
 */
export function hasReadableText(html: string): boolean {
  return htmlToText(html).length > 0;
}

/** Readable text with anchor (link) content removed — site chrome is mostly links. */
function nonLinkText(html: string): string {
  return htmlToText(html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " "));
}

/**
 * True when a body is essentially a single image (a comic strip, a photo post)
 * carrying little prose — the kind of feed body whose value is the image, not
 * its (near-empty) text.
 */
function isImageDominant(html: string): boolean {
  return /<img\b/i.test(html) && htmlToText(html).length < 280;
}

/**
 * Choose whichever HTML body has more readable text. Lets the content resolver
 * prefer a scraped full article over an excerpt-only feed body, while keeping
 * the feed body for JS-only sources (e.g. Bluesky) whose pages scrape to empty
 * markup. Ties keep `feedBody`.
 *
 * Exception: an image-dominant feed body (e.g. xkcd's comic `<img>`) carries
 * almost no text, so the "more text wins" rule would always pick a chrome-heavy
 * scrape — the site's nav, "Prev/Random/Next", related links and footer — over
 * the actual content. When the scrape is mostly that navigation chrome (its
 * non-link text is short), keep the clean feed image instead.
 */
export function richerHtml(feedBody: string, scraped: string): string {
  if (isImageDominant(feedBody) && nonLinkText(scraped).length < 600) return feedBody;
  return htmlToText(scraped).length > htmlToText(feedBody).length ? scraped : feedBody;
}
