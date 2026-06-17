import { FINISHED_THRESHOLD, type Card } from '@lectern/shared';

/**
 * Pure newsletter-shaping logic for the Newsletters surface and the reader's
 * issue-to-issue flow. Newsletters are cards with `category === 'email'`; the
 * sender (the publication) lives in `author`, set at ingestion from the
 * message's From header.
 */

/** Arrival instant: the publish date when the mailer set one, else save time. */
export function issueDate(card: Card): number {
	return Date.parse(card.publishedAt ?? card.savedAt);
}

/** The publication a card belongs to. Ingestion guarantees a sender name, but
 * hand-saved or legacy email cards may lack one. */
export function senderName(card: Card): string {
	return card.author?.trim() || 'Newsletter';
}

/**
 * The stable grouping key for a publication: the sender's email domain when set
 * (so 404 Media's many bylines — Joseph Cox, Janus Rose, Samantha Cole, all
 * @404media.co — collapse into one shelf), falling back to the display name for
 * non-email or legacy cards that carry no domain.
 */
export function publicationKey(card: Card): string {
	return card.senderDomain?.trim().toLowerCase() || senderName(card);
}

/**
 * Finished = the derived read state OR progress past the finished threshold.
 * Progress is the authoritative signal in the optimistic window before a sync
 * round-trip; readState covers archived saves whose progress never moved.
 */
export function isFinished(card: Card): boolean {
	return card.readState === 'finished' || card.readingProgress >= FINISHED_THRESHOLD;
}

export interface Publication {
	/** Stable grouping key (the sender domain, or the name when none). The page
	 * filters a publication's issues by `publicationKey(card) === key`. */
	key: string;
	name: string;
	total: number;
	unread: number;
	/** Arrival instant of the most recent issue. */
	latestAt: number;
	/** Human cadence ("arrives about weekly"); null below three issues. */
	cadence: string | null;
}

/**
 * Group email cards into publications, ordered by most recent arrival (shelf
 * order follows the mail, not an algorithm). Ties break alphabetically so the
 * rack is stable.
 */
export function buildPublications(cards: Card[]): Publication[] {
	const groups = new Map<
		string,
		{ key: string; unread: number; dates: number[]; names: Map<string, number> }
	>();
	for (const card of cards) {
		const key = publicationKey(card);
		let group = groups.get(key);
		if (!group) {
			group = { key, unread: 0, dates: [], names: new Map() };
			groups.set(key, group);
		}
		if (!isFinished(card)) group.unread += 1;
		group.dates.push(issueDate(card));
		// Tally display names so the merged group can show a human label (the most
		// common byline) rather than a bare domain.
		const name = senderName(card);
		group.names.set(name, (group.names.get(name) ?? 0) + 1);
	}
	return [...groups.values()]
		.map((group) => ({
			key: group.key,
			name: representativeName(group.names),
			total: group.dates.length,
			unread: group.unread,
			latestAt: Math.max(...group.dates),
			cadence: cadenceLabel(group.dates)
		}))
		.sort((a, b) => b.latestAt - a.latestAt || a.name.localeCompare(b.name));
}

/** The display name for a merged group: the most frequent byline, ties broken
 * alphabetically so the label is deterministic. */
function representativeName(names: Map<string, number>): string {
	let best = 'Newsletter';
	let bestCount = -1;
	for (const [name, count] of names) {
		if (count > bestCount || (count === bestCount && name.localeCompare(best) < 0)) {
			best = name;
			bestCount = count;
		}
	}
	return best;
}

const DAY_MS = 86_400_000;

/**
 * Describe how often issues arrive from the median gap between them. Honest
 * data only: below three issues there is no rhythm to report, so null.
 */
export function cadenceLabel(dates: number[]): string | null {
	if (dates.length < 3) return null;
	const sorted = [...dates].sort((a, b) => a - b);
	const gaps: number[] = [];
	for (let i = 1; i < sorted.length; i += 1) {
		const prev = sorted[i - 1];
		const next = sorted[i];
		if (prev !== undefined && next !== undefined) gaps.push((next - prev) / DAY_MS);
	}
	gaps.sort((a, b) => a - b);
	const mid = gaps[Math.floor(gaps.length / 2)];
	if (mid === undefined) return null;
	if (mid <= 1.5) return 'arrives daily';
	if (mid <= 3.5) return 'arrives every few days';
	if (mid <= 10) return 'arrives about weekly';
	if (mid <= 21) return 'arrives every couple of weeks';
	return 'arrives about monthly';
}

/**
 * The issue to read after `current`: the newest unread issue from the same
 * publication first, then the newest unread issue from any other newsletter.
 * Null when the email backlog is finished.
 */
export function nextIssue(all: Card[], current: Card): { card: Card; sameSender: boolean } | null {
	const unread = all.filter((c) => c.category === 'email' && c.id !== current.id && !isFinished(c));
	const byNewest = (a: Card, b: Card) => issueDate(b) - issueDate(a);
	const same = unread.filter((c) => publicationKey(c) === publicationKey(current)).sort(byNewest);
	if (same[0]) return { card: same[0], sameSender: true };
	const other = unread.sort(byNewest);
	if (other[0]) return { card: other[0], sameSender: false };
	return null;
}
