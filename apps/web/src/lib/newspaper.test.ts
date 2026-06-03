import { describe, expect, it } from 'vitest';
import { Card } from '@lectern/shared';
import {
	buildEdition,
	dateKey,
	groupSections,
	isOnDay,
	isUnreadFeed,
	latestIssueKey,
	parseDateKey,
	pickLead,
	sectionName,
	shiftDateKey,
	yesterdayKey
} from './newspaper';

// Build savedAt from a local Date (noon) so the local-time keys are stable
// regardless of the runner's timezone.
function at(year: number, month: number, day: number): string {
	return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

function makeCard(overrides: Partial<Card> = {}): Card {
	return Card.parse({
		id: 'c1',
		source: 'miniflux',
		sourceId: 'm1',
		category: 'rss',
		location: 'feed',
		title: 'Title',
		siteName: 'Example',
		url: 'https://example.com/a',
		savedAt: at(2026, 6, 2),
		updatedAt: at(2026, 6, 2),
		...overrides
	});
}

describe('date keys', () => {
	it('shifts whole days across a month boundary', () => {
		expect(shiftDateKey('2026-06-01', -1)).toBe('2026-05-31');
		expect(shiftDateKey('2026-06-30', 1)).toBe('2026-07-01');
	});

	it('round-trips through parseDateKey', () => {
		expect(dateKey(parseDateKey('2026-06-02'))).toBe('2026-06-02');
	});

	it('yesterday is one day before today', () => {
		const now = new Date(2026, 5, 3, 9, 0, 0);
		expect(yesterdayKey(now)).toBe('2026-06-02');
	});

	it('matches an ISO timestamp to its local day', () => {
		expect(isOnDay(at(2026, 6, 2), '2026-06-02')).toBe(true);
		expect(isOnDay(at(2026, 6, 2), '2026-06-03')).toBe(false);
		expect(isOnDay('not-a-date', '2026-06-02')).toBe(false);
	});
});

describe('sectionName', () => {
	it('prefers siteName, falls back to host, then Other', () => {
		expect(sectionName(makeCard({ siteName: 'The Verge' }))).toBe('The Verge');
		expect(sectionName(makeCard({ siteName: null, url: 'https://www.foo.com/x' }))).toBe('foo.com');
		// An unparseable URL can't pass the Card schema, so exercise the final
		// fallback against a card whose url is corrupted after construction.
		expect(sectionName({ ...makeCard({ siteName: null }), url: 'not a url' })).toBe('Other');
	});
});

describe('isUnreadFeed', () => {
	it('keeps only unread feed-located items', () => {
		expect(isUnreadFeed(makeCard())).toBe(true);
		expect(isUnreadFeed(makeCard({ readState: 'finished' }))).toBe(false);
		expect(isUnreadFeed(makeCard({ location: 'later' }))).toBe(false);
	});
});

describe('pickLead', () => {
	it('promotes the longest story', () => {
		const a = makeCard({ id: 'a', wordCount: 200 });
		const b = makeCard({ id: 'b', wordCount: 900 });
		const c = makeCard({ id: 'c', wordCount: 100 });
		expect(pickLead([a, b, c])?.id).toBe('b');
	});

	it('returns undefined for an empty edition', () => {
		expect(pickLead([])).toBeUndefined();
	});
});

describe('groupSections', () => {
	it('groups by publication, largest section first', () => {
		const cards = [
			makeCard({ id: 'a', siteName: 'Alpha' }),
			makeCard({ id: 'b', siteName: 'Beta' }),
			makeCard({ id: 'c', siteName: 'Beta' })
		];
		const sections = groupSections(cards);
		expect(sections.map((s) => s.name)).toEqual(['Beta', 'Alpha']);
		expect(sections[0]?.cards).toHaveLength(2);
	});
});

describe('buildEdition', () => {
	const cards = [
		makeCard({ id: 'lead', siteName: 'Alpha', wordCount: 3000, savedAt: at(2026, 6, 2) }),
		makeCard({ id: 'a2', siteName: 'Alpha', wordCount: 400, savedAt: at(2026, 6, 2) }),
		makeCard({ id: 'b1', siteName: 'Beta', wordCount: 500, savedAt: at(2026, 6, 2) }),
		// Excluded: read, wrong day, and not a feed item.
		makeCard({ id: 'read', readState: 'finished', savedAt: at(2026, 6, 2) }),
		makeCard({ id: 'other-day', savedAt: at(2026, 6, 1) }),
		makeCard({ id: 'saved', location: 'later', savedAt: at(2026, 6, 2) })
	];

	it('collects the day, promotes a lead, and excludes it from sections', () => {
		const edition = buildEdition(cards, '2026-06-02');
		expect(edition.total).toBe(3);
		expect(edition.lead?.id).toBe('lead');
		const ids = edition.sections.flatMap((s) => s.cards.map((c) => c.id));
		expect(ids).toEqual(expect.arrayContaining(['a2', 'b1']));
		expect(ids).not.toContain('lead');
	});

	it('is empty for a day with no unread feed items', () => {
		const edition = buildEdition(cards, '2026-05-01');
		expect(edition.total).toBe(0);
		expect(edition.lead).toBeUndefined();
		expect(edition.sections).toEqual([]);
	});
});

describe('latestIssueKey', () => {
	it('finds the most recent day with content on or before the cutoff', () => {
		const cards = [
			makeCard({ id: 'a', savedAt: at(2026, 6, 1) }),
			makeCard({ id: 'b', savedAt: at(2026, 6, 2) }),
			makeCard({ id: 'future', savedAt: at(2026, 6, 5) })
		];
		expect(latestIssueKey(cards, '2026-06-03')).toBe('2026-06-02');
	});

	it('falls back to the cutoff when nothing qualifies', () => {
		expect(latestIssueKey([], '2026-06-03')).toBe('2026-06-03');
	});
});
