import type { Card } from '@lectern/shared';

/**
 * The "Daily Newspaper": a print-style edition assembled from a single day's
 * unread feed items, grouped into sections by publication with the meatiest
 * story promoted to the front page. Everything here is pure over the card list
 * so it runs fully offline against the IndexedDB mirror and is easy to unit-test.
 */

/** A grouped run of cards under one heading (a publication, here). */
export interface Section {
	name: string;
	cards: Card[];
}

/** A dated edition built from one day's unread feed items. */
export interface Edition {
	dateKey: string;
	lead: Card | undefined;
	sections: Section[];
	total: number;
}

/** Local `YYYY-MM-DD` key for a Date — editions are dated in the reader's zone. */
export function dateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Today's local date key. */
export function todayKey(now: Date = new Date()): string {
	return dateKey(now);
}

/** Yesterday's local date key — the default edition (a *daily* paper is a day late). */
export function yesterdayKey(now: Date = new Date()): string {
	return shiftDateKey(dateKey(now), -1);
}

/** Parse a `YYYY-MM-DD` key into a local Date at midnight. */
export function parseDateKey(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Shift a `YYYY-MM-DD` key by whole days, staying in local time. */
export function shiftDateKey(key: string, days: number): string {
	const d = parseDateKey(key);
	d.setDate(d.getDate() + days);
	return dateKey(d);
}

/** True when an ISO timestamp falls on the given local date key. */
export function isOnDay(iso: string, key: string): boolean {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return false;
	return dateKey(new Date(t)) === key;
}

function hostname(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

/** Section heading for a card: its publication, falling back to host or "Other". */
export function sectionName(card: Card): string {
	const name = card.siteName?.trim();
	if (name) return name;
	return hostname(card.url) || 'Other';
}

/** Unread RSS/feed items only — the raw material for an edition. */
export function isUnreadFeed(card: Card): boolean {
	return card.location === 'feed' && card.readState !== 'finished';
}

// Rough length proxy so a story missing a word count still sorts sensibly.
function weight(card: Card): number {
	return card.wordCount ?? (card.readingTimeMinutes ?? 0) * 200;
}

/** The edition's headline story: the longest read of the day. */
export function pickLead(cards: Card[]): Card | undefined {
	let best: Card | undefined;
	for (const c of cards) {
		if (!best || weight(c) > weight(best)) best = c;
	}
	return best;
}

/** Group cards by publication, largest section first, newest within each. */
export function groupSections(cards: Card[]): Section[] {
	const map = new Map<string, Card[]>();
	for (const c of cards) {
		const name = sectionName(c);
		const bucket = map.get(name);
		if (bucket) bucket.push(c);
		else map.set(name, [c]);
	}
	const sections: Section[] = [];
	for (const [name, list] of map) {
		list.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
		sections.push({ name, cards: list });
	}
	sections.sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name));
	return sections;
}

/**
 * Assemble the edition for `key`: unread feed items saved that day, grouped into
 * sections by publication, with the meatiest story promoted to the lead slot.
 */
export function buildEdition(cards: Card[], key: string): Edition {
	const items = cards.filter((c) => isUnreadFeed(c) && isOnDay(c.savedAt, key));
	const lead = pickLead(items);
	const rest = lead ? items.filter((c) => c.id !== lead.id) : items;
	return { dateKey: key, lead, sections: groupSections(rest), total: items.length };
}

/**
 * The most recent date key (on or before `before`) that has any unread feed
 * items, so the masthead can open to a non-empty issue. Falls back to `before`.
 */
export function latestIssueKey(cards: Card[], before: string): string {
	let latest: string | undefined;
	for (const c of cards) {
		if (!isUnreadFeed(c)) continue;
		const k = dateKey(new Date(c.savedAt));
		if (k > before) continue;
		if (!latest || k > latest) latest = k;
	}
	return latest ?? before;
}
