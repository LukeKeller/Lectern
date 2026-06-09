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
function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
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
  return base.map((b, i) =>
    sampleCard({
      ...b,
      id: `card_${i + 1}`,
      sourceId: `${b.source}_${i + 1}`,
      url: `https://${b.siteName.includes(".") ? b.siteName : "example.com"}/post-${i + 1}`,
      tags: [...b.tags],
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
// In-memory newsletter ignore list for dev: a couple of sample senders the user
// can ignore (which removes them from `known`) and un-ignore.
let mockEmailIgnore: string[] = [];
let mockEmailKnown: EmailSender[] = [
  { name: "Morning Brew", count: 4 },
  { name: "Stratechery", count: 2 },
];
// In-memory podcast state for dev: a feed token + the set of published doc ids.
let mockPodcastToken = "mocktoken";
const mockPodcast = new Set<string>();

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
  getDocument: ({ params }) => ({ json: sampleCard({ id: params.id }) }),
  updateDocument: ({ params, body }) => ({
    json: sampleCard({ id: params.id, ...(body as UpdateDocumentRequest) }),
  }),
  deleteDocument: () => ({}),
  bulkDeleteDocuments: () => ({ json: { deleted: 0 } }),
  bulkMaintenance: ({ body }) => ({
    json: { action: (body as BulkMaintenanceRequest).action, affected: 0 },
  }),
  getEmailIgnore: () => ({ json: { senders: [...mockEmailIgnore], known: mockEmailKnown } }),
  addEmailIgnore: ({ body }) => {
    const sender = (body as EmailIgnoreSenderRequest).sender;
    if (!mockEmailIgnore.some((s) => s.toLowerCase() === sender.toLowerCase()))
      mockEmailIgnore.push(sender);
    const removed = mockEmailKnown
      .filter((k) => k.name.toLowerCase() === sender.toLowerCase())
      .reduce((n, k) => n + k.count, 0);
    mockEmailKnown = mockEmailKnown.filter((k) => k.name.toLowerCase() !== sender.toLowerCase());
    return { json: { senders: [...mockEmailIgnore], known: mockEmailKnown, removed } };
  },
  removeEmailIgnore: ({ body }) => {
    const sender = (body as EmailIgnoreSenderRequest).sender;
    mockEmailIgnore = mockEmailIgnore.filter((s) => s.toLowerCase() !== sender.toLowerCase());
    return { json: { senders: [...mockEmailIgnore], known: mockEmailKnown } };
  },
  getDocumentContent: ({ params }) => ({
    json: { id: params.id, html: `<main>${ARTICLE}</main>` },
  }),
  getDocumentAccent: () => ({ json: { color: null } }),
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
  syncPull: () => ({ json: { cards: sampleCards(), deletedIds: [], cursor: "1" } }),
  syncPush: ({ body }) => ({
    json: { applied: (body as SyncPushRequest).mutations.length, conflicts: [] },
  }),
  forceSync: () => {
    const cards = sampleCards();
    return {
      json: {
        miniflux: cards.filter((c) => c.source === "miniflux").length,
        readeck: cards.filter((c) => c.source === "readeck").length,
        tombstoned: 0,
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
