import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  Card,
  Feed,
  FeedsResponse,
  ImportOpmlRequest,
  ImportOpmlResponse,
  ImportReadwiseRequest,
  ImportReadwiseResponse,
  SubscribeFeedRequest,
  UpdateFeedRequest,
  CreateHighlightRequest,
  CreateViewRequest,
  DocumentContentResponse,
  Highlight,
  HighlightsResponse,
  ListDocumentsResponse,
  SaveDocumentRequest,
  SavedView,
  SyncPushRequest,
  SyncPullResponse,
  SyncPushResponse,
  TagsResponse,
  UpdateDocumentRequest,
  UpdateViewRequest,
  ViewsResponse,
} from "@lectern/shared";

/**
 * A dependency-light mock server that serves contract-valid fixtures for every
 * endpoint. The frontend track (D5/D6) develops against this while the real BFF
 * (D3/D4) is built. Every response is run through its shared schema, so the mock
 * cannot drift from the contract.
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
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
} as const;

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS_HEADERS });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const path =
    (new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/api\/v1/, "") || "/").replace(
      /\/$/,
      "",
    ) || "/";
  const body = method === "POST" || method === "PATCH" ? await readJson(req) : undefined;

  if (path === "/documents" && method === "GET") {
    return send(
      res,
      200,
      ListDocumentsResponse.parse({
        results: sampleCards(),
        nextCursor: null,
        count: sampleCards().length,
      }),
    );
  }
  if (path === "/documents" && method === "POST") {
    const input = SaveDocumentRequest.parse(body);
    return send(
      res,
      201,
      sampleCard({ id: "card_new", url: input.url, location: input.location, tags: input.tags }),
    );
  }
  if (path === "/import/readwise" && method === "POST") {
    const input = ImportReadwiseRequest.parse(body);
    const total = input.csv.split("\n").filter((l) => /https?:\/\//.test(l)).length;
    return send(res, 200, ImportReadwiseResponse.parse({ total, imported: total, failed: 0 }));
  }
  if (path === "/tags" && method === "GET") {
    return send(res, 200, TagsResponse.parse({ tags: [{ name: "sample", count: 1 }] }));
  }
  if (path === "/views" && method === "GET") {
    return send(res, 200, ViewsResponse.parse({ views: [] }));
  }
  if (path === "/views" && method === "POST") {
    const input = CreateViewRequest.parse(body);
    return send(
      res,
      201,
      SavedView.parse({ id: "view_new", createdAt: NOW, updatedAt: NOW, ...input }),
    );
  }
  if (path === "/sync" && method === "GET") {
    return send(
      res,
      200,
      SyncPullResponse.parse({ cards: sampleCards(), deletedIds: [], cursor: "1" }),
    );
  }
  if (path === "/sync" && method === "POST") {
    const input = SyncPushRequest.parse(body);
    return send(
      res,
      200,
      SyncPushResponse.parse({ applied: input.mutations.length, conflicts: [] }),
    );
  }
  if (path === "/feeds" && method === "GET") {
    return send(
      res,
      200,
      FeedsResponse.parse({
        // Mirror the publications behind the sample feed cards (matched by
        // siteName) so the sidebar feed tree shows realistic folders + counts.
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
      }),
    );
  }
  if (path === "/feeds" && method === "POST") {
    const input = SubscribeFeedRequest.parse(body);
    return send(
      res,
      201,
      Feed.parse({
        id: "feed_new",
        title: "New Feed",
        feedUrl: input.feedUrl,
        folderId: input.folderId ?? null,
      }),
    );
  }
  if (path === "/feeds/refresh" && method === "POST") return send(res, 202);
  if (path === "/feeds/import" && method === "POST") {
    ImportOpmlRequest.parse(body);
    return send(res, 200, ImportOpmlResponse.parse({ message: "Feeds imported." }));
  }

  const doc = path.match(/^\/documents\/([^/]+)(\/content|\/highlights)?$/);
  if (doc) {
    const id = doc[1]!;
    const sub = doc[2];
    if (!sub && method === "GET") return send(res, 200, sampleCard({ id }));
    if (!sub && method === "PATCH")
      return send(res, 200, sampleCard({ id, ...UpdateDocumentRequest.parse(body) }));
    if (!sub && method === "DELETE") return send(res, 204);
    if (sub === "/content" && method === "GET") {
      const article = [
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
      return send(res, 200, DocumentContentResponse.parse({ id, html: `<main>${article}</main>` }));
    }
    if (sub === "/highlights" && method === "GET")
      return send(res, 200, HighlightsResponse.parse({ highlights: [] }));
    if (sub === "/highlights" && method === "POST") {
      return send(
        res,
        201,
        sampleHighlight({ documentId: id, ...CreateHighlightRequest.parse(body) }),
      );
    }
  }

  const view = path.match(/^\/views\/([^/]+)$/);
  if (view) {
    const id = view[1]!;
    if (method === "PATCH") {
      const patch = UpdateViewRequest.parse(body);
      return send(
        res,
        200,
        SavedView.parse({
          id,
          name: "Mock view",
          query: { kind: "term", field: "location", op: "eq", value: "later" },
          createdAt: NOW,
          updatedAt: NOW,
          ...patch,
        }),
      );
    }
    if (method === "DELETE") return send(res, 204);
  }
  const feed = path.match(/^\/feeds\/([^/]+)$/);
  if (feed) {
    const id = feed[1]!;
    if (method === "PATCH") {
      const patch = UpdateFeedRequest.parse(body);
      return send(
        res,
        200,
        Feed.parse({
          id,
          title: patch.title ?? "Example Feed",
          feedUrl: "https://example.com/rss",
          folderId: patch.folderId ?? null,
        }),
      );
    }
    if (method === "DELETE") return send(res, 204);
  }
  if (path.match(/^\/highlights\/([^/]+)$/) && method === "DELETE") return send(res, 204);

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
