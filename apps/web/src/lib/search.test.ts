import { describe, expect, it } from 'vitest';
import { Card } from '@lectern/shared';
import { buildIndex, searchIndex, toIndexDoc } from './search';

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

const cards = [
	makeCard({
		id: 'rust',
		title: 'Understanding Rust ownership',
		author: 'Alice',
		siteName: 'blog.rust-lang.org',
		tags: ['systems']
	}),
	makeCard({
		id: 'gc',
		title: 'Garbage collection internals',
		author: 'Bob',
		siteName: 'example.com',
		tags: ['rust', 'gc']
	}),
	makeCard({
		id: 'web',
		title: 'Building web apps',
		author: 'Carol',
		siteName: 'example.com',
		tags: ['frontend']
	})
];

describe('toIndexDoc', () => {
	it('flattens a card into indexable fields', () => {
		const doc = toIndexDoc(cards[1]!);
		expect(doc).toEqual({
			id: 'gc',
			title: 'Garbage collection internals',
			author: 'Bob',
			siteName: 'example.com',
			tags: 'rust gc'
		});
	});

	it('coerces null author/site to empty strings', () => {
		const doc = toIndexDoc(makeCard({ id: 'x', author: null, siteName: null }));
		expect(doc.author).toBe('');
		expect(doc.siteName).toBe('');
	});
});

describe('searchIndex', () => {
	const index = buildIndex(cards);

	it('returns an empty list for a blank query', () => {
		expect(searchIndex(index, '')).toEqual([]);
		expect(searchIndex(index, '   ')).toEqual([]);
	});

	it('finds documents by title token', () => {
		expect(searchIndex(index, 'ownership')).toEqual(['rust']);
	});

	it('ranks a title match above a tag-only match', () => {
		// "rust" appears in the title of `rust` and only as a tag on `gc`.
		const results = searchIndex(index, 'rust');
		expect(results[0]).toBe('rust');
		expect(results).toContain('gc');
	});

	it('matches by tag and by site', () => {
		expect(searchIndex(index, 'frontend')).toEqual(['web']);
		expect(searchIndex(index, 'rust-lang')).toContain('rust');
	});

	it('supports prefix matches', () => {
		expect(searchIndex(index, 'garba')).toContain('gc');
	});
});
