import { describe, expect, it } from 'vitest';
import { Card } from '@lectern/shared';
import { buildPublications, cadenceLabel, issueDate, nextIssue, senderName } from './newsletters';

let seq = 0;
function issue(overrides: Partial<Card> = {}): Card {
	seq += 1;
	return Card.parse({
		id: `readeck:e${seq}`,
		source: 'readeck',
		sourceId: `e${seq}`,
		category: 'email',
		location: 'inbox',
		title: `Issue ${seq}`,
		author: 'Money Stuff',
		url: `https://newsletter.lectern.local/issue-${seq}`,
		savedAt: '2026-06-10T08:00:00Z',
		updatedAt: '2026-06-10T08:00:00Z',
		...overrides
	});
}

describe('issueDate', () => {
	it('prefers the publish date and falls back to the save time', () => {
		const published = issue({ publishedAt: '2026-06-01T07:00:00Z' });
		const saved = issue({ publishedAt: null, savedAt: '2026-06-09T10:30:00Z' });
		expect(issueDate(published)).toBe(Date.parse('2026-06-01T07:00:00Z'));
		expect(issueDate(saved)).toBe(Date.parse('2026-06-09T10:30:00Z'));
	});
});

describe('senderName', () => {
	it('falls back when the sender is missing or blank', () => {
		expect(senderName(issue({ author: '  ' }))).toBe('Newsletter');
		expect(senderName(issue({ author: null }))).toBe('Newsletter');
		expect(senderName(issue({ author: 'Garbage Day' }))).toBe('Garbage Day');
	});
});

describe('buildPublications', () => {
	it('groups by sender, counts unread, and orders by latest arrival', () => {
		const cards = [
			issue({ author: 'Money Stuff', publishedAt: '2026-06-01T07:00:00Z' }),
			issue({
				author: 'Money Stuff',
				publishedAt: '2026-06-08T07:00:00Z',
				readState: 'finished'
			}),
			issue({ author: 'Garbage Day', publishedAt: '2026-06-10T07:00:00Z' })
		];
		const pubs = buildPublications(cards);
		expect(pubs.map((p) => p.name)).toEqual(['Garbage Day', 'Money Stuff']);
		const money = pubs.find((p) => p.name === 'Money Stuff');
		expect(money?.total).toBe(2);
		expect(money?.unread).toBe(1);
		expect(money?.latestAt).toBe(Date.parse('2026-06-08T07:00:00Z'));
	});

	it('breaks arrival ties alphabetically so the rack is stable', () => {
		const at = '2026-06-10T07:00:00Z';
		const pubs = buildPublications([
			issue({ author: 'Stratechery', publishedAt: at }),
			issue({ author: 'Morning Brew', publishedAt: at })
		]);
		expect(pubs.map((p) => p.name)).toEqual(['Morning Brew', 'Stratechery']);
	});
});

describe('cadenceLabel', () => {
	const days = (...offsets: number[]) =>
		offsets.map((d) => Date.parse('2026-01-01T08:00:00Z') + d * 86_400_000);

	it('reports nothing below three issues', () => {
		expect(cadenceLabel(days(0, 7))).toBeNull();
	});

	it('buckets the median gap', () => {
		expect(cadenceLabel(days(0, 1, 2, 3))).toBe('arrives daily');
		expect(cadenceLabel(days(0, 7, 14, 21))).toBe('arrives about weekly');
		expect(cadenceLabel(days(0, 30, 61))).toBe('arrives about monthly');
	});

	it('is robust to one outlier gap', () => {
		// Weekly issues with one long holiday pause: the median stays weekly.
		expect(cadenceLabel(days(0, 7, 14, 60, 67, 74))).toBe('arrives about weekly');
	});
});

describe('nextIssue', () => {
	it('prefers the newest unread issue from the same publication', () => {
		const current = issue({ author: 'Money Stuff', publishedAt: '2026-06-10T07:00:00Z' });
		const older = issue({ author: 'Money Stuff', publishedAt: '2026-06-01T07:00:00Z' });
		const newer = issue({ author: 'Money Stuff', publishedAt: '2026-06-08T07:00:00Z' });
		const other = issue({ author: 'Garbage Day', publishedAt: '2026-06-09T07:00:00Z' });
		const pick = nextIssue([current, older, newer, other], current);
		expect(pick).toEqual({ card: newer, sameSender: true });
	});

	it('falls back to another publication and skips finished issues', () => {
		const current = issue({ author: 'Money Stuff' });
		const done = issue({ author: 'Money Stuff', readState: 'finished' });
		const other = issue({ author: 'Garbage Day' });
		const pick = nextIssue([current, done, other], current);
		expect(pick).toEqual({ card: other, sameSender: false });
	});

	it('ignores non-email cards and returns null when the backlog is finished', () => {
		const current = issue({ author: 'Money Stuff' });
		const article = issue({ category: 'article', author: 'Money Stuff' });
		expect(nextIssue([current, article], current)).toBeNull();
	});

	it('treats a full progress bar as finished before readState catches up', () => {
		const current = issue({ author: 'Money Stuff' });
		const scrolled = issue({
			author: 'Money Stuff',
			readState: 'unopened',
			readingProgress: 1
		});
		expect(nextIssue([current, scrolled], current)).toBeNull();
		const pubs = buildPublications([scrolled]);
		expect(pubs[0]?.unread).toBe(0);
	});
});
