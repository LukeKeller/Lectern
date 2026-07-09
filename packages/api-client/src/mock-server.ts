import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  Card,
  Highlight,
  PlayerState,
  endpoints,
  type BulkMaintenanceRequest,
  type CreateHighlightRequest,
  type CreateViewRequest,
  type EmailIgnoreSenderRequest,
  type EmailSender,
  type Endpoint,
  type ImportReadwiseRequest,
  type SaveDocumentRequest,
  type SetFeedNotificationRequest,
  type SubscribeFeedRequest,
  type SynthesizeAudioRequest,
  type SyncPushRequest,
  type TtsPreviewRequest,
  type UpdateDocumentRequest,
  type UpdateFeedRequest,
  type UpdateTtsSettingsRequest,
  type UpdateViewRequest,
} from "@lectern/shared";

/**
 * A dependency-light mock server that serves contract-valid fixtures for every
 * endpoint in the shared API registry (`endpoints`). Dispatch is DERIVED from the
 * registry: each operation maps to a fixture handler keyed by `operationId`, the
 * router matches the request against the registry's method+path, validates the
 * request body and the success response against the contract, and a load-time
 * check throws if any registry endpoint lacks a handler — so the mock cannot drift
 * from the contract the way the old hand-rolled if-chain did.
 */

const NOW = "2026-06-03T12:00:00Z";

