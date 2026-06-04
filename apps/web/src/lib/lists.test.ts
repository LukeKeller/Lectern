import { describe, expect, it } from 'vitest';
import { Card, type QueryNode } from '@lectern/shared';
import {
	collectCategories,
	collectSources,
	collectTags,
	filterByCategory,
	filterByReadState,
	filterBySource,
	filterByTag,
	filterByText,
	matchesQuery,
	sortCards
} from './lists';

function makeCard(overrides: Partial<Card> = {}): Card {
	return Card.parse({
		id: 'c1',
		source: 'readeck',
		sourceId: 'r1',
		category: 'article',
		location: 'inbox',
		title: 'Title',
		url: 'https://example.com/a',
		savedAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	});
}

describe('sortCards', () => {
	const a = makeCard({
		id: 'a',
		title: 'Apple',
		wordCount: 100,
		readingProgress: 0.1,
		savedAt: '2026-01-01T00:00:00Z'
	});
	const b = makeCard({
		id: 'b',
		title: 'Banana',
		wordCount: 300,
		readingProgress: 0.5,
		savedAt: '2026-03-01T00:00:00Z'
	});
	const c = makeCard({
		id: 'c',
		title: 'Cherry',
		wordCount: 200,
		readingProgress: 0.9,
		savedAt: '2026-02-01T00:00:00Z'
	});
	const cards = [b, a, c];

	it('sorts by title ascending and descending', () => {
		expect(sortCards(cards, 'title', 'asc').map((x) => x.id)).toEqual(['a', 'b', 'c']);
		expect(sortCards(cards, 'title', 'desc').map((x) => x.id)).toEqual(['c', 'b', 'a']);
	});

	it('sorts by wordCount and readingProgress', () => {
		expect(sortCards(cards, 'wordCount', 'asc').map((x) => x.id)).toEqual(['a', 'c', 'b']);
		expect(sortCards(cards, 'readingProgress', 'desc').map((x) => x.id)).toEqual(['c', 'b', 'a']);
	});

	it('sorts by savedAt', () => {
		expect(sortCards(cards, 'savedAt', 'desc').map((x) => x.id)).toEqual(['b', 'c', 'a']);
	});

	it('treats a null wordCount as zero', () => {
		const n = makeCard({ id: 'n', wordCount: null });
		expect(sortCards([a, n], 'wordCount', 'asc')[0]!.id).toBe('n');
	});

	it('does not mutate its input', () => {
		const input = [b, a, c];
		sortCards(input, 'title', 'asc');
		expect(input.map((x) => x.id)).toEqual(['b', 'a', 'c']);
	});

	it('is deterministic on ties via id tiebreak', () => {
		const x = makeCard({ id: 'x', wordCount: 100 });
		const y = makeCard({ id: 'y', wordCount: 100 });
		expect(sortCards([y, x], 'wordCount', 'asc').map((c2) => c2.id)).toEqual(['x', 'y']);
	});
});

describe('filterByTag / collectTags', () => {
	const cards = [
		makeCard({ id: 'a', tags: ['news', 'tech'] }),
		makeCard({ id: 'b', tags: ['tech'] }),
		makeCard({ id: 'c', tags: [] })
	];

	it('filters to cards carrying a tag', () => {
		expect(filterByTag(cards, 'tech').map((c) => c.id)).toEqual(['a', 'b']);
		expect(filterByTag(cards, 'news').map((c) => c.id)).toEqual(['a']);
	});

	it('passes through when the tag is null or empty', () => {
		expect(filterByTag(cards, null)).toHaveLength(3);
		expect(filterByTag(cards, '')).toHaveLength(3);
	});

	it('collects distinct sorted tags', () => {
		expect(collectTags(cards)).toEqual(['news', 'tech']);
	});
});

describe('filterByReadState', () => {
	const cards = [
		makeCard({ id: 'unopened', readState: 'unopened' }),
		makeCard({ id: 'reading', readState: 'reading' }),
		makeCard({ id: 'finished', readState: 'finished' })
	];

	it('keeps only unfinished items in unread mode', () => {
		expect(filterByReadState(cards, 'unread').map((c) => c.id)).toEqual(['unopened', 'reading']);
	});

	it('keeps only finished items in read mode', () => {
		expect(filterByReadState(cards, 'read').map((c) => c.id)).toEqual(['finished']);
	});

	it('passes everything through in all mode', () => {
		expect(filterByReadState(cards, 'all')).toHaveLength(3);
	});
});

describe('filterBySource / collectSources', () => {
	const cards = [
		makeCard({ id: 'rss', source: 'miniflux' }),
		makeCard({ id: 'saved', source: 'readeck' }),
		makeCard({ id: 'rss2', source: 'miniflux' })
	];

	it('filters to a single source', () => {
		expect(filterBySource(cards, 'miniflux').map((c) => c.id)).toEqual(['rss', 'rss2']);
		expect(filterBySource(cards, 'readeck').map((c) => c.id)).toEqual(['saved']);
	});

	it('passes through for all / null / undefined', () => {
		expect(filterBySource(cards, 'all')).toHaveLength(3);
		expect(filterBySource(cards, null)).toHaveLength(3);
		expect(filterBySource(cards, undefined)).toHaveLength(3);
	});

	it('collects present sources in canonical order', () => {
		expect(collectSources(cards)).toEqual(['miniflux', 'readeck']);
		expect(collectSources([makeCard({ source: 'readeck' })])).toEqual(['readeck']);
		expect(collectSources([])).toEqual([]);
	});
});

