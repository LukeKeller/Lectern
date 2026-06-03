import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  Card,
  Feed,
  FeedsResponse,
  ImportOpmlRequest,
  ImportOpmlResponse,
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

function sampleHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return Highlight.parse({
    id: "hl_1",
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
      ListDocumentsResponse.parse({ results: [sampleCard()], nextCursor: null, count: 1 }),
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
      SyncPullResponse.parse({ cards: [sampleCard()], deletedIds: [], cursor: "1" }),
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
        feeds: [
          {
            id: "feed_1",
            title: "Example Feed",
            feedUrl: "https://example.com/rss",
            siteUrl: "https://example.com",
            folderId: "folder_1",
            folderTitle: "Tech",
            unreadCount: 3,
          },
        ],
        folders: [{ id: "folder_1", title: "Tech", unreadCount: 3 }],
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
      return send(
        res,
        200,
        DocumentContentResponse.parse({ id, html: "<main><p>Mock article body.</p></main>" }),
      );
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
