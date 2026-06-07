/**
 * Reading-room motion helpers.
 *
 * CSS `scroll-behavior` is reset to `auto` under `prefers-reduced-motion`, but
 * JS-driven scrolling (`scrollIntoView`/`scrollTo`/`scrollBy` with
 * `behavior: 'smooth'`) ignores that rule. These helpers honor the preference so
 * the reader's paragraph-focus, table-of-contents jumps, and highlight jumps
 * stay still for readers who asked for stillness.
 */

/** True when the user has asked the OS to reduce motion. SSR-safe. */
export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

/** Resolve a scroll behavior, downgrading to an instant jump under reduced motion. */
export function scrollBehavior(preferred: ScrollBehavior = 'smooth'): ScrollBehavior {
	return prefersReducedMotion() ? 'auto' : preferred;
}

/**
 * `Element.scrollIntoView` that downgrades to an instant jump under reduced
 * motion. No-ops for a missing element so callers can pass an optional ref.
 */
export function scrollIntoViewMotion(
	el: Element | null | undefined,
	options: ScrollIntoViewOptions = {}
): void {
	if (!el) return;
	el.scrollIntoView({ ...options, behavior: scrollBehavior(options.behavior) });
}
