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
 * Finished = the derived read state OR progress past the finished threshold.
 * Progress is the authoritative signal in the optimistic window before a sync
 * round-trip; readState covers archived saves whose progress never moved.
 */
export function isFinished(card: Card): boolean {
	return card.readState === 'finished' || card.readingProgress >= FINISHED_THRESHOLD;
}

export interface Publication {
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
	const groups = new Map<string, { name: string; unread: number; dates: number[] }>();
	for (const card of cards) {
		const name = senderName(card);
		let group = groups.get(name);
		if (!group) {
			group = { name, unread: 0, dates: [] };
			groups.set(name, group);
		}
		if (!isFinished(card)) group.unread += 1;
		group.dates.push(issueDate(card));
	}
	return [...groups.values()]
		.map((group) => ({
			name: group.name,
			total: group.dates.length,
			unread: group.unread,
			latestAt: Math.max(...group.dates),
			cadence: cadenceLabel(group.dates)
		}))
		.sort((a, b) => b.latestAt - a.latestAt || a.name.localeCompare(b.name));
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
	const same = unread.filter((c) => senderName(c) === senderName(current)).sort(byNewest);
	if (same[0]) return { card: same[0], sameSender: true };
	const other = unread.sort(byNewest);
	if (other[0]) return { card: other[0], sameSender: false };
	return null;
}
