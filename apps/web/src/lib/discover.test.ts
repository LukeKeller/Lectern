import { describe, expect, it } from 'vitest';
import { DiscoveryCandidate } from '@lectern/shared';
import { applyCandidateAction } from './discover';

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
