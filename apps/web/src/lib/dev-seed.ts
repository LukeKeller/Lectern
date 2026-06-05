/**
 * Dev-only mock data. Seeds the local Dexie store with a believable spread of
 * cards so the Newspaper and Magazine views render with real content during
 * local development — no MiniFlux/Readeck backend required.
 *
 * - Newspaper: unread `feed` items, clustered on yesterday (the default edition)
 *   with a few on the day before so the date-nav has somewhere to go. Grouped by
 *   `siteName` into sections; the longest story becomes the lead.
 * - Magazine: tagged library items (`later`/`shortlist`/`archive`), 2+ per tag,
 *   so `buildMagazines` binds them into issues.
 *
 * Tree-shaken from production: the only caller guards on `import.meta.env.DEV`.
 */
import { Card } from '@lectern/shared';
import { db } from './db';
import { primeArticleCache } from './content';

const now = new Date();
function isoDaysAgo(days: number, hour: number, minute = 0): string {
	const d = new Date(now);
	d.setDate(d.getDate() - days);
	d.setHours(hour, minute, 0, 0);
	return d.toISOString();
}
function pic(seed: string, w: number, h: number): string {
	return `https://picsum.photos/seed/lectern-${seed}/${w}/${h}`;
}

// A small pool of genuine editorial prose, rotated per article so each body
// reads differently. Topic-neutral so it suits any headline.
const PARAS = [
	'There is a particular kind of attention that long-form reading asks of us, and it is becoming rare. Not the darting, surface-skimming attention of the feed, but the slower kind that lets an argument unfold at its own pace. The difference is not merely one of duration. It is a difference of posture.',
	'For most of the last decade the assumption was that more was better: more sources, more updates, more signals competing for the same scarce minutes. The cost of that abundance was rarely counted, because it did not show up on any dashboard. It showed up instead as a low, persistent hum of unfinished things.',
	'What changes when a page is built to be finished rather than scrolled forever? The reader stops bracing for the next interruption. The writer, knowing the reader will arrive at the end, can afford to build something with a shape — a beginning, a turn, a close.',
	'The craft is in the restraint. A good column does not shout; it sets a measure and holds it. The margins do real work, giving the eye somewhere to rest between thoughts. Typography that calls attention to itself has usually failed at its only job, which is to disappear.',
	'It is tempting to treat all of this as nostalgia, a longing for paper that the screen can never satisfy. But the appeal was never the paper. It was the contract paper implied: that the thing in your hands was finite, considered, and yours to finish on your own terms.',
	'Consider how differently we treat a printed page from a glowing one. We dog-ear it, we carry it to a chair by the window, we come back to the same passage twice. The medium invites a relationship rather than a transaction, and relationships are where meaning tends to accumulate.',
	'None of this requires abandoning the conveniences of software. It requires only that the software take a side. Most tools are built to maximize time-on-app; a reading tool, honestly made, should be built to send you away satisfied and a little changed.',
	'The quiet revolution, if there is one, will not announce itself. It will look like fewer notifications, smaller libraries, longer sittings. It will look like finishing things. And in the accumulation of finished things, slowly, a kind of literacy returns.',
	'So the question worth asking of any new reader, app, or shelf is not how much it can hold, but what it asks of you while you hold it. The best ones ask for your full attention and then, having earned it, get out of the way entirely.'
];
const PULL =
	'The medium invites a relationship rather than a transaction — and relationships are where meaning tends to accumulate.';

function articleHtml(title: string, seed: number, imgSeed: string): string {
	const n = PARAS.length;
	const p = (k: number) => PARAS[(seed + k) % n];
	return [
		`<p>${p(0)}</p>`,
		`<p>${p(1)}</p>`,
		`<h2>${title.split(' ').slice(0, 3).join(' ')}, reconsidered</h2>`,
		`<p>${p(2)}</p>`,
		`<blockquote>${PULL}</blockquote>`,
		`<p>${p(3)}</p>`,
		`<figure><img src="${pic(imgSeed + '-fig', 1200, 700)}" alt="" /><figcaption>An afternoon's reading, undisturbed.</figcaption></figure>`,
		`<p>${p(4)}</p>`,
		`<p>${p(5)}</p>`,
		`<p>${p(6)}</p>`
	].join('\n');
}