describe('filterByCategory / collectCategories', () => {
	const cards = [
		makeCard({ id: 'a', category: 'article' }),
		makeCard({ id: 'r', category: 'rss' }),
		makeCard({ id: 'p', category: 'pdf' })
	];

	it('filters to a single category', () => {
		expect(filterByCategory(cards, 'rss').map((c) => c.id)).toEqual(['r']);
		expect(filterByCategory(cards, 'pdf').map((c) => c.id)).toEqual(['p']);
	});

	it('passes through for all / null / undefined', () => {
		expect(filterByCategory(cards, 'all')).toHaveLength(3);
		expect(filterByCategory(cards, null)).toHaveLength(3);
		expect(filterByCategory(cards, undefined)).toHaveLength(3);
	});

	it('collects present categories in canonical order', () => {
		expect(collectCategories(cards)).toEqual(['article', 'rss', 'pdf']);
		expect(collectCategories([makeCard({ category: 'email' })])).toEqual(['email']);
		expect(collectCategories([])).toEqual([]);
	});
});

describe('filterByText', () => {
	const cards = [
		makeCard({ id: 'title', title: 'The Quiet Web', siteName: null, author: null }),
		makeCard({ id: 'site', title: 'Untitled', siteName: 'danluu.com', author: null }),
		makeCard({ id: 'author', title: 'Untitled', siteName: null, author: 'Jane Doe' })
	];

	it('matches title, site name and author case-insensitively', () => {
		expect(filterByText(cards, 'quiet').map((c) => c.id)).toEqual(['title']);
		expect(filterByText(cards, 'DANLUU').map((c) => c.id)).toEqual(['site']);
		expect(filterByText(cards, 'jane').map((c) => c.id)).toEqual(['author']);
	});

	it('matches a substring across multiple fields', () => {
		expect(filterByText(cards, 'untitled').map((c) => c.id)).toEqual(['site', 'author']);
	});

	it('passes through for empty / whitespace / null / undefined', () => {
		expect(filterByText(cards, '')).toHaveLength(3);
		expect(filterByText(cards, '   ')).toHaveLength(3);
		expect(filterByText(cards, null)).toHaveLength(3);
		expect(filterByText(cards, undefined)).toHaveLength(3);
	});

	it('tolerates null site name and author without matching', () => {
		expect(filterByText(cards, 'nonexistent')).toHaveLength(0);
	});
});

describe('matchesQuery', () => {
	const card = makeCard({
		location: 'later',
		tags: ['longread'],
		wordCount: 2500,
		author: 'Jane Doe',
		highlightCount: 2
	});

	it('matches a location term', () => {
		expect(matchesQuery(card, { kind: 'term', field: 'location', op: 'eq', value: 'later' })).toBe(
			true
		);
		expect(matchesQuery(card, { kind: 'term', field: 'location', op: 'eq', value: 'inbox' })).toBe(
			false
		);
	});

	it('matches a tag has-term', () => {
		expect(matchesQuery(card, { kind: 'term', field: 'tag', op: 'has', value: 'longread' })).toBe(
			true
		);
		expect(matchesQuery(card, { kind: 'term', field: 'tag', op: 'has', value: 'news' })).toBe(
			false
		);
	});

	it('matches numeric comparisons on words', () => {
		expect(matchesQuery(card, { kind: 'term', field: 'words', op: 'gt', value: 2000 })).toBe(true);
		expect(matchesQuery(card, { kind: 'term', field: 'words', op: 'lt', value: 2000 })).toBe(false);
	});

	it('matches a contains term case-insensitively', () => {
		expect(
			matchesQuery(card, { kind: 'term', field: 'author', op: 'contains', value: 'jane' })
		).toBe(true);
	});

	it('evaluates a boolean highlighted term', () => {
		expect(matchesQuery(card, { kind: 'term', field: 'highlighted', op: 'eq', value: true })).toBe(
			true
		);
	});

	it('evaluates and/or/not compounds', () => {
		const and: QueryNode = {
			kind: 'and',
			nodes: [
				{ kind: 'term', field: 'location', op: 'eq', value: 'later' },
				{ kind: 'term', field: 'words', op: 'gte', value: 2500 }
			]
		};
		expect(matchesQuery(card, and)).toBe(true);
		const or: QueryNode = {
			kind: 'or',
			nodes: [
				{ kind: 'term', field: 'location', op: 'eq', value: 'inbox' },
				{ kind: 'term', field: 'tag', op: 'has', value: 'longread' }
			]
		};
		expect(matchesQuery(card, or)).toBe(true);
		const not: QueryNode = {
			kind: 'not',
			node: { kind: 'term', field: 'location', op: 'eq', value: 'inbox' }
		};
		expect(matchesQuery(card, not)).toBe(true);
	});
});
