import DOMPurify from 'dompurify';
import { getClient } from './config';

/**
 * Session cache for sanitized article HTML, shared by the flip-through readers
 * (newspaper / magazine). The BFF already caches the captured copy server-side;
 * this layer dedupes in-flight fetches and lets you flip back and forth through
 * an issue without re-fetching or re-sanitizing. Sanitization happens once, here,
 * so callers can `{@html}` the result directly.
 */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** Fetch + sanitize an article's HTML, memoised per id for the session. */
export async function getArticleHtml(id: string): Promise<string> {
	const cached = cache.get(id);
	if (cached !== undefined) return cached;
	const existing = inflight.get(id);
	if (existing) return existing;
	const p = getClient()
		.getContent(id)
		.then((res) => {
			const clean = DOMPurify.sanitize(res.html);
			cache.set(id, clean);
			inflight.delete(id);
			return clean;
		})
		.catch((err) => {
			inflight.delete(id);
			throw err;
		});
	inflight.set(id, p);
	return p;
}

/** Warm the cache for upcoming pages; failures are ignored (best-effort). */
export function prefetchArticles(ids: (string | undefined)[]): void {
	for (const id of ids) {
		if (id && !cache.has(id) && !inflight.has(id)) void getArticleHtml(id).catch(() => {});
	}
}
