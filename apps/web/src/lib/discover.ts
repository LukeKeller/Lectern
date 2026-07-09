import type { Card, DiscoveryCandidate } from '@lectern/shared';

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
 * - `clear`   — dismiss WITHOUT training the model (distinct from a down-vote):
 *   drop it from the list, casting no vote.
 * - `clearAll`— dismiss every candidate at once (empties the list), no votes.
 * - `muteHost`— drop every candidate served from a given host at once (the user
 *   muted the source); the host is added to `mutedDomains` server-side.
 */
export type CandidateAction =
	| { type: 'upvote' | 'downvote' | 'save' | 'clear'; id: string }
	| { type: 'clearAll' }
	| { type: 'muteHost'; host: string };

/** Normalized host of a candidate URL (drops a leading `www.`), or '' when the
 * URL can't be parsed. Shared by the mute action and its reducer so the host a
 * candidate is filtered on matches the one persisted to `mutedDomains`. */
export function candidateHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

export function applyCandidateAction(
	list: DiscoveryCandidate[],
	action: CandidateAction
): DiscoveryCandidate[] {
	switch (action.type) {
		case 'downvote':
		case 'clear':
			return list.filter((c) => c.id !== action.id);
		case 'clearAll':
			return [];
		case 'muteHost':
			return list.filter((c) => candidateHost(c.url) !== action.host);
		case 'upvote':
			return list.map((c) => (c.id === action.id ? { ...c, vote: 'up' } : c));
		case 'save':
			return list.map((c) => (c.id === action.id ? { ...c, status: 'saved' } : c));
		default:
			return list;
	}
}

/**
 * Human label for a follow suggestion's `signalCount` — the combined number of
 * candidates from a domain the user saved or upvoted. Kept pure and DOM-free so
 * the pluralisation is unit-testable. e.g. 1 -> "1 save or upvote",
 * 4 -> "4 saves & upvotes".
 */
export function followSignalLabel(signalCount: number): string {
	return signalCount === 1 ? '1 save or upvote' : `${signalCount} saves & upvotes`;
}

/**
 * Project a discovered candidate onto the unified `Card` shape so CardList can
 * render it with the exact same magazine-index treatment as feed/library items.
 * Candidates are NOT library documents, so the fields a real Card carries from a
 * backend (reading progress, highlights, tags, word count) are zeroed; the card
 * is presented as an undated "Article". CardList's discover mode reads the
 * candidate-only signals (score, fetcher, vote, saved) from a separate metadata
 * map keyed by id, so nothing candidate-specific has to be smuggled through Card.
 *
 * - `coverImage` <- `imageUrl` (the thumbnail rail)
 * - `savedAt`/`updatedAt` <- `firstSeenAt` (Card requires both; used only for order)
 * - `title` falls back to '' so CardList shows the hostname, as it does elsewhere
 */
export function candidateToCard(c: DiscoveryCandidate): Card {
	return {
		id: c.id,
		source: 'readeck',
		sourceId: c.id,
		category: 'article',
		location: 'inbox',
		readState: 'unopened',
		title: c.title ?? '',
		excerpt: c.excerpt,
		author: c.author,
		siteName: c.siteName,
		senderDomain: null,
		url: c.url,
		coverImage: c.imageUrl,
		wordCount: null,
		readingTimeMinutes: null,
		readingProgress: 0,
		readAnchor: null,
		tags: [],
		highlightCount: 0,
		note: null,
		savedAt: c.firstSeenAt,
		updatedAt: c.firstSeenAt,
		publishedAt: c.publishedAt
	};
}