// Feed timestamps are relative to the real clock so the daily Newspaper opens to
// a populated edition (its default is yesterday's unread feed items) during
// frontend dev. Noon avoids day-boundary timezone drift.
// Newsletter arrivals pass a morning `hour` so two same-day issues keep distinct times.
function daysAgo(n: number, hour = 12): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function sampleCard(overrides: Partial<Card> = {}): Card {
  return Card.parse({
    id: "card_1",
    source: "readeck",
    sourceId: "rd_1",
    category: "article",
    location: "later",
    title: "Sample article",
    author: "Jane Doe",
    siteName: "example.com",
    url: "https://example.com/sample",
    wordCount: 1840,
    readingTimeMinutes: 8,
    readingProgress: 0.25,
    tags: ["sample"],
    savedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

// A varied set so the UI can be developed against realistic data.
function sampleCards(): Card[] {
  const base = [
    {
      title: "The quiet death of the web we knew",
      excerpt:
        "The open web that shaped a generation is being quietly replaced by walled gardens and algorithmic feeds. Here's what we lose, and what we might do about it.",
      siteName: "danluu.com",
      author: "Dan Luu",
      category: "article",
      source: "readeck",
      location: "later",
      wordCount: 4314,
      readingTimeMinutes: 21,
      readingProgress: 0.42,
      tags: ["tech", "longread"],
    },
    {
      title: "A Complete Guide to useEffect",
      excerpt:
        "Effects are not lifecycle methods. Once you stop fighting the model and start thinking in synchronization, useEffect becomes far more predictable.",
      siteName: "overreacted.io",
      author: "Dan Abramov",
      category: "article",
      source: "readeck",
      location: "shortlist",
      wordCount: 10198,
      readingTimeMinutes: 50,
      readingProgress: 0,
      tags: ["react", "tech"],
    },
    {
      title: "Microsoft's new MAI models",
      excerpt:
        "Microsoft quietly shipped its first in-house foundation models this week, signalling a shift away from sole reliance on OpenAI for its Copilot stack.",
      siteName: "Simon Willison's Weblog",
      author: "Simon Willison",
      category: "rss",
      source: "miniflux",
      location: "feed",
      wordCount: 620,
      readingTimeMinutes: 3,
      readingProgress: 0,
      savedAt: daysAgo(1),
      tags: [],
    },
    {
      title: "How web bloat impacts users with slow devices",
      siteName: "danluu.com",
      author: "Dan Luu",
      category: "article",
      source: "readeck",
      location: "archive",
      wordCount: 5200,
      readingTimeMinutes: 26,
      readingProgress: 1,
      tags: ["performance"],
    },
    {
      title: "The Best Code is No Code At All",
      siteName: "Coding Horror",
      author: "Jeff Atwood",
      category: "article",
      source: "readeck",
      location: "inbox",
      wordCount: 728,
      readingTimeMinutes: 3,
      readingProgress: 0,
      tags: [],
    },
    {
      title: "Weeknotes: a new release",
      siteName: "Simon Willison's Weblog",
      author: "Simon Willison",
      category: "rss",
      source: "miniflux",
      location: "feed",
      wordCount: 1100,
      readingTimeMinutes: 5,
      readingProgress: 0.1,
      savedAt: daysAgo(1),
      tags: ["weeknotes"],
    },
    {
      title: "The case for memory-safe systems languages",
      siteName: "The Pragmatic Engineer",
      author: "Gergely Orosz",
      category: "rss",
      source: "miniflux",
      location: "feed",
      wordCount: 2200,
      readingTimeMinutes: 11,
      readingProgress: 0,
      savedAt: daysAgo(1),
      tags: [],
    },
    {
      title: "What I learned shipping a CLI to a million users",
      siteName: "The Pragmatic Engineer",
      author: "Gergely Orosz",
      category: "rss",
      source: "miniflux",
      location: "feed",
      wordCount: 1600,
      readingTimeMinutes: 8,
      readingProgress: 0,
      savedAt: daysAgo(1),
      tags: [],
    },
    {
      title: "A field guide to small, sharp tools",
      siteName: "Increment",
      author: "Editorial",
      category: "rss",
      source: "miniflux",
      location: "feed",
      wordCount: 900,
      readingTimeMinutes: 4,
      readingProgress: 0,
      savedAt: daysAgo(1),
      tags: [],
    },
    {
      title: "Designing data-intensive applications, revisited",
      siteName: "martin.kleppmann.com",
      author: "Martin Kleppmann",
      category: "article",
      source: "readeck",
      location: "later",
      wordCount: 6100,
      readingTimeMinutes: 30,
      readingProgress: 0,
      tags: ["tech", "longread"],
    },
    {
      title: "Profiling React renders without losing your mind",
      siteName: "overreacted.io",
      author: "Dan Abramov",
      category: "article",
      source: "readeck",
      location: "archive",
      wordCount: 3400,
      readingTimeMinutes: 17,
      readingProgress: 1,
      tags: ["react", "performance"],
    },
  ] as const;
  const articles = base.map((b, i) =>
    sampleCard({
      ...b,
      id: `card_${i + 1}`,
      sourceId: `${b.source}_${i + 1}`,
      url: `https://${b.siteName.includes(".") ? b.siteName : "example.com"}/post-${i + 1}`,
      tags: [...b.tags],
    }),
  );
  return [...articles, ...emailCards()].filter((c) => !mockDeletedEmailIds.has(c.id));
}

// Newsletter issues as the Readeck email pipeline produces them: `author` (and a
// tag) carry the sender label, siteName is null, coverImage is null (one exception
// exercises the thumbnail path), and the synthetic newsletter.lectern.local URL
// never resolves — an email has no canonical web copy. Arrival dates are relative
// to the real clock so the publication rack and its date dividers stay exercised:
// two today, two yesterday, the rest tapering back over the past three weeks.
function emailCards(): Card[] {
  const issues = [
    {
      id: "email_1",
      sender: "Money Stuff",
      title: "The Bond Villains Have Lawyers Now",
      excerpt:
        "If you sell a derivative whose entire purpose is to evade a rule, you should probably not name it after the rule.",
      slug: "money-stuff-the-bond-villains-have-lawyers-now",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 3400,
      readingTimeMinutes: 16,
      savedAt: daysAgo(0, 8),
      publishedAt: daysAgo(0, 8),
      coverImage: null,
    },
    {
      id: "email_2",
      sender: "Money Stuff",
      title: "Private Credit Is Eating the World Politely",
      excerpt:
        "The nice thing about private credit is that nobody has to mark anything down until everyone has agreed on a story.",
      slug: "money-stuff-private-credit-is-eating-the-world-politely",
      location: "inbox",
      readState: "reading",
      readingProgress: 0.35,
      wordCount: 3100,
      readingTimeMinutes: 14,
      savedAt: daysAgo(3),
      publishedAt: daysAgo(3),
      coverImage: null,
    },
    {
      id: "email_3",
      sender: "Money Stuff",
      title: "Insider Trading on the Group Chat",
      excerpt:
        "A good rule of thumb is that if your trading strategy requires a group chat named “definitely not insider trading,” it is insider trading.",
      slug: "money-stuff-insider-trading-on-the-group-chat",
      location: "archive",
      readState: "finished",
      readingProgress: 1,
      wordCount: 2900,
      readingTimeMinutes: 13,
      savedAt: daysAgo(16),
      publishedAt: daysAgo(16),
      coverImage: null,
    },
    {
      id: "email_4",
      sender: "Morning Brew",
      title: "Streaming's Bundle Era Comes Full Circle",
      excerpt:
        "The cable bundle died so that the streaming bundle could be born, and somehow it costs more now.",
      slug: "morning-brew-streamings-bundle-era",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 980,
      readingTimeMinutes: 4,
      savedAt: daysAgo(0, 6),
      publishedAt: daysAgo(0, 6),
      coverImage: null,
    },
    {
      id: "email_5",
      sender: "Morning Brew",
      title: "The Fed Blinks, Markets Shrug",
      excerpt: "Rate cuts used to move markets; now they barely move the group chat.",
      slug: "morning-brew-the-fed-blinks",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 920,
      readingTimeMinutes: 4,
      savedAt: daysAgo(1, 6),
      publishedAt: daysAgo(1, 6),
      coverImage: null,
    },
    {
      id: "email_6",
      sender: "Morning Brew",
      title: "Retail's Returns Problem Gets Expensive",
      excerpt: "Free returns were never free, and retailers have finally done the math out loud.",
      slug: "morning-brew-retails-returns-problem",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 1050,
      readingTimeMinutes: 5,
      savedAt: daysAgo(4),
      publishedAt: daysAgo(4),
      coverImage: null,
    },
    {
      id: "email_7",
      sender: "Morning Brew",
      title: "Chipmakers Can't Hire Fast Enough",
      excerpt: "There are more fabs under construction than people who know how to run them.",
      slug: "morning-brew-chipmakers-cant-hire",
      location: "archive",
      readState: "finished",
      readingProgress: 1,
      wordCount: 870,
      readingTimeMinutes: 4,
      savedAt: daysAgo(11),
      publishedAt: daysAgo(11),
      coverImage: null,
    },
    {
      id: "email_8",
      sender: "Stratechery",
      title: "Aggregation Theory and the Agent Era",
      excerpt:
        "Agents change who owns demand, which means they change everything about who captures value on the internet.",
      slug: "stratechery-aggregation-theory-and-the-agent-era",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 2600,
      readingTimeMinutes: 12,
      savedAt: daysAgo(1, 9),
      publishedAt: daysAgo(1, 9),
      // The one email with a cover, so the list thumbnail path gets exercised.
      coverImage: "https://picsum.photos/seed/stratechery-agents/640/360",
    },
    {
      id: "email_9",
      sender: "Stratechery",
      title: "Nvidia Earnings and the Compute Overhang",
      excerpt:
        "The market is no longer asking whether demand for compute is real, but who ends up holding the depreciation.",
      slug: "stratechery-nvidia-earnings-and-the-compute-overhang",
      location: "archive",
      readState: "finished",
      readingProgress: 1,
      wordCount: 2800,
      readingTimeMinutes: 13,
      savedAt: daysAgo(8),
      // No publish date from the backend: exercises the savedAt fallback.
      publishedAt: null,
      coverImage: null,
    },
    {
      id: "email_10",
      sender: "The Pragmatic Engineer",
      title: "Inside the Big Tech Hiring Rebound",
      excerpt:
        "After two years of frozen headcount, the hiring pipelines at the biggest tech companies are quietly moving again.",
      slug: "pragmatic-engineer-big-tech-hiring-rebound",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 3500,
      readingTimeMinutes: 16,
      savedAt: daysAgo(5),
      publishedAt: daysAgo(5),
      coverImage: null,
    },
    {
      id: "email_11",
      sender: "The Pragmatic Engineer",
      title: "What Staff Engineers Actually Do",
      excerpt:
        "Ask five companies what a staff engineer does and you will get seven answers, two of them from the same company.",
      slug: "pragmatic-engineer-what-staff-engineers-actually-do",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 3200,
      readingTimeMinutes: 15,
      savedAt: daysAgo(19),
      publishedAt: daysAgo(19),
      coverImage: null,
    },
    {
      id: "email_12",
      sender: "Garbage Day",
      title: "The Algorithm Has a Podcast Now",
      excerpt:
        "Every platform eventually becomes a talk show, and this week three of them did it at once.",
      slug: "garbage-day-the-algorithm-has-a-podcast-now",
      location: "inbox",
      readState: "unopened",
      readingProgress: 0,
      wordCount: 1400,
      readingTimeMinutes: 7,
      savedAt: daysAgo(2),
      publishedAt: daysAgo(2),
      coverImage: null,
    },
  ] as const;
  return issues.map((issue) =>
    sampleCard({
      id: issue.id,
      sourceId: `rd_${issue.id}`,
      source: "readeck",
      category: "email",
      location: issue.location,
      readState: issue.readState,
      readingProgress: issue.readingProgress,
      title: issue.title,
      excerpt: issue.excerpt,
      author: issue.sender,
      siteName: null,
      url: `https://newsletter.lectern.local/${issue.slug}`,
      coverImage: issue.coverImage,
      wordCount: issue.wordCount,
      readingTimeMinutes: issue.readingTimeMinutes,
      tags: [issue.sender],
      savedAt: issue.savedAt,
      updatedAt: issue.savedAt,
      publishedAt: issue.publishedAt,
    }),
  );
}

function sampleHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return Highlight.parse({
    id: `hl_${Math.random().toString(36).slice(2, 9)}`,
    documentId: "card_1",
    text: "highlighted text",
    startSelector: "main>p:nth-child(1)",
    startOffset: 0,
    endSelector: "main>p:nth-child(1)",
    endOffset: 16,
    createdAt: NOW,
    ...overrides,
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
} as const;

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS_HEADERS });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

// In-memory TTS config for dev. Pre-configured so the Listen flow is exercisable
// without a real key; the audio endpoint returns placeholder bytes.
const mockTts = {
  apiKey: "mock-key" as string | null,
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_flash_v2_5",
};
let mockPlayer = PlayerState.parse({});
// In-memory newsletter ignore state for dev. Ignoring a sender deletes its email
// cards (as production does): their ids are tombstoned here, dropped from every
// listing, and reported by /sync pull in `deletedIds`. Un-ignoring never
// resurrects them. `known` is derived from the live email fixtures so the
// per-sender counts can never drift from the cards actually served.
let mockEmailIgnore: string[] = [];
const mockDeletedEmailIds = new Set<string>();

function emailKnown(): EmailSender[] {
  const counts = new Map<string, number>();
  for (const card of emailCards()) {
    if (mockDeletedEmailIds.has(card.id)) continue;
    const name = card.author ?? "Newsletter";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}
// In-memory podcast state for dev: a feed token + the set of published doc ids.
let mockPodcastToken = "mocktoken";
const mockPodcast = new Set<string>();

// In-memory discovery state for dev: a few candidates, settings, profile, and the
// most-recent run so the Discover view and Activity page render real content.
interface MockCandidate {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  fetcher: "searxng" | "brave" | "crawl";
  score: number;
  status: "active" | "dismissed" | "saved";
  vote: "up" | "down" | null;
  runId: string | null;
  author: string | null;
  siteName: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
}
const mockCandidates: MockCandidate[] = [
  {
    id: "disc:1",
    url: "https://example.com/rust-async-internals",
    title: "How async/await actually works in Rust",
    excerpt: "A tour of the state-machine transform behind Rust's futures…",
    fetcher: "searxng",
    score: 0.82,
    status: "active",
    vote: null,
    runId: "run:mock",
    author: "Jane Dev",
    siteName: "example.com",
    imageUrl: "https://picsum.photos/seed/rust/640/320",
    publishedAt: "2026-07-01T00:00:00.000Z",
    firstSeenAt: "2026-07-08T00:00:00.000Z",
  },
  {
    id: "disc:2",
    url: "https://example.org/homelab-backup-strategy",
    title: "A pragmatic homelab backup strategy",
    excerpt: "3-2-1 backups without spending a fortune on cloud storage…",
    fetcher: "searxng",
    score: 0.71,
    status: "active",
    vote: null,
    runId: "run:mock",
    author: null,
    siteName: "example.org",
    imageUrl: null,
    publishedAt: null,
    firstSeenAt: "2026-07-08T00:00:00.000Z",
  },
];
let mockDiscoverySettings: Record<string, unknown> = {
  enabled: false,
  topics: ["rust", "homelab", "self-hosting"],
  seedUrls: [],
  fetchers: { searxng: true, brave: false, crawl: false },
  schedule: "0 */6 * * *",
  searxngUrl: "",
  braveConfigured: false,
  crawlDepth: 1,
  crawlTimeMs: 30000,
  rocchio: { a: 1, b: 0.75, c: 0.25 },
  targetCount: 5,
};
const mockDiscoveryProfile = {
  name: "default",
  vector: { rust: 0.6, homelab: 0.4 },
  idf: {},
  docCount: 42,
  seededAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:00.000Z",
  lastVoteProcessedAt: null,
};
let mockRun = {
  id: "run:mock",
  status: "succeeded" as "running" | "succeeded" | "failed",
  stage: "done",
  trigger: "manual" as "cron" | "manual",
  stats: {
    fetched: 40,
    deduped: 12,
    scored: 12,
    extracted: 12,
    inserted: 2,
    perFetcher: { searxng: 40 } as Record<string, number>,
  },
  error: null as string | null,
  startedAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:05.000Z",
  finishedAt: "2026-07-08T00:00:05.000Z" as string | null,
};

type MockContext = { params: Record<string, string>; query: URLSearchParams; body: unknown };
type MockResult = {
  status?: number;
  json?: unknown;
  binary?: { contentType: string; bytes: Buffer; headers?: Record<string, string> };
};
type MockHandler = (ctx: MockContext) => MockResult | Promise<MockResult>;

const TTS_UNCONFIGURED: MockResult = { status: 409, json: { error: "TTS is not configured" } };

function ttsSettings(): MockResult {
  return {
    json: { configured: !!mockTts.apiKey, voiceId: mockTts.voiceId, modelId: mockTts.modelId },
  };
}

const ARTICLE = [
  "<h2>Introduction</h2>",
  "<p>This opening paragraph is long enough to read comfortably and to select text within for highlighting during development.</p>",
  "<p>A second paragraph continues the thought so the reader has several blocks to focus and navigate between with the keyboard.</p>",
  "<h2>Background</h2>",
  "<p>Background paragraph one sets the context in a few sentences of sample prose used while building the reading view.</p>",
  "<p>Background paragraph two adds detail, giving the table of contents and paragraph focus real material to work with.</p>",
  "<h3>Finer points</h3>",
  "<p>A nested subsection paragraph, addressed by an h3 entry in the table of contents.</p>",
  "<blockquote>A short pull quote to vary the block types within the article body.</blockquote>",
  "<h2>Conclusion</h2>",
  "<p>The closing paragraph wraps things up and gives the reader a final block to land on.</p>",
].join("");

// Newsletter-shaped body so the reader's email affordances (sender header, dead
// "open original" link, footer) render against honest material.
function newsletterHtml(title: string, sender: string): string {
  return [
    `<p>Good morning. This is ${sender}, and today's issue is about why “${title}” is the story everyone in the industry is quietly rereading. The details matter more than the headline, so let's take it from the top.</p>`,
    "<h2>The lead</h2>",
    `<p>The thing about this story is that everyone saw it coming and nobody priced it in. <a href="https://newsletter.lectern.local/archive">Last month's issue</a> walked through the early signals; this week the other shoe dropped, and the people involved are now saying the quiet part in regulatory filings.</p>`,
    "<blockquote>The lesson, as always, is that incentives explain ninety percent of behavior, and the other ten percent is paperwork.</blockquote>",
    "<h2>What else is happening</h2>",
    `<p>Elsewhere: a merger nobody asked for, an earnings call that was mostly vibes, and a <a href="https://newsletter.lectern.local/links">round-up of links</a> worth your weekend. None of it is as interesting as the lead, which is why it is down here.</p>`,
    `<img src="https://picsum.photos/seed/${encodeURIComponent(sender)}/640/320" alt="Chart of the week" />`,
    `<p>That's all for this issue. See you in the next one. — ${sender}</p>`,
    "<p>You are receiving this because you subscribed.</p>",
  ].join("");
}

/**
 * Fixture handlers keyed by the registry's `operationId`. Each returns a plain
 * object the router validates against the endpoint's response schema (so a fixture
 * that drifts from the contract fails loudly), or a `binary`/`status` override for
 * audio and error paths.
 */
const handlers: Record<string, MockHandler> = {
  // ---- documents ----
  listDocuments: () => ({
    json: { results: sampleCards(), nextCursor: null, count: sampleCards().length },
  }),
  search: ({ query }) => {
    const q = query.get("q") ?? "";
    const first = sampleCards()[0]!;
    return {
      json: { results: q ? [{ id: first.id, snippet: `…matches “${q}”…`, rank: 1 }] : [] },
    };
  },
  saveDocument: ({ body }) => {
    const input = body as SaveDocumentRequest;
    return {
      json: sampleCard({
        id: "card_new",
        url: input.url,
        location: input.location,
        tags: input.tags,
      }),
    };
  },
  getDocument: ({ params }) => ({
    json: sampleCards().find((c) => c.id === params.id) ?? sampleCard({ id: params.id }),
  }),
  updateDocument: ({ params, body }) => ({
    json: sampleCard({ id: params.id, ...(body as UpdateDocumentRequest) }),
  }),
  deleteDocument: () => ({}),
  bulkDeleteDocuments: () => ({ json: { deleted: 0 } }),
  bulkMaintenance: ({ body }) => ({
    json: { action: (body as BulkMaintenanceRequest).action, affected: 0 },
  }),
  getEmailIgnore: () => ({ json: { senders: [...mockEmailIgnore], known: emailKnown() } }),
  addEmailIgnore: ({ body }) => {
    const sender = (body as EmailIgnoreSenderRequest).sender;
    if (!mockEmailIgnore.some((s) => s.toLowerCase() === sender.toLowerCase()))
      mockEmailIgnore.push(sender);
    // Production deletes the sender's already-ingested emails: tombstone their
    // ids so listings drop them and the next /sync pull returns them in
    // `deletedIds`. removeEmailIgnore never brings them back.
    const removed = emailCards().filter(
      (c) =>
        (c.author ?? "").toLowerCase() === sender.toLowerCase() && !mockDeletedEmailIds.has(c.id),
    );
    for (const c of removed) mockDeletedEmailIds.add(c.id);
    return {
      json: { senders: [...mockEmailIgnore], known: emailKnown(), removed: removed.length },
    };
  },
  removeEmailIgnore: ({ body }) => {
    const sender = (body as EmailIgnoreSenderRequest).sender;
    mockEmailIgnore = mockEmailIgnore.filter((s) => s.toLowerCase() !== sender.toLowerCase());
    return { json: { senders: [...mockEmailIgnore], known: emailKnown() } };
  },
  getDocumentContent: ({ params }) => {
    const card = sampleCards().find((c) => c.id === params.id);
    const html =
      card?.category === "email"
        ? newsletterHtml(card.title, card.author ?? "Newsletter")
        : ARTICLE;
    return { json: { id: params.id, html: `<main>${html}</main>` } };
  },
  getDocumentAccent: () => ({ json: { color: null } }),
  // A realistic full re-skin sample so `pnpm dev` actually shows the source-theming
  // feature (accent + background + text/link colours + fonts + favicon + site name)
  // instead of a bare null theme.
  getSourceTheme: () => ({
    json: {
      accent: "#c2410c",
      accentDark: "#fb923c",
      background: "#f4ecd8",
      backgroundDark: "#1b1a17",
      text: "#2b2620",
      link: "#c2410c",
      bodyFont: "Georgia",
      displayFont: "Playfair Display",
      faviconUrl: "https://lectern.example/favicon.png",
      siteName: "The Lectern Post",
      derivation: "literal",
    },
  }),
  listSourceThemes: () => ({
    json: {
      themes: [
        {
          host: "lectern.example",
          accent: "#c2410c",
          accentDark: "#fb923c",
          background: "#f4ecd8",
          backgroundDark: "#1b1a17",
          text: "#2b2620",
          link: "#c2410c",
          bodyFont: "Georgia",
          displayFont: "Playfair Display",
          faviconUrl: "https://lectern.example/favicon.png",
          siteName: "The Lectern Post",
          derivation: "literal",
          fetchedAt: NOW,
        },
        {
          host: "overreacted.io",
          accent: "#2563eb",
          accentDark: "#60a5fa",
          background: "#eff4fb",
          backgroundDark: "#0f172a",
          text: null,
          link: "#2563eb",
          bodyFont: null,
          displayFont: "Inter",
          faviconUrl: "https://overreacted.io/favicon.png",
          siteName: "overreacted",
          derivation: "derived",
          fetchedAt: NOW,
        },
      ],
    },
  }),
  clearSourceThemes: () => ({}),
  importReadwise: ({ body }) => {
    const total = (body as ImportReadwiseRequest).csv
      .split("\n")
      .filter((l) => /https?:\/\//.test(l)).length;
    return { json: { total, imported: total, failed: 0 } };
  },
  // ---- highlights ----
  listHighlights: () => ({ json: { highlights: [] } }),
  createHighlight: ({ params, body }) => ({
    json: sampleHighlight({ documentId: params.id, ...(body as CreateHighlightRequest) }),
  }),
  deleteHighlight: () => ({}),
  // ---- tags ----
  listTags: () => ({ json: { tags: [{ name: "sample", count: 1 }] } }),
  // ---- views ----
  listViews: () => ({ json: { views: [] } }),
  createView: ({ body }) => ({
    json: { id: "view_new", createdAt: NOW, updatedAt: NOW, ...(body as CreateViewRequest) },
  }),
  updateView: ({ params, body }) => ({
    json: {
      id: params.id,
      name: "Mock view",
      query: { kind: "term", field: "location", op: "eq", value: "later" },
      createdAt: NOW,
      updatedAt: NOW,
      ...(body as UpdateViewRequest),
    },
  }),
  deleteView: () => ({}),
  // ---- sync ----
  syncPull: () => ({
    json: { cards: sampleCards(), deletedIds: [...mockDeletedEmailIds], cursor: "1" },
  }),
  syncPush: ({ body }) => ({
    json: { applied: (body as SyncPushRequest).mutations.length, conflicts: [] },
  }),
  forceSync: () => {
    const cards = sampleCards();
    return {
      json: {
        miniflux: cards.filter((c) => c.source === "miniflux").length,
        readeck: cards.filter((c) => c.source === "readeck").length,
        tombstoned: mockDeletedEmailIds.size,
      },
    };
  },
  // ---- feeds ----
  listFeeds: () => ({
    json: {
      // Mirror the publications behind the sample feed cards (matched by siteName)
      // so the sidebar feed tree shows realistic folders + counts.
      feeds: [
        {
          id: "feed_1",
          title: "Simon Willison's Weblog",
          feedUrl: "https://simonwillison.net/atom/everything/",
          siteUrl: "https://simonwillison.net",
          folderId: "folder_tech",
          folderTitle: "Tech",
          unreadCount: 2,
        },
        {
          id: "feed_2",
          title: "The Pragmatic Engineer",
          feedUrl: "https://newsletter.pragmaticengineer.com/feed",
          siteUrl: "https://newsletter.pragmaticengineer.com",
          folderId: "folder_tech",
          folderTitle: "Tech",
          unreadCount: 2,
        },
        {
          id: "feed_3",
          title: "Increment",
          feedUrl: "https://increment.com/feed.xml",
          siteUrl: "https://increment.com",
          folderId: "folder_design",
          folderTitle: "Design",
          unreadCount: 1,
        },
      ],
      folders: [
        { id: "folder_tech", title: "Tech", unreadCount: 4 },
        { id: "folder_design", title: "Design", unreadCount: 1 },
      ],
    },
  }),
  subscribeFeed: ({ body }) => {
    const input = body as SubscribeFeedRequest;
    return {
      json: {
        id: "feed_new",
        title: "New Feed",
        feedUrl: input.feedUrl,
        folderId: input.folderId ?? null,
      },
    };
  },
  updateFeed: ({ params, body }) => {
    const patch = body as UpdateFeedRequest;
    return {
      json: {
        id: params.id,
        title: patch.title ?? "Example Feed",
        feedUrl: "https://example.com/rss",
        folderId: patch.folderId ?? null,
      },
    };
  },
  deleteFeed: () => ({}),
  refreshFeeds: () => ({}),
  importOpml: () => ({ json: { message: "Feeds imported." } }),
  // ---- web push notifications ----
  getPushPublicKey: () => ({ json: { publicKey: "mock-vapid-public-key" } }),
  registerPushSubscription: () => ({ json: { ok: true } }),
  unregisterPushSubscription: () => ({ json: { ok: true } }),
  getFeedNotifications: () => ({ json: { feeds: [] } }),
  setFeedNotification: ({ params, body }) => ({
    json: { feedId: params.feedId, enabled: (body as SetFeedNotificationRequest).enabled },
  }),
  // ---- text-to-speech ("Listen") ----
  getTtsSettings: () => ttsSettings(),
  updateTtsSettings: ({ body }) => {
    const patch = body as UpdateTtsSettingsRequest;
    if (patch.apiKey !== undefined) mockTts.apiKey = patch.apiKey ? patch.apiKey : null;
    if (patch.voiceId !== undefined) mockTts.voiceId = patch.voiceId;
    if (patch.modelId !== undefined) mockTts.modelId = patch.modelId;
    return ttsSettings();
  },
  listTtsVoices: () =>
    mockTts.apiKey
      ? {
          json: {
            voices: [
              { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
              { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
            ],
          },
        }
      : TTS_UNCONFIGURED,
  getTtsUsage: () =>
    mockTts.apiKey
      ? {
          json: {
            tier: "creator",
            status: "active",
            characterCount: 12_000,
            characterLimit: 100_000,
            nextResetAt: NOW,
          },
        }
      : TTS_UNCONFIGURED,
  previewTtsVoice: ({ body }) => {
    if (!mockTts.apiKey) return TTS_UNCONFIGURED;
    const voiceId = (body as TtsPreviewRequest).voiceId;
    return {
      binary: {
        contentType: "audio/mpeg",
        bytes: Buffer.from(`mock-preview:${voiceId}`),
        headers: { "x-tts-content-hash": `mockpreview_${voiceId}` },
      },
    };
  },
  synthesizeAudio: ({ params }) => {
    if (!mockTts.apiKey) return TTS_UNCONFIGURED;
    return {
      binary: {
        contentType: "audio/mpeg",
        bytes: Buffer.from(`mock-audio:${params.id}`),
        headers: { "x-tts-content-hash": `mockhash_${params.id}` },
      },
    };
  },
  addPodcastEpisode: ({ params, body }) => {
    const id = params.id!;
    if (!mockTts.apiKey) return TTS_UNCONFIGURED;
    mockPodcast.add(id);
    return {
      json: {
        documentId: id,
        title: (body as SynthesizeAudioRequest).title ?? `Article ${id}`,
        durationSeconds: 180,
        byteLength: 2_880_000,
        addedAt: new Date().toISOString(),
      },
    };
  },
  getPodcastSettings: () => ({
    json: {
      feedUrl: `http://localhost/podcast/${mockPodcastToken}/feed.xml`,
      episodeCount: mockPodcast.size,
    },
  }),
  regeneratePodcastFeed: () => {
    mockPodcastToken = `mocktoken-${mockPodcast.size}`;
    return {
      json: {
        feedUrl: `http://localhost/podcast/${mockPodcastToken}/feed.xml`,
        episodeCount: mockPodcast.size,
      },
    };
  },
  getPlayerState: () => ({ json: mockPlayer }),
  savePlayerState: ({ body }) => {
    mockPlayer = PlayerState.parse({ ...(body as object), updatedAt: new Date().toISOString() });
    return { json: mockPlayer };
  },

  // ---- discovery ----
  listCandidates: ({ query }) => {
    const status = query.get("status");
    const list = status ? mockCandidates.filter((c) => c.status === status) : mockCandidates;
    return { json: { candidates: list } };
  },
  voteCandidate: ({ params, body }) => {
    const value = (body as { value: "up" | "down" }).value;
    const c = mockCandidates.find((x) => x.id === params.id);
    if (!c) return { status: 404, json: { message: "not found" } };
    c.vote = value;
    if (value === "down") c.status = "dismissed";
    return { json: c };
  },
  saveCandidate: ({ params }) => {
    const c = mockCandidates.find((x) => x.id === params.id);
    if (!c) return { status: 404, json: { message: "not found" } };
    c.status = "saved";
    return { json: c };
  },
  clearCandidates: ({ body }) => {
    const ids = (body as { ids?: string[] }).ids;
    let cleared = 0;
    for (const c of mockCandidates) {
      if (c.status !== "active") continue;
      if (ids && !ids.includes(c.id)) continue;
      c.status = "dismissed";
      cleared++;
    }
    return { json: { cleared } };
  },
  triggerDiscoveryRun: () => ({ status: 202, json: { triggered: true, runId: mockRun.id } }),
  getDiscoverySettings: () => ({ json: mockDiscoverySettings }),
  updateDiscoverySettings: ({ body }) => {
    const b = body as Record<string, unknown>;
    delete b.braveApiKey;
    mockDiscoverySettings = { ...mockDiscoverySettings, ...b };
    return { json: mockDiscoverySettings };
  },
  reseedDiscoveryProfile: () => ({ json: mockDiscoveryProfile }),
  listDiscoveryRuns: () => ({ json: { runs: [mockRun] } }),
  getLatestDiscoveryRun: () => ({ json: { run: mockRun } }),
  getDiscoveryConfig: () => ({
    json: { ...mockDiscoverySettings, braveApiKey: "", braveConfigured: undefined as never },
  }),
  getDiscoveryProfile: () => ({ json: mockDiscoveryProfile }),
  putDiscoveryProfile: ({ body }) => ({ json: (body as { profile: unknown }).profile }),
  getDiscoverySeed: () => ({ json: { docs: [], tags: [] } }),
  listUnprocessedVotes: () => ({ json: { votes: [] } }),
  createCandidates: ({ body }) => ({
    json: { inserted: (body as { candidates: unknown[] }).candidates.length, skipped: 0 },
  }),
  extractContent: () => ({ json: { result: null } }),
  getFollowSuggestions: () => ({
    json: {
      suggestions: [
        {
          domain: "danluu.com",
          signalCount: 4,
          sampleTitles: ["The quiet death of the web we knew", "How web bloat impacts users"],
        },
      ],
    },
  }),
  followDomain: ({ body }) => ({
    json: {
      feed: {
        id: "feed_followed",
        title: (body as { domain: string }).domain,
        feedUrl: `https://${(body as { domain: string }).domain}/feed`,
        folderId: null,
      },
    },
  }),
  dismissFollow: () => ({ json: { dismissed: true } }),
  createDiscoveryRun: ({ body }) => {
    const b = body as { id: string; trigger?: string; stage?: string };
    const now = new Date().toISOString();
    mockRun = {
      id: b.id,
      status: "running",
      stage: b.stage ?? "starting",
      trigger: (b.trigger as "cron" | "manual") ?? "manual",
      stats: { fetched: 0, deduped: 0, scored: 0, extracted: 0, inserted: 0, perFetcher: {} },
      error: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    return { status: 201, json: mockRun };
  },
  updateDiscoveryRun: ({ params, body }) => {
    if (params.id !== mockRun.id) return { status: 404, json: { message: "not found" } };
    const b = body as Record<string, unknown>;
    mockRun = {
      ...mockRun,
      ...(b.stage !== undefined ? { stage: b.stage as string } : {}),
      ...(b.status !== undefined ? { status: b.status as typeof mockRun.status } : {}),
      ...(b.error !== undefined ? { error: b.error as string | null } : {}),
      ...(b.stats !== undefined ? { stats: { ...mockRun.stats, ...(b.stats as object) } } : {}),
      updatedAt: new Date().toISOString(),
      ...(b.status && b.status !== "running" ? { finishedAt: new Date().toISOString() } : {}),
    };
    return { json: mockRun };
  },
};

/** Every registry endpoint must have a handler — fail fast on contract drift. */
export const handledOperationIds: ReadonlySet<string> = new Set(Object.keys(handlers));
const unhandled = endpoints.filter((e) => !handledOperationIds.has(e.operationId));
if (unhandled.length > 0) {
  throw new Error(
    `mock-server: missing handlers for ${unhandled.map((e) => e.operationId).join(", ")}`,
  );
}

interface CompiledRoute {
  ep: Endpoint;
  regex: RegExp;
  keys: string[];
}

// Static segments must win over `:param` ones at the same depth (e.g.
// `/documents/bulk-delete` before `/documents/:id`), so try fewer-param routes first.
const routes: CompiledRoute[] = endpoints
  .map((ep) => {
    const keys: string[] = [];
    const pattern = ep.path.replace(/:(\w+)/g, (_m, k: string) => {
      keys.push(k);
      return "([^/]+)";
    });
    return { ep, regex: new RegExp(`^${pattern}$`), keys };
  })
  .sort((a, b) => a.keys.length - b.keys.length);

function respond(res: ServerResponse, ep: Endpoint, out: MockResult): void {
  const status = out.status ?? ep.status;
  if (out.binary) {
    res.writeHead(status, {
      "content-type": out.binary.contentType,
      ...out.binary.headers,
      ...CORS_HEADERS,
    });
    res.end(out.binary.bytes);
    return;
  }
  let body = out.json;
  // Validate success responses against the contract so fixtures can't drift.
  if (status === ep.status && ep.response && body !== undefined) body = ep.response.parse(body);
  send(res, status, body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = (url.pathname.replace(/^\/api\/v1/, "") || "/").replace(/\/$/, "") || "/";
  const body = method === "GET" ? undefined : await readJson(req);

  for (const route of routes) {
    if (route.ep.method !== method) continue;
    const match = route.regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => {
      params[k] = match[i + 1]!;
    });
    let parsedBody = body;
    if (route.ep.body && body !== undefined) {
      const result = route.ep.body.safeParse(body);
      if (!result.success) return send(res, 400, { error: "invalid request body" });
      parsedBody = result.data;
    }
    const out = await handlers[route.ep.operationId]!({
      params,
      query: url.searchParams,
      body: parsedBody,
    });
    return respond(res, route.ep, out);
  }

  send(res, 404, { error: "not found", method, path });
}

export interface MockServerHandle {
  server: Server;
  port: number;
  url: string;
}

export function startMockServer(port = 0): Promise<MockServerHandle> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => send(res, 500, { error: String(err) }));
  });
  const { promise, resolve } = Promise.withResolvers<MockServerHandle>();
  server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    const resolved = typeof addr === "object" && addr ? addr.port : port;
    resolve({ server, port: resolved, url: `http://127.0.0.1:${resolved}/api/v1` });
  });
  return promise;
}