type Seed = {
	id: string;
	source: 'miniflux' | 'readeck';
	category: 'rss' | 'article';
	location: 'feed' | 'later' | 'shortlist' | 'archive';
	title: string;
	author: string;
	siteName: string;
	url: string;
	wordCount: number;
	savedAt: string;
	note?: string;
	tags?: string[];
	coverImage?: string;
};

// --- Newspaper: unread feed items, mostly dated yesterday -------------------
const FEED: Seed[] = [
	{
		id: 'miniflux:1',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'Why We Reread the Books We Already Love',
		author: 'Mariana Wolf',
		siteName: 'Aeon',
		url: 'https://aeon.co/essays/why-we-reread',
		wordCount: 3400,
		savedAt: isoDaysAgo(1, 6, 10),
		note: 'Rereading is not a failure of memory but a different way of knowing — we return not for the plot but for who we have become since.'
	},
	{
		id: 'miniflux:2',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'The Case for Slow Software',
		author: 'Devon Pratt',
		siteName: 'The Verge',
		url: 'https://www.theverge.com/slow-software',
		wordCount: 1400,
		savedAt: isoDaysAgo(1, 7, 30),
		note: 'What if the next great feature is the absence of one?'
	},
	{
		id: 'miniflux:3',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'Apple Quietly Doubles Down on On-Device Intelligence',
		author: 'Priya Raman',
		siteName: 'The Verge',
		url: 'https://www.theverge.com/apple-on-device',
		wordCount: 980,
		savedAt: isoDaysAgo(1, 8, 5)
	},
	{
		id: 'miniflux:4',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'E-Ink Tablets Finally Grow Up',
		author: 'Devon Pratt',
		siteName: 'The Verge',
		url: 'https://www.theverge.com/eink-tablets',
		wordCount: 1100,
		savedAt: isoDaysAgo(1, 9, 15)
	},
	{
		id: 'miniflux:5',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'Inside the New ARM Laptops Nobody Saw Coming',
		author: 'Greg Soto',
		siteName: 'Ars Technica',
		url: 'https://arstechnica.com/arm-laptops',
		wordCount: 1850,
		savedAt: isoDaysAgo(1, 8, 40),
		note: 'A long look at the silicon, the benchmarks, and the surprising battery math.'
	},
	{
		id: 'miniflux:6',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'The Quiet Return of RSS',
		author: 'Lena Hoffmann',
		siteName: 'Ars Technica',
		url: 'https://arstechnica.com/rss-returns',
		wordCount: 1200,
		savedAt: isoDaysAgo(1, 10, 20)
	},
	{
		id: 'miniflux:7',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'A New Proof Tidies Up the Gaps Between Primes',
		author: 'Hannah Cole',
		siteName: 'Quanta Magazine',
		url: 'https://www.quantamagazine.org/prime-gaps',
		wordCount: 1600,
		savedAt: isoDaysAgo(1, 7, 50),
		note: 'A young mathematician finds the structure hiding in the noise.'
	},
	{
		id: 'miniflux:8',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'The Hidden Geometry of Crowds',
		author: 'Yusuf Adeyemi',
		siteName: 'Quanta Magazine',
		url: 'https://www.quantamagazine.org/geometry-of-crowds',
		wordCount: 1450,
		savedAt: isoDaysAgo(1, 11, 0)
	},
	{
		id: 'miniflux:9',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'The Reading Habits of a Distracted Age',
		author: 'Eleanor Shaw',
		siteName: 'The Guardian',
		url: 'https://www.theguardian.com/reading-habits',
		wordCount: 1300,
		savedAt: isoDaysAgo(1, 9, 45),
		note: 'We read more words than any generation before us, and finish fewer of them.'
	},
	{
		id: 'miniflux:10',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'Independent Bookshops Are Quietly Thriving',
		author: 'Tom Ellery',
		siteName: 'The Guardian',
		url: 'https://www.theguardian.com/bookshops-thriving',
		wordCount: 900,
		savedAt: isoDaysAgo(1, 12, 10)
	},
	{
		id: 'miniflux:11',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'Show HN: I built a paper-feel reader for my own sanity',
		author: 'pgwhalen',
		siteName: 'Hacker News',
		url: 'https://news.ycombinator.com/item?id=demo11',
		wordCount: 600,
		savedAt: isoDaysAgo(1, 13, 0)
	},
	{
		id: 'miniflux:12',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'Ask HN: How do you actually read long-form anymore?',
		author: 'quietreader',
		siteName: 'Hacker News',
		url: 'https://news.ycombinator.com/item?id=demo12',
		wordCount: 520,
		savedAt: isoDaysAgo(1, 14, 30)
	},
	// A few from the day before, so "previous day" in the masthead isn't empty.
	{
		id: 'miniflux:13',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'The Browser That Refuses to Track You',
		author: 'Priya Raman',
		siteName: 'The Verge',
		url: 'https://www.theverge.com/private-browser',
		wordCount: 1250,
		savedAt: isoDaysAgo(2, 9, 0)
	},
	{
		id: 'miniflux:14',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'What a Single Photon Can Teach Us About Reality',
		author: 'Hannah Cole',
		siteName: 'Quanta Magazine',
		url: 'https://www.quantamagazine.org/single-photon',
		wordCount: 2100,
		savedAt: isoDaysAgo(2, 10, 30),
		note: 'The experiment is small. The implications are not.'
	},
	{
		id: 'miniflux:15',
		source: 'miniflux',
		category: 'rss',
		location: 'feed',
		title: 'The Long Afternoon of the Essay',
		author: 'Mariana Wolf',
		siteName: 'Aeon',
		url: 'https://aeon.co/essays/long-afternoon',
		wordCount: 2600,
		savedAt: isoDaysAgo(2, 8, 15)
	}
];

