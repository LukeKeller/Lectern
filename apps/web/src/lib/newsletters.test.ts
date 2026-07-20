import { describe, expect, it } from 'vitest';
import { Card } from '@lectern/shared';
import {
	buildPublications,
	cadenceLabel,
	issueDate,
	nextIssue,
	publicationKey,
	publicationName,
	senderName
} from './newsletters';

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

	it('merges differing bylines that share a vanity sender domain into one publication', () => {
		// 404 Media mails under many names; the domain is the real publication.
		const pubs = buildPublications([
			issue({
				author: 'Joseph Cox',
				senderDomain: '404media.co',
				publishedAt: '2026-06-01T07:00:00Z'
			}),
			issue({
				author: 'Janus Rose',
				senderDomain: '404media.co',
				publishedAt: '2026-06-05T07:00:00Z'
			}),
			issue({
				author: 'Joseph Cox',
				senderDomain: '404media.co',
				publishedAt: '2026-06-09T07:00:00Z'
			})
		]);
		expect(pubs).toHaveLength(1);
		expect(pubs[0]?.key).toBe('domain:404media.co');
		expect(pubs[0]?.total).toBe(3);
		// Display name = the most frequent byline (Joseph Cox appears twice).
		expect(pubs[0]?.name).toBe('Joseph Cox');
	});

	it('keys on the byline when no sender domain is present (back-compat)', () => {
		const pubs = buildPublications([issue({ author: 'Money Stuff', senderDomain: null })]);
		expect(pubs[0]?.key).toBe('pub:money stuff');
		expect(pubs[0]?.name).toBe('Money Stuff');
	});

	it('splits a hosting platform into its real publications', () => {
		// The production bug: 57 issues from a dozen unrelated newsletters all
		// arrived from ghost.io and rendered as ONE shelf with a combined total,
		// unread count and cadence.
		const pubs = buildPublications([
			issue({ author: 'Jason from 404 Media', senderDomain: 'ghost.io' }),
			issue({ author: 'Sam at 404 Media', senderDomain: 'mail.ghost.io' }),
			issue({ author: 'Taylor Lorenz from User Mag', senderDomain: 'ghost.io' }),
			issue({ author: 'The Cultural Tutor', senderDomain: 'ghost.io' })
		]);
		expect(pubs.map((p) => p.name).sort()).toEqual([
			'404 Media',
			'The Cultural Tutor',
			'User Mag'
		]);
		expect(pubs.find((p) => p.name === '404 Media')?.total).toBe(2);
	});

	it('does not merge unrelated bylineless issues on a platform domain', () => {
		// Nothing on the card identifies a publication, so each issue stands alone
		// rather than joining a bogus shared shelf with a fabricated cadence.
		const pubs = buildPublications([
			issue({ author: null, senderDomain: 'substack.com' }),
			issue({ author: null, senderDomain: 'substack.com' })
		]);
		expect(pubs).toHaveLength(2);
		expect(pubs.every((p) => p.total === 1)).toBe(true);
	});
});

describe('publicationKey', () => {
	it('keys a vanity domain on the domain — every byline under it is one publication', () => {
		expect(publicationKey(issue({ senderDomain: '404media.co' }))).toBe('domain:404media.co');
		expect(publicationKey(issue({ senderDomain: 'wheresyoured.at', author: 'Ed Zitron' }))).toBe(
			'domain:wheresyoured.at'
		);
	});

	it('folds a mail-delivery subdomain into its publication domain', () => {
		// Ed Zitron's issues arrive from ghost.wheresyoured.at; same publication.
		expect(
			publicationKey(issue({ senderDomain: 'ghost.wheresyoured.at', author: 'Ed Zitron' }))
		).toBe('domain:wheresyoured.at');
	});

	it('ignores a platform domain and keys on the publication in the byline', () => {
		const jason = publicationKey(issue({ author: 'Jason from 404 Media', senderDomain: 'ghost.io' }));
		const sam = publicationKey(issue({ author: 'Sam at 404 Media', senderDomain: 'ghost.io' }));
		expect(jason).toBe('pub:404 media');
		expect(sam).toBe(jason);
		expect(publicationKey(issue({ author: 'Money Stuff', senderDomain: 'substack.com' }))).toBe(
			'pub:money stuff'
		);
	});

	it('keeps unrelated publications on one platform apart', () => {
		const a = publicationKey(issue({ author: 'The Cultural Tutor', senderDomain: 'ghost.io' }));
		const b = publicationKey(issue({ author: 'The BeX Files', senderDomain: 'ghost.io' }));
		expect(a).not.toBe(b);
	});

	it('falls back to the byline when the card carries no domain', () => {
		expect(publicationKey(issue({ senderDomain: null, author: 'Garbage Day' }))).toBe(
			'pub:garbage day'
		);
	});

	it('gives a bylineless platform issue a key of its own', () => {
		const one = issue({ author: null, senderDomain: 'ghost.io' });
		const two = issue({ author: null, senderDomain: 'ghost.io' });
		expect(publicationKey(one)).not.toBe(publicationKey(two));
		expect(publicationKey(one)).toBe(`card:${one.id}`);
	});
});

describe('publicationName', () => {
	it('takes the publication out of a byline, keeping its casing', () => {
		expect(publicationName(issue({ author: 'Sam at 404 Media' }))).toBe('404 Media');
		expect(publicationName(issue({ author: 'Taylor Lorenz from User Mag' }))).toBe('User Mag');
	});

	it('leaves a bare publication name untouched', () => {
		expect(publicationName(issue({ author: 'Letters of Note' }))).toBe('Letters of Note');
		expect(publicationName(issue({ author: 'Money Stuff' }))).toBe('Money Stuff');
	});

	it('is empty when the card has no byline', () => {
		expect(publicationName(issue({ author: null }))).toBe('');
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

	it('treats a different byline on the same domain as the same publication', () => {
		const current = issue({ author: 'Joseph Cox', senderDomain: '404media.co' });
		const sibling = issue({ author: 'Janus Rose', senderDomain: '404media.co' });
		const pick = nextIssue([current, sibling], current);
		expect(pick).toEqual({ card: sibling, sameSender: true });
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
