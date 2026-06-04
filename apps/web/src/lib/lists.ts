import type { Card, Category, Source } from '@lectern/shared';
import type { QueryNode, SortDir, ViewSortBy } from '@lectern/shared';

/**
 * Pure list-shaping helpers shared by every list view: sorting, tag filtering,
 * and evaluating a saved-view query AST against a locally cached card. Keeping
 * these free of Dexie/DOM keeps them unit-testable and lets the views run fully
 * offline over the IndexedDB mirror.
 */

function compareBy(a: Card, b: Card, by: ViewSortBy): number {
	switch (by) {
		case 'title':
			return a.title.localeCompare(b.title);
		case 'wordCount':
			return (a.wordCount ?? 0) - (b.wordCount ?? 0);
		case 'readingProgress':
			return a.readingProgress - b.readingProgress;
		case 'savedAt':
			return a.savedAt.localeCompare(b.savedAt);
		case 'updatedAt':
			return a.updatedAt.localeCompare(b.updatedAt);
	}
}

/** Return a new array sorted by `by`/`dir`; the input is never mutated. */
export function sortCards(cards: Card[], by: ViewSortBy, dir: SortDir): Card[] {
	const sign = dir === 'asc' ? 1 : -1;
	return [...cards].sort((a, b) => {
		const cmp = compareBy(a, b, by);
		// Stable tiebreak on id so equal keys keep a deterministic order.
		return cmp !== 0 ? cmp * sign : a.id.localeCompare(b.id) * sign;
	});
}

/** Filter to cards carrying `tag`; a null/empty tag is a no-op pass-through. */
export function filterByTag(cards: Card[], tag: string | null | undefined): Card[] {
	if (!tag) return cards;
	return cards.filter((c) => c.tags.includes(tag));
}

/** Filter cards by read state: 'unread' (not finished), 'read' (finished), or 'all'. */
export function filterByReadState(cards: Card[], mode: 'unread' | 'read' | 'all'): Card[] {
	if (mode === 'all') return cards;
	const finished = mode === 'read';
	return cards.filter((c) => (c.readState === 'finished') === finished);
}

/** Filter to cards from `source`; 'all'/null/undefined is a no-op pass-through. */
export function filterBySource(cards: Card[], source: Source | 'all' | null | undefined): Card[] {
	if (!source || source === 'all') return cards;
	return cards.filter((c) => c.source === source);
}

/** Filter to cards of `category`; 'all'/null/undefined is a no-op pass-through. */
export function filterByCategory(
	cards: Card[],
	category: Category | 'all' | null | undefined
): Card[] {
	if (!category || category === 'all') return cards;
	return cards.filter((c) => c.category === category);
}

/**
 * Case-insensitive substring filter over title, site name and author. An empty
 * or whitespace-only query is a no-op pass-through. Short-circuits per field so
 * no combined haystack string is allocated.
 */
export function filterByText(cards: Card[], text: string | null | undefined): Card[] {
	const needle = text?.trim().toLowerCase();
	if (!needle) return cards;
	return cards.filter(
		(c) =>
			c.title.toLowerCase().includes(needle) ||
			(c.siteName?.toLowerCase().includes(needle) ?? false) ||
			(c.author?.toLowerCase().includes(needle) ?? false)
	);
}

/** Every distinct tag across the cards, sorted alphabetically. */
export function collectTags(cards: Card[]): string[] {
	const seen: Record<string, true> = {};
	for (const c of cards) for (const t of c.tags) seen[t] = true;
	return Object.keys(seen).sort((a, b) => a.localeCompare(b));
}

const CATEGORY_ORDER: readonly Category[] = ['article', 'rss', 'email', 'pdf'];
const SOURCE_ORDER: readonly Source[] = ['miniflux', 'readeck'];

/**
 * Categories present in `cards`, in canonical order (article, rss, email, pdf).
 * Used to populate the category facet only with options that can match.
 */
export function collectCategories(cards: Card[]): Category[] {
	const present = new Set<Category>();
	for (const c of cards) present.add(c.category);
	return CATEGORY_ORDER.filter((c) => present.has(c));
}

/** Distinct sources present in `cards`, in canonical order (miniflux, readeck). */
export function collectSources(cards: Card[]): Source[] {
	const present = new Set<Source>();
	for (const c of cards) present.add(c.source);
	return SOURCE_ORDER.filter((s) => present.has(s));
}

function fieldValue(card: Card, field: string): string | number | boolean | null {
	switch (field) {
		case 'location':
			return card.location;
		case 'category':
			return card.category;
		case 'source':
			return card.source;
		case 'author':
			return card.author;
		case 'site':
			return card.siteName;
		case 'title':
			return card.title;
		case 'words':
			return card.wordCount ?? 0;
		case 'progress':
			return card.readingProgress;
		case 'saved':
			return card.savedAt;
		case 'updated':
			return card.updatedAt;
		case 'highlighted':
			return card.highlightCount > 0;
		default:
			return null;
	}
}

function evalTerm(card: Card, node: Extract<QueryNode, { kind: 'term' }>): boolean {
	if (node.field === 'tag') {
		const tag = String(node.value);
		return node.op === 'has' || node.op === 'eq'
			? card.tags.includes(tag)
			: node.op === 'contains'
				? card.tags.some((t) => t.includes(tag))
				: node.op === 'neq'
					? !card.tags.includes(tag)
					: false;
	}
	const actual = fieldValue(card, node.field);
	const expected = node.value;
	switch (node.op) {
		case 'eq':
		case 'has':
			return actual === expected;
		case 'neq':
			return actual !== expected;
		case 'contains':
			return String(actual ?? '')
				.toLowerCase()
				.includes(String(expected).toLowerCase());
		case 'gt':
		case 'after':
			return (actual ?? 0) > expected;
		case 'gte':
			return (actual ?? 0) >= expected;
		case 'lt':
		case 'before':
			return (actual ?? 0) < expected;
		case 'lte':
			return (actual ?? 0) <= expected;
	}
}

/** Evaluate a saved-view query AST against a single card. */
export function matchesQuery(card: Card, node: QueryNode): boolean {
	switch (node.kind) {
		case 'and':
			return node.nodes.every((n) => matchesQuery(card, n));
		case 'or':
			return node.nodes.some((n) => matchesQuery(card, n));
		case 'not':
			return !matchesQuery(card, node.node);
		case 'term':
			return evalTerm(card, node);
	}
}