// --- Magazine: tagged library items, 2+ per tag -----------------------------
const LIBRARY: Seed[] = [
	{
		id: 'readeck:101',
		source: 'readeck',
		category: 'article',
		location: 'later',
		title: 'The Quiet Confidence of Good Typography',
		author: 'Sofia Marsh',
		siteName: 'A List Apart',
		url: 'https://alistapart.com/quiet-typography',
		wordCount: 2200,
		savedAt: isoDaysAgo(3, 11),
		tags: ['design'],
		coverImage: pic('type', 1200, 1600)
	},
	{
		id: 'readeck:102',
		source: 'readeck',
		category: 'article',
		location: 'shortlist',
		title: 'Whitespace Is Not Empty',
		author: 'Sofia Marsh',
		siteName: 'Smashing Magazine',
		url: 'https://smashingmagazine.com/whitespace',
		wordCount: 1500,
		savedAt: isoDaysAgo(6, 10),
		tags: ['design']
	},
	{
		id: 'readeck:103',
		source: 'readeck',
		category: 'article',
		location: 'later',
		title: 'Designing for the Last 10 Percent',
		author: 'Idris Bello',
		siteName: 'Increment',
		url: 'https://increment.com/last-ten-percent',
		wordCount: 2600,
		savedAt: isoDaysAgo(2, 16),
		tags: ['design', 'technology'],
		coverImage: pic('craft', 1200, 1600)
	},
	{
		id: 'readeck:104',
		source: 'readeck',
		category: 'article',
		location: 'later',
		title: 'What Sleep Does to a Sentence',
		author: 'Dr. Naomi Frank',
		siteName: 'Nautilus',
		url: 'https://nautil.us/sleep-and-sentences',
		wordCount: 1900,
		savedAt: isoDaysAgo(4, 9),
		tags: ['science'],
		coverImage: pic('sleep', 1200, 1600)
	},
	{
		id: 'readeck:105',
		source: 'readeck',
		category: 'article',
		location: 'archive',
		title: 'The Mathematics of a Good Cup of Coffee',
		author: 'Hannah Cole',
		siteName: 'Quanta Magazine',
		url: 'https://www.quantamagazine.org/coffee-math',
		wordCount: 1700,
		savedAt: isoDaysAgo(9, 8),
		tags: ['science']
	},
	{
		id: 'readeck:106',
		source: 'readeck',
		category: 'article',
		location: 'shortlist',
		title: 'How Migrating Birds Navigate by the Stars',
		author: 'Yusuf Adeyemi',
		siteName: 'Nautilus',
		url: 'https://nautil.us/birds-and-stars',
		wordCount: 2050,
		savedAt: isoDaysAgo(5, 14),
		tags: ['science'],
		coverImage: pic('birds', 1200, 1600)
	},
	{
		id: 'readeck:107',
		source: 'readeck',
		category: 'article',
		location: 'later',
		title: 'On the Ethics of Attention',
		author: 'Clara Devine',
		siteName: 'The Point',
		url: 'https://thepointmag.com/ethics-of-attention',
		wordCount: 2800,
		savedAt: isoDaysAgo(1, 17),
		tags: ['philosophy'],
		coverImage: pic('attention', 1200, 1600)
	},
	{
		id: 'readeck:108',
		source: 'readeck',
		category: 'article',
		location: 'archive',
		title: 'Boredom, Reconsidered',
		author: 'Clara Devine',
		siteName: 'Aeon',
		url: 'https://aeon.co/essays/boredom-reconsidered',
		wordCount: 2300,
		savedAt: isoDaysAgo(8, 12),
		tags: ['philosophy']
	},
	{
		id: 'readeck:109',
		source: 'readeck',
		category: 'article',
		location: 'later',
		title: 'The Self That Reads',
		author: 'Mariana Wolf',
		siteName: 'The Paris Review',
		url: 'https://theparisreview.org/self-that-reads',
		wordCount: 2400,
		savedAt: isoDaysAgo(3, 19),
		tags: ['philosophy', 'culture'],
		coverImage: pic('self', 1200, 1600)
	},
	{
		id: 'readeck:110',
		source: 'readeck',
		category: 'article',
		location: 'later',
		title: "The Web We Lost, and the One We're Building",
		author: 'Idris Bello',
		siteName: 'The Verge',
		url: 'https://www.theverge.com/web-we-lost',
		wordCount: 2700,
		savedAt: isoDaysAgo(2, 13),
		tags: ['technology'],
		coverImage: pic('web', 1200, 1600)
	},
	{
		id: 'readeck:111',
		source: 'readeck',
		category: 'article',
		location: 'shortlist',
		title: 'Local-First Software, Five Years On',
		author: 'Greg Soto',
		siteName: 'Ink & Switch',
		url: 'https://inkandswitch.com/local-first-five-years',
		wordCount: 3100,
		savedAt: isoDaysAgo(7, 10),
		tags: ['technology']
	},
	{
		id: 'readeck:112',
		source: 'readeck',
		category: 'article',
		location: 'archive',
		title: 'Against the Infinite Feed',
		author: 'Eleanor Shaw',
		siteName: 'The Guardian',
		url: 'https://www.theguardian.com/against-the-feed',
		wordCount: 1800,
		savedAt: isoDaysAgo(4, 15),
		tags: ['technology', 'culture']
	}
];

