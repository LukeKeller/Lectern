import { describe, expect, it } from 'vitest';
import { DiscoveryCandidate } from '@lectern/shared';
import { applyCandidateAction, candidateToCard } from './discover';

function makeCandidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
	return DiscoveryCandidate.parse({
		id: 'k1',
		url: 'https://example.com/article',
		fetcher: 'searxng',
		score: 0.5,
		status: 'active',
		firstSeenAt: '2026-01-01T00:00:00Z',
		...overrides
	});
}

describe('applyCandidateAction', () => {
	it('upvote marks the candidate liked but keeps it in the list', () => {
		const list = [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })];
		const next = applyCandidateAction(list, { type: 'upvote', id: 'a' });
		expect(next).toHaveLength(2);
		expect(next.find((c) => c.id === 'a')?.vote).toBe('up');
		expect(next.find((c) => c.id === 'b')?.vote).toBe(null);
	});

	it('downvote removes the candidate from the list', () => {
		const list = [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })];
		const next = applyCandidateAction(list, { type: 'downvote', id: 'a' });
		expect(next.map((c) => c.id)).toEqual(['b']);
	});

	it('save flags the candidate as saved but keeps it in the list', () => {
		const list = [makeCandidate({ id: 'a' })];
		const next = applyCandidateAction(list, { type: 'save', id: 'a' });
		expect(next[0].status).toBe('saved');
	});

	it('returns a new array without mutating the input', () => {
		const list = [makeCandidate({ id: 'a' })];
		const next = applyCandidateAction(list, { type: 'upvote', id: 'a' });
		expect(next).not.toBe(list);
		expect(list[0].vote).toBe(null);
	});

	it('is a no-op when the id is not present', () => {
		const list = [makeCandidate({ id: 'a' })];
		expect(applyCandidateAction(list, { type: 'downvote', id: 'zzz' })).toHaveLength(1);
		expect(applyCandidateAction(list, { type: 'upvote', id: 'zzz' })[0].vote).toBe(null);
	});
});

describe('candidateToCard', () => {
	it('maps candidate fields onto the Card shape CardList renders', () => {
		const c = makeCandidate({
			id: 'x1',
			url: 'https://example.com/post',
			title: 'A Discovered Post',
			excerpt: 'A short summary.',
			author: 'Jane Doe',
			siteName: 'Example',
			imageUrl: 'https://example.com/cover.jpg',
			publishedAt: '2026-02-02T00:00:00Z',
			firstSeenAt: '2026-03-03T00:00:00Z'
		});
		const card = candidateToCard(c);
		expect(card.id).toBe('x1');
		expect(card.url).toBe('https://example.com/post');
		expect(card.title).toBe('A Discovered Post');
		expect(card.excerpt).toBe('A short summary.');
		expect(card.author).toBe('Jane Doe');
		expect(card.siteName).toBe('Example');
		expect(card.coverImage).toBe('https://example.com/cover.jpg');
		expect(card.publishedAt).toBe('2026-02-02T00:00:00Z');
		// firstSeenAt stands in for both save/update timestamps (Card requires them).
		expect(card.savedAt).toBe('2026-03-03T00:00:00Z');
		expect(card.updatedAt).toBe('2026-03-03T00:00:00Z');
		// Presented as a plain, unread, undiscovered-by-a-backend article.
		expect(card.category).toBe('article');
		expect(card.readState).toBe('unopened');
		expect(card.readingProgress).toBe(0);
		expect(card.highlightCount).toBe(0);
		expect(card.tags).toEqual([]);
	});

	it('falls back to an empty title so CardList shows the hostname', () => {
		const card = candidateToCard(makeCandidate({ title: null }));
		expect(card.title).toBe('');
	});

	it('carries null cover/publish dates through when the candidate has none', () => {
		const card = candidateToCard(makeCandidate({ imageUrl: null, publishedAt: null }));
		expect(card.coverImage).toBe(null);
		expect(card.publishedAt).toBe(null);
	});
});
