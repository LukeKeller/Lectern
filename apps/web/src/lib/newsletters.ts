import { FINISHED_THRESHOLD, type Card } from '@lectern/shared';

/**
 * Pure newsletter-shaping logic for the Newsletters surface and the reader's
 * issue-to-issue flow. Newsletters are cards with `category === 'email'`.
 *
 * WHAT THE CARD ACTUALLY CARRIES. Two fields matter here and neither is as
 * reliable as it looks:
 *
 *  - `author` is `bookmark.authors?.[0] ?? null` (see `readeckBookmarkToCard`) —
 *    whatever Readeck's extractor made of the HTML we handed it. Ingestion emits
 *    `<meta name="author">` from the From display name, so it is USUALLY the
 *    sender's name, but it is extractor output, not the From header, and it can
 *    be null. It is a byline, not a publication: 404 Media alone mails as "Jason
 *    from 404 Media", "Sam at 404 Media", "Emanuel at 404 Media", and so on.
 *  - `senderDomain` is recovered from the `lectern:from:<domain>` label and is
 *    the domain of the From address. It identifies a publication only when the
 *    publication owns the domain. On a hosting platform it identifies the
 *    PLATFORM: production has 57 issues under `ghost.io`, 31 under
 *    `substack.com`, 18 under `transistor.fm` — a dozen unrelated publications
 *    each.
 *
 * So neither field alone is a publication key; `publicationKey` combines them.
 */

/** Arrival instant: the publish date when the mailer set one, else save time. */
export function issueDate(card: Card): number {
	return Date.parse(card.publishedAt ?? card.savedAt);
}

/** The byline on an issue. Usually the sender's name, but it is extractor output
 * and may be missing entirely — see the module note. */
export function senderName(card: Card): string {
	return card.author?.trim() || 'Newsletter';
}

/**
 * Domains where the sender's address identifies the HOSTING PLATFORM, not the
 * publication. Mail from these must be grouped by something other than domain.
 *
 * Matched on the domain itself or any subdomain of it, so `mail.ghost.io` and
 * `email.mg2.substack.com` both resolve to their platform. The list is
 * necessarily incomplete — a platform not on it degrades to the old behaviour
 * (one merged shelf), which is a visible, fixable, one-line miss rather than a
 * silent wrong answer.
 */
const PLATFORM_DOMAINS: readonly string[] = [
	'beehiiv.com',
	'buttondown.com',
	'buttondown.email',
	'campaign-archive.com',
	'convertkit.com',
	'ck.page',
	'getrevue.co',
	'ghost.io',
	'kit.com',
	'klaviyomail.com',
	'list-manage.com',
	'mailchimp.com',
	'mailchimpapp.net',
	'mailerlite.com',
	'mailgun.org',
	'mcsv.net',
	'medium.com',
	'sendgrid.net',
	'sparkpostmail.com',
	'substack.com',
	'tinyletter.com',
	'transistor.fm'
];

/**
 * Mail-delivery subdomain prefixes that are noise in front of a real publication
 * domain: Ed Zitron's issues arrive from `ghost.wheresyoured.at`, which is the
 * same publication as `wheresyoured.at`. Stripped only while at least two labels
 * remain, so a domain is never reduced to a bare TLD.
 */
const MAIL_SUBDOMAINS = new Set([
	'e',
	'em',
	'email',
	'ghost',
	'link',
	'links',
	'list',
	'm',
	'mail',
	'mailer',
	'mg',
	'news',
	'newsletter',
	'send',
	'sender',
	'updates',
	'www'
]);

/** Lowercase, trim, and drop mail-delivery subdomain prefixes. Null when absent. */
function normalizeDomain(domain: string | null | undefined): string | null {
	let parts = (domain ?? '').trim().toLowerCase().replace(/\.+$/, '').split('.').filter(Boolean);
	while (parts.length > 2 && MAIL_SUBDOMAINS.has(parts[0] as string)) parts = parts.slice(1);
	return parts.length >= 2 ? parts.join('.') : null;
}

function isPlatformDomain(domain: string): boolean {
	return PLATFORM_DOMAINS.some((p) => domain === p || domain.endsWith('.' + p));
}

/**
 * Separators that join a byline to its publication: "Jason from 404 Media",
 * "Sam at 404 Media". The publication is the part after the LAST separator.
 *
 * Deliberately excludes " of ", which appears inside real publication names
 * ("Letters of Note") far more often than it separates a byline.
 */
const BYLINE_SEPARATOR = /\s+(?:from|at|@)\s+/i;

/**
 * The publication a byline belongs to, with its original casing — "Jason from
 * 404 Media" and "Sam at 404 Media" both yield "404 Media". Empty when the card
 * carries no byline at all.
 */
export function publicationName(card: Card): string {
	const author = card.author?.replace(/\s+/g, ' ').trim();
	if (!author) return '';
	const parts = author.split(BYLINE_SEPARATOR);
	return (parts[parts.length - 1] ?? author).trim() || author;
}

/** Fold a publication name to a comparable key: case, punctuation, and a leading
 *  "The" are all things one publication varies across issues. */
function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/^the\s+/, '');
}

/**
 * The stable grouping key for a publication.
 *
 * Two failure modes have to be avoided at once, and they pull in opposite
 * directions: grouping purely by domain merges every Ghost-hosted newsletter
 * into one "ghost.io" shelf, while grouping purely by byline splits 404 Media
 * across its six display names. So the domain decides WHICH key to use:
 *
 *  - A vanity domain IS the publication (`wheresyoured.at`, `404media.co`) —
 *    every byline under it belongs to one publication. Key on the domain.
 *  - A platform domain is not identity, so fall back to the publication parsed
 *    out of the byline ("Sam at 404 Media" -> "404 Media").
 *  - No domain at all (hand-saved or pre-`lectern:from:` cards): byline again.
 *
 * KNOWN LIMITATION. On a platform domain with NO byline there is nothing left on
 * the card that identifies a publication — `siteName` is null for ingested mail
 * (nothing emits `og:site_name`) and titles vary per issue. Such a card keys on
 * its own id, so it stands alone rather than joining a bogus "Newsletter" shelf
 * that would merge unrelated publications and report a fabricated cadence for
 * them. One shelf per orphaned issue is the honest failure. Fixing it properly
 * means carrying the full From address (or a List-Id) through ingestion.
 */
export function publicationKey(card: Card): string {
	const domain = normalizeDomain(card.senderDomain);
	if (domain && !isPlatformDomain(domain)) return `domain:${domain}`;
	const name = normalizeName(publicationName(card));
	if (name) return `pub:${name}`;
	return `card:${card.id}`;
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
	/** Stable grouping key (see `publicationKey`). The page filters a
	 * publication's issues by `publicationKey(card) === key`. */
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
		// Tally publication labels so a merged group shows a human name rather than
		// a bare domain — and the publication, not the byline, so a Ghost-hosted
		// 404 Media shelf reads "404 Media" and not "Jason from 404 Media".
		const name = publicationName(card) || senderName(card);
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