function toCard(s: Seed, idx: number): Card {
	const readingTimeMinutes = Math.max(1, Math.round(s.wordCount / 200));
	return Card.parse({
		id: s.id,
		source: s.source,
		sourceId: s.id.split(':')[1],
		category: s.category,
		location: s.location,
		readState: 'unopened',
		title: s.title,
		excerpt: s.note ?? null,
		author: s.author,
		siteName: s.siteName,
		url: s.url,
		coverImage: s.coverImage ?? null,
		wordCount: s.wordCount,
		readingTimeMinutes,
		tags: s.tags ?? [],
		note: s.note ?? null,
		savedAt: s.savedAt,
		updatedAt: s.savedAt,
		publishedAt: s.savedAt,
		// keep a deterministic spread of "freshness" without affecting grouping
		readingProgress: idx % 7 === 0 ? 0.15 : 0
	});
}

let seeded = false;

/** Seed the local store with mock cards if it is empty. Dev-only, idempotent. */
export async function seedMockData(): Promise<void> {
	if (!import.meta.env.DEV || seeded) return;
	seeded = true;
	const existing = await db.cards.count();
	if (existing > 0) return;

	const all = [...FEED, ...LIBRARY];
	const cards = all.map(toCard);
	await db.cards.bulkPut(cards);

	const articles: Record<string, string> = {};
	all.forEach((s, i) => {
		articles[s.id] = articleHtml(s.title, i, s.id.replace(':', '-'));
	});
	primeArticleCache(articles);

	console.info(`[lectern dev] seeded ${cards.length} mock cards (newspaper + magazine)`);
}
