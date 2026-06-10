import { describe, expect, it } from 'vitest';
import { Card } from '@lectern/shared';
import { buildMagazines, isLibraryItem, magazineTitle } from './magazine';

function makeCard(overrides: Partial<Card> = {}): Card {
	return Card.parse({
		id: 'c1',
		source: 'readeck',
		sourceId: 'r1',
		category: 'article',
		location: 'later',
		title: 'Title',
		url: 'https://example.com/a',
		savedAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	});
}

describe('isLibraryItem', () => {
	it('excludes transient feed items', () => {
		expect(isLibraryItem(makeCard({ location: 'later' }))).toBe(true);
		expect(isLibraryItem(makeCard({ location: 'archive' }))).toBe(true);
		expect(isLibraryItem(makeCard({ location: 'feed' }))).toBe(false);
	});
});

describe('buildMagazines', () => {
	const cards = [
		makeCard({ id: 'a', tags: ['react', 'js'], savedAt: '2026-03-01T00:00:00Z' }),
		makeCard({ id: 'b', tags: ['react'], savedAt: '2026-02-01T00:00:00Z' }),
		makeCard({ id: 'c', tags: ['js'], savedAt: '2026-01-01T00:00:00Z' }),
		makeCard({ id: 'solo', tags: ['rust'] }),
		makeCard({ id: 'feed', location: 'feed', tags: ['react'] })
	];

	it('groups library items by shared tag, biggest issue first', () => {
		const issues = buildMagazines(cards);
		// react and js each bind two library items; the tie breaks alphabetically.
		expect(issues.map((m) => m.tag)).toEqual(['js', 'react']);
		const react = issues.find((m) => m.tag === 'react');
		expect(react?.cards.map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('drops tags below the minimum and ignores feed items', () => {
		const tags = buildMagazines(cards).map((m) => m.tag);
		expect(tags).not.toContain('rust');
		// 'react' qualifies only via library items 'a' + 'b', not the feed card.
		const react = buildMagazines(cards).find((m) => m.tag === 'react');
		expect(react?.cards.map((c) => c.id)).not.toContain('feed');
	});

	it('honours a custom minimum', () => {
		expect(buildMagazines(cards, 3)).toEqual([]);
	});
});

describe('magazineTitle', () => {
	it('strips leaked tag syntax and title-cases the words', () => {
		expect(magazineTitle("['rss'")).toBe('Rss');
		expect(magazineTitle("'article'")).toBe('Article');
		expect(magazineTitle('politics-society]')).toBe('Politics Society');
	});

	it('turns separators into spaces and capitalizes each word', () => {
		expect(magazineTitle('machine_learning')).toBe('Machine Learning');
		expect(magazineTitle('long-reads')).toBe('Long Reads');
	});

	it('falls back to the raw tag when stripping leaves nothing', () => {
		expect(magazineTitle("[]''")).toBe("[]''");
	});
});
