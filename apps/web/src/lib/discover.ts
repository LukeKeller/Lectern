import type { DiscoveryCandidate } from '@lectern/shared';

/**
 * Pure state transitions for the Discover candidate list. The list is held in
 * local `$state` (candidates are not library documents, so they never touch
 * Dexie/sync); these reducers describe the optimistic update applied the moment
 * the user votes or saves, before the server round-trip settles. Kept pure and
 * DOM-free so they can be unit-tested the way `applyMutation` in sync.ts is.
 *
 * - `upvote`  — a signal only: mark the candidate liked but keep it in the list.
 * - `downvote`— records the signal and dismisses it: drop it from the list.
 * - `save`    — the candidate is being pulled into Readeck: flag it `saved` so
 *   the row can show a "Saved" badge (the caller drops it on refresh).
 */
export type CandidateAction = {
	type: 'upvote' | 'downvote' | 'save';
	id: string;
};

export function applyCandidateAction(
	list: DiscoveryCandidate[],
	action: CandidateAction
): DiscoveryCandidate[] {
	switch (action.type) {
		case 'downvote':
			return list.filter((c) => c.id !== action.id);
		case 'upvote':
			return list.map((c) => (c.id === action.id ? { ...c, vote: 'up' } : c));
		case 'save':
			return list.map((c) => (c.id === action.id ? { ...c, status: 'saved' } : c));
		default:
			return list;
	}
}
