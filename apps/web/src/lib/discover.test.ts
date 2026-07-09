import { describe, expect, it } from 'vitest';
import { DiscoveryCandidate } from '@lectern/shared';
import {
	applyCandidateAction,
	candidateHost,
	candidateToCard,
	followSignalLabel
} from './discover';

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

	it('clear removes the candidate without casting a vote', () => {
		const list = [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })];
		const next = applyCandidateAction(list, { type: 'clear', id: 'a' });
		expect(next.map((c) => c.id)).toEqual(['b']);
		// Distinct from a down-vote: the remaining candidate keeps its null vote and
		// the dropped one was never marked, so no training signal is implied.
		expect(next[0].vote).toBe(null);
	});

	it('clearAll empties the entire list', () => {
		const list = [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })];
		expect(applyCandidateAction(list, { type: 'clearAll' })).toEqual([]);
	});

	it('muteHost drops every candidate from the given host (www-insensitive)', () => {
		const list = [
			makeCandidate({ id: 'a', url: 'https://spam.example/1' }),
			makeCandidate({ id: 'b', url: 'https://www.spam.example/2' }),
			makeCandidate({ id: 'c', url: 'https://keep.example/3' })
		];
		const next = applyCandidateAction(list, { type: 'muteHost', host: 'spam.example' });
		expect(next.map((c) => c.id)).toEqual(['c']);
	});

	it('muteHost is a no-op when no candidate matches the host', () => {
		const list = [makeCandidate({ id: 'a', url: 'https://keep.example/1' })];
		expect(applyCandidateAction(list, { type: 'muteHost', host: 'other.example' })).toHaveLength(1);
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

describe('candidateHost', () => {
	it('normalizes the host and strips a leading www.', () => {
		expect(candidateHost('https://www.example.com/a/b?x=1')).toBe('example.com');
		expect(candidateHost('https://sub.example.com/a')).toBe('sub.example.com');
	});

	it('returns an empty string for an unparseable URL', () => {
		expect(candidateHost('not a url')).toBe('');
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

describe('followSignalLabel', () => {
	it('uses the singular form for a single signal', () => {
		expect(followSignalLabel(1)).toBe('1 save or upvote');
	});

	it('uses the plural form for multiple signals', () => {
		expect(followSignalLabel(4)).toBe('4 saves & upvotes');
	});

	it('uses the plural form for zero signals', () => {
		expect(followSignalLabel(0)).toBe('0 saves & upvotes');
	});
});
