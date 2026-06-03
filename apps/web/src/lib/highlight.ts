/**
 * Client-owned highlight anchoring + rendering. A highlight is stored as a
 * block-relative anchor — a CSS selector for the article's direct child block
 * plus a character offset within that block's text — which survives re-renders
 * and typography changes (unlike absolute offsets or live DOM ranges). The same
 * scheme is used for every source, so the reader both creates and paints
 * highlights itself without depending on a backend's selector format.
 */
import type { Highlight, NewHighlight } from '@lectern/shared';
import { childSelector } from './progress';

const MARK = 'lectern-hl';

/** Character offset within `block` up to a (node, offset) DOM point. */
function offsetWithin(block: Element, node: Node, nodeOffset: number): number {
	const r = document.createRange();
	r.selectNodeContents(block);
	try {
		r.setEnd(node, nodeOffset);
	} catch {
		return 0;
	}
	return r.toString().length;
}

/** The direct child of `article` that contains `node`, with its index. */
function blockOf(article: Element, node: Node): { el: Element; index: number } | null {
	let el: Node | null = node;
	while (el && el.parentNode !== article) el = el.parentNode;
	if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
	const index = Array.prototype.indexOf.call(article.children, el as Element);
	return index < 0 ? null : { el: el as Element, index };
}

/** Serialize a selection Range into a block-relative anchor, or null if invalid. */
export function serializeRange(article: HTMLElement, range: Range): NewHighlight | null {
	const text = range.toString().trim();
	if (range.collapsed || !text) return null;
	const start = blockOf(article, range.startContainer);
	const end = blockOf(article, range.endContainer);
	if (!start || !end) return null;
	return {
		text: range.toString(),
		color: 'yellow',
		note: null,
		startSelector: childSelector(start.index),
		startOffset: offsetWithin(start.el, range.startContainer, range.startOffset),
		endSelector: childSelector(end.index),
		endOffset: offsetWithin(end.el, range.endContainer, range.endOffset)
	};
}

/** Resolve a (selector, char offset) anchor to a concrete (text node, offset). */
function resolvePoint(
	article: Element,
	selector: string,
	offset: number
): { node: Text; offset: number } | null {
	const block = article.querySelector(selector);
	if (!block) return null;
	let remaining = offset;
	let last: Text | null = null;
	const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	let n = walker.nextNode() as Text | null;
	while (n) {
		if (remaining <= n.data.length) return { node: n, offset: remaining };
		remaining -= n.data.length;
		last = n;
		n = walker.nextNode() as Text | null;
	}
	return last ? { node: last, offset: last.data.length } : null;
}

/** Remove all rendered marks, restoring the original text + node structure. */
export function clearHighlights(article: HTMLElement): void {
	for (const m of Array.from(article.querySelectorAll(`mark.${MARK}`))) {
		const parent = m.parentNode;
		if (!parent) continue;
		while (m.firstChild) parent.insertBefore(m.firstChild, m);
		parent.removeChild(m);
		parent.normalize();
	}
}

/** Paint the given highlights as <mark> elements (idempotent — clears first). */
export function renderHighlights(article: HTMLElement, highlights: Highlight[]): void {
	clearHighlights(article);
	for (const h of highlights) {
		const start = resolvePoint(article, h.startSelector, h.startOffset);
		const end = resolvePoint(article, h.endSelector, h.endOffset);
		if (!start || !end) continue;
		const range = document.createRange();
		try {
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
		} catch {
			continue;
		}
		if (range.collapsed) continue;
		wrapRange(range, h);
	}
}

/** Wrap every text-node slice inside `range` with its own <mark>. */
function wrapRange(range: Range, h: Highlight): void {
	const container = range.commonAncestorContainer;
	const root =
		container.nodeType === Node.ELEMENT_NODE
			? (container as Element)
			: container.parentElement;
	if (!root) return;
	const nodes: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (n) =>
			range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
	});
	let n = walker.nextNode() as Text | null;
	while (n) {
		nodes.push(n);
		n = walker.nextNode() as Text | null;
	}
	for (const node of nodes) {
		const r = document.createRange();
		r.selectNodeContents(node);
		if (node === range.startContainer) r.setStart(node, range.startOffset);
		if (node === range.endContainer) r.setEnd(node, range.endOffset);
		if (r.collapsed) continue;
		const mark = document.createElement('mark');
		mark.className = MARK;
		mark.dataset.hl = h.id;
		mark.dataset.color = h.color;
		try {
			r.surroundContents(mark);
		} catch {
			// Slices that straddle element boundaries can't be cleanly wrapped; skip.
		}
	}
}
