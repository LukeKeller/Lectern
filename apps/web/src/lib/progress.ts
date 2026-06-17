/**
 * Reading-progress math, kept DOM-free so it can be unit-tested. The reader
 * component feeds it scroll metrics and a list of candidate anchors (the article's
 * top-level block elements with their offsets) and gets back a 0..1 percent and
 * the selector of the nearest stable element at the top of the viewport.
 */

/** Treat progress at or above this as "finished". Shared so the reader, the
 * list filters, and the BFF's Readeck derivation all agree on one threshold. */
export { FINISHED_THRESHOLD } from '@lectern/shared';
import { FINISHED_THRESHOLD } from '@lectern/shared';

export interface AnchorCandidate {
	/** A selector that re-finds the element on the next visit. */
	selector: string;
	/** The element's top offset relative to the scroll container. */
	top: number;
}

/**
 * Fraction of the article scrolled past, clamped to 0..1. When the content fits
 * entirely in the viewport there is nothing to scroll, so it counts as fully read.
 */
export function computePercent(
	scrollTop: number,
	scrollHeight: number,
	clientHeight: number
): number {
	const max = scrollHeight - clientHeight;
	if (max <= 0) return 1;
	return clamp(scrollTop / max, 0, 1);
}

/** Whether a percent should flip the card's read state to finished. */
export function isFinished(percent: number): boolean {
	return percent >= FINISHED_THRESHOLD;
}

/**
 * The selector of the last candidate at or above the current scroll position —
 * i.e. the element occupying the top of the viewport. Falls back to the first
 * candidate, then to `null` when there are none.
 */
export function nearestAnchor(candidates: AnchorCandidate[], scrollTop: number): string | null {
	let best: AnchorCandidate | undefined;
	for (const c of candidates) {
		if (c.top <= scrollTop + 1) best = c;
		else break;
	}
	return (best ?? candidates[0])?.selector ?? null;
}

/** A stable child selector for the nth direct child of the article container. */
export function childSelector(index: number): string {
	return `:scope > *:nth-child(${index + 1})`;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}
