import { beforeEach, describe, expect, it } from "vitest";
import {
  Card,
  Feed,
  type BackendPage,
  type BackendListParams,
  type CreateViewRequest,
  type FeedFolder,
  type Highlight,
  type NewHighlight,
  type ReadLaterBackend,
  type RssBackend,
  type SearchResult,
  type Source,
  type SavedView,
  type Tag,
  type UpdateViewRequest,
} from "@lectern/shared";
import { buildApp, type AppDeps } from "./app";
import { config } from "./config";
import {
  mergeOverlay,
  UnificationService,
  type ChangedDocuments,
  type DocumentsPage,
  type ListDocumentsParams,
  type Overlay,
  type OverlayPatch,
  type OverlayStore,
} from "./unify";

// ---- In-memory fakes (implement the real interfaces; no network) -----------

function makeCard(over: Partial<Card> & { id: string; source: Card["source"] }): Card {
  return Card.parse({
    sourceId: over.id.split(":")[1],
    category: over.source === "miniflux" ? "rss" : "article",
    location: over.source === "miniflux" ? "feed" : "later",
    title: "Untitled",
    url: "https://example.com/" + over.id,
    savedAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  });
}

class FakeRssBackend implements RssBackend {
  entries = new Map<string, Card>();
  content = new Map<string, string>();
  feeds: Feed[] = [];
  folders: FeedFolder[] = [];
  refreshed = 0;
  imported: string[] = [];

  async listEntries(): Promise<BackendPage<Card>> {
    return { items: [...this.entries.values()], nextCursor: null };
  }
  async getEntryContent(sourceId: string): Promise<string> {
    return this.content.get(sourceId) ?? "<article>rss</article>";
  }
  async setRead(): Promise<void> {}
  async setStarred(): Promise<void> {}
  async refresh(): Promise<void> {
    this.refreshed++;
  }
  async exportOpml(): Promise<string> {
    return "<opml/>";
  }
  async listFeeds(): Promise<{ feeds: Feed[]; folders: FeedFolder[] }> {
    return { feeds: this.feeds, folders: this.folders };
  }
  async subscribe(input: { feedUrl: string; folderId?: string }): Promise<Feed> {
    const feed = Feed.parse({
      id: String(this.feeds.length + 1),
      title: "New feed",
      feedUrl: input.feedUrl,
      folderId: input.folderId ?? null,
    });
    this.feeds.push(feed);
    return feed;
  }
  async updateFeed(id: string, patch: { folderId?: string | null; title?: string }): Promise<Feed> {
    const feed = this.feeds.find((f) => f.id === id);
    if (!feed) throw new Error(`no feed ${id}`);
    if (patch.title !== undefined) feed.title = patch.title;
    if (patch.folderId !== undefined) feed.folderId = patch.folderId;
    return feed;
  }
  async deleteFeed(id: string): Promise<void> {
    this.feeds = this.feeds.filter((f) => f.id !== id);
  }
  async importOpml(opml: string): Promise<string> {
    this.imported.push(opml);
    return "Feeds imported";
  }
}

class FakeReadLaterBackend implements ReadLaterBackend {
  bookmarks = new Map<string, Card>();
  highlights = new Map<string, Highlight[]>();
  content = new Map<string, string>();
  private seq = 0;

  async list(params: BackendListParams = {}): Promise<BackendPage<Card>> {
    const all = [...this.bookmarks.values()];
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const limit = params.pageSize ?? 50;
    const items = all.slice(offset, offset + limit);
    const next = offset + items.length;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }
  async get(sourceId: string): Promise<Card> {
    const card = this.bookmarks.get(sourceId);
    if (!card) throw new Error(`not found: ${sourceId}`);
    return card;
  }
  async getContent(sourceId: string): Promise<string> {
    return this.content.get(sourceId) ?? "<article>readeck</article>";
  }
  async save(input: { url: string; html?: string; labels?: string[] }): Promise<string> {
    const sourceId = `b${++this.seq}`;
    this.bookmarks.set(
      sourceId,
      makeCard({
        id: `readeck:${sourceId}`,
        source: "readeck",
        url: input.url,
        title: "Saved",
        tags: input.labels ?? [],
      }),
    );
    return sourceId;
  }
  async createBookmark(input: {
    url: string;
    labels?: string[];
    archived?: boolean;
  }): Promise<string> {
    const sourceId = `b${++this.seq}`;
    this.bookmarks.set(
      sourceId,
      makeCard({
        id: `readeck:${sourceId}`,
        source: "readeck",
        url: input.url,
        title: "Imported",
        tags: input.labels ?? [],
        location: input.archived ? "archive" : "later",
      }),
    );
    return sourceId;
  }
  async setReadingProgress(
    sourceId: string,
    progress: number,
    anchor: string | null,
  ): Promise<void> {
    const card = await this.get(sourceId);
    this.bookmarks.set(sourceId, { ...card, readingProgress: progress, readAnchor: anchor });
  }
  async setArchived(sourceId: string, archived: boolean): Promise<void> {
    const card = await this.get(sourceId);
    this.bookmarks.set(sourceId, { ...card, location: archived ? "archive" : "later" });
  }
  async setLabels(sourceId: string, labels: string[]): Promise<void> {
    const card = await this.get(sourceId);
    this.bookmarks.set(sourceId, { ...card, tags: labels });
  }
  async listHighlights(sourceId: string): Promise<Highlight[]> {
    return this.highlights.get(sourceId) ?? [];
  }
  async addHighlight(sourceId: string, input: NewHighlight): Promise<Highlight> {
    const highlight: Highlight = {
      id: `h${++this.seq}`,
      documentId: `readeck:${sourceId}`,
      createdAt: "2026-06-02T00:00:00Z",
      ...input,
    };
    const list = this.highlights.get(sourceId) ?? [];
    list.push(highlight);
    this.highlights.set(sourceId, list);
    return highlight;
  }
  async removeHighlight(sourceId: string, highlightId: string): Promise<void> {
    const list = this.highlights.get(sourceId) ?? [];
    this.highlights.set(
      sourceId,
      list.filter((h) => h.id !== highlightId),
    );
  }
}

class FakeOverlayStore implements OverlayStore {
  index = new Map<string, Card>();
  overlays = new Map<string, OverlayPatch>();
  rssHighlights = new Map<string, Highlight[]>();
  views = new Map<string, SavedView>();
  deleted = new Map<string, string>();
  private seq = 0;

  async listDocuments(params: ListDocumentsParams): Promise<DocumentsPage> {
    const all: Card[] = [];
    for (const id of this.index.keys()) {
      if (this.deleted.has(id)) continue;
      const card = await this.getIndexedCard(id);
      if (card) all.push(card);
    }
    let f = all;
    if (params.location) f = f.filter((c) => c.location === params.location);
    if (params.category) f = f.filter((c) => c.category === params.category);
    if (params.source) f = f.filter((c) => c.source === params.source);
    if (params.tag) f = f.filter((c) => c.tags.includes(params.tag as string));
    if (params.search) {
      const q = params.search.toLowerCase();
      f = f.filter((c) => c.title.toLowerCase().includes(q) || c.url.toLowerCase().includes(q));
    }
    f.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const page = f.slice(offset, offset + params.pageSize);
    const nextCursor = offset + page.length < f.length ? String(offset + page.length) : null;
    return { cards: page, nextCursor };
  }

  async documentsChangedSince(since: string | undefined): Promise<ChangedDocuments> {
    const cards: Card[] = [];
    for (const id of this.index.keys()) {
      if (this.deleted.has(id)) continue;
      const card = await this.getIndexedCard(id);
      if (card && (!since || card.updatedAt > since)) cards.push(card);
    }
    const deletedIds: string[] = [];
    if (since) for (const [id, at] of this.deleted) if (at > since) deletedIds.push(id);
    return { cards, deletedIds };
  }

  async softDeleteMissing(source: Source, presentIds: Set<string>): Promise<number> {
    let n = 0;
    const now = new Date().toISOString();
    for (const [id, card] of this.index) {
      if (card.source !== source || this.deleted.has(id)) continue;
      if (!presentIds.has(id)) {
        this.deleted.set(id, now);
        n++;
      }
    }
    return n;
  }

  contents = new Map<string, string>();
  async getContent(id: string): Promise<{ html: string } | null> {
    const html = this.contents.get(id);
    return html === undefined ? null : { html };
  }
  async putContent(id: string, html: string): Promise<void> {
    if (html.trim()) this.contents.set(id, html);
  }
  async searchContent(q: string, limit: number): Promise<SearchResult[]> {
    const needle = q.toLowerCase();
    const hits: SearchResult[] = [];
    for (const [id, html] of this.contents) {
      if (this.deleted.has(id)) continue;
      const text = html.replace(/<[^>]+>/g, " ");
      const at = text.toLowerCase().indexOf(needle);
      if (at >= 0) hits.push({ id, snippet: text.slice(at, at + 60).trim(), rank: 1 });
    }
    return hits.slice(0, limit);
  }

  async getOverlays(ids: string[]): Promise<Record<string, Overlay>> {
    const out: Record<string, Overlay> = {};
    for (const id of ids) {
      const o = this.overlays.get(id);
      if (o) out[id] = o;
    }
    return out;
  }
  async getRssHighlightCounts(ids: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const c = this.rssHighlights.get(id)?.length ?? 0;
      if (c > 0) out[id] = c;
    }
    return out;
  }
  async getIndexedCard(id: string): Promise<Card | null> {
    const base = this.index.get(id);
    if (!base) return null;
    return mergeOverlay(base, this.overlays.get(id), this.rssHighlights.get(id)?.length ?? 0);
  }
  async upsertIndex(card: Card): Promise<void> {
    this.index.set(card.id, card);
    this.deleted.delete(card.id);
    this.overlays.set(card.id, {
      location: card.location,
      tags: card.tags,
      note: card.note,
      readProgress: card.readingProgress,
      readAnchor: card.readAnchor,
    });
  }
  async indexFromBackend(card: Card): Promise<void> {
    this.index.set(card.id, card);
    this.deleted.delete(card.id);
  }
  async deleteDocument(id: string): Promise<void> {
    this.index.delete(id);
    this.overlays.delete(id);
    this.rssHighlights.delete(id);
  }
  async upsertOverlay(id: string, patch: OverlayPatch): Promise<void> {
    this.overlays.set(id, { ...this.overlays.get(id), ...patch });
  }
  async listTags(): Promise<Tag[]> {
    const counts = new Map<string, number>();
    for (const id of this.index.keys()) {
      const card = await this.getIndexedCard(id);
      for (const tag of card?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
  }
  async listViews(): Promise<SavedView[]> {
    return [...this.views.values()];
  }
  async createView(input: CreateViewRequest): Promise<SavedView> {
    const view: SavedView = {
      id: `v${++this.seq}`,
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
      ...input,
    };
    this.views.set(view.id, view);
    return view;
  }
  async updateView(id: string, patch: UpdateViewRequest): Promise<SavedView | null> {
    const view = this.views.get(id);
    if (!view) return null;
    const next = { ...view, ...patch, updatedAt: "2026-06-03T00:00:00Z" };
    this.views.set(id, next);
    return next;
  }
  async deleteView(id: string): Promise<boolean> {
    return this.views.delete(id);
  }
  async listRssHighlights(documentId: string): Promise<Highlight[]> {
    return this.rssHighlights.get(documentId) ?? [];
  }
  async addRssHighlight(documentId: string, input: NewHighlight): Promise<Highlight> {
    const highlight: Highlight = {
      id: `rh${++this.seq}`,
      documentId,
      createdAt: "2026-06-02T00:00:00Z",
      ...input,
    };
    const list = this.rssHighlights.get(documentId) ?? [];
    list.push(highlight);
    this.rssHighlights.set(documentId, list);
    return highlight;
  }
  async removeRssHighlight(highlightId: string): Promise<boolean> {
    for (const [docId, list] of this.rssHighlights) {
      const next = list.filter((h) => h.id !== highlightId);
      if (next.length !== list.length) {
        this.rssHighlights.set(docId, next);
        return true;
      }
    }
    return false;
  }
}

// ---- Test harness ----------------------------------------------------------

interface Harness {
  deps: AppDeps & {
    rss: FakeRssBackend;
    readLater: FakeReadLaterBackend;
    overlay: FakeOverlayStore;
  };
}

function makeHarness(): Harness {
  const rss = new FakeRssBackend();
  const readLater = new FakeReadLaterBackend();
  const overlay = new FakeOverlayStore();
  const unify = new UnificationService(rss, readLater, overlay);
  return { deps: { rss, readLater, overlay, unify } };
}

const TOKEN = config.LECTERN_API_TOKEN;
const auth = { authorization: `Bearer ${TOKEN}` };

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

function app() {
  return buildApp(harness.deps);
}

/** Simulate the ingestion poll: index every backend item into the overlay so the
 *  index-backed read path (GET /documents, GET /sync) can see backend-seeded data. */
async function poll(): Promise<void> {
  for (const card of harness.deps.rss.entries.values()) {
    await harness.deps.overlay.indexFromBackend(card);
  }
  for (const card of harness.deps.readLater.bookmarks.values()) {
    await harness.deps.overlay.indexFromBackend(card);
  }
}

describe("auth", () => {
  it("rejects /api/v1 without a bearer token (401)", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/documents" });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("rejects /api/v1 with a wrong bearer token (401)", async () => {
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents",
      headers: { authorization: "Bearer nope" },
    });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("allows /api/v1 with the correct bearer token", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/documents", headers: auth });
    expect(res.statusCode).toBe(200);
    await a.close();
  });

  it("serves the openapi document without auth", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe("3.1.0");
    await a.close();
  });
});

describe("documents", () => {
  it("lists merged documents from both backends and applies filters", async () => {
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", tags: ["dev"] }),
    );
    harness.deps.readLater.bookmarks.set(
      "b1",
      makeCard({ id: "readeck:b1", source: "readeck", tags: ["news"] }),
    );
    const a = app();
    await poll();

    const all = await a.inject({ method: "GET", url: "/api/v1/documents", headers: auth });
    expect(all.statusCode).toBe(200);
    expect(all.json().count).toBe(2);

    const filtered = await a.inject({
      method: "GET",
      url: "/api/v1/documents?source=miniflux",
      headers: auth,
    });
    expect(filtered.json().results).toHaveLength(1);
    expect(filtered.json().results[0].id).toBe("miniflux:1");

    const byTag = await a.inject({
      method: "GET",
      url: "/api/v1/documents?tag=news",
      headers: auth,
    });
    expect(byTag.json().results).toHaveLength(1);
    expect(byTag.json().results[0].id).toBe("readeck:b1");
    await a.close();
  });

  it("rejects an invalid pageSize (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents?pageSize=abc",
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it("gets a readeck document live and overlays glue note", async () => {
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    harness.deps.overlay.overlays.set("readeck:b1", { note: "remember this" });
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().note).toBe("remember this");
    await a.close();
  });

  it("gets an rss document from the index", async () => {
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:5", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/miniflux:5",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("miniflux:5");
    await a.close();
  });

  it("captures article content on first read and serves the owned copy after", async () => {
    harness.deps.readLater.content.set("b1", "<article>hello world body</article>");
    const a = app();
    const first = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(first.json().html).toContain("hello world");
    // Backend changes; we keep serving the captured copy (ownership / resilience).
    harness.deps.readLater.content.set("b1", "<article>CHANGED</article>");
    const second = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(second.json().html).toContain("hello world");
    expect(second.json().html).not.toContain("CHANGED");
    await a.close();
  });

  it("full-text searches owned article bodies", async () => {
    harness.deps.readLater.content.set("b1", "<article>the quick brown fox jumps</article>");
    const a = app();
    // Capture the body via the content endpoint, then search it.
    await a.inject({ method: "GET", url: "/api/v1/documents/readeck:b1/content", headers: auth });
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/search?q=brown%20fox",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().results as { id: string }[]).map((r) => r.id)).toContain("readeck:b1");
    // A miss returns no rows.
    const miss = await a.inject({
      method: "GET",
      url: "/api/v1/search?q=nonexistentzzz",
      headers: auth,
    });
    expect(miss.json().results).toHaveLength(0);
    await a.close();
  });

  it("saves a document via Readeck and returns a Card (201)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: auth,
      payload: { url: "https://example.com/post", tags: ["read"], location: "later" },
    });
    expect(res.statusCode).toBe(201);
    const card = res.json();
    expect(card.source).toBe("readeck");
    expect(card.tags).toEqual(["read"]);
    expect(harness.deps.overlay.index.has(card.id)).toBe(true);
    await a.close();
  });

  it("rejects saving an invalid url (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: auth,
      payload: { url: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation");
    await a.close();
  });

  it("updates a readeck document: archive flag + glue note", async () => {
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/documents/readeck:b1",
      headers: auth,
      payload: { location: "archive", note: "done" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().location).toBe("archive");
    expect(res.json().note).toBe("done");
    expect(harness.deps.readLater.bookmarks.get("b1")!.location).toBe("archive");
    await a.close();
  });

  it("updates an rss document via the glue overlay", async () => {
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:7", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/documents/miniflux:7",
      headers: auth,
      payload: { tags: ["saved"], readingProgress: 0.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tags).toEqual(["saved"]);
    expect(res.json().readingProgress).toBe(0.5);
    await a.close();
  });

  it("deletes a document (204) and drops the glue index", async () => {
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:9", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "DELETE",
      url: "/api/v1/documents/miniflux:9",
      headers: auth,
    });
    expect(res.statusCode).toBe(204);
    expect(harness.deps.overlay.index.has("miniflux:9")).toBe(false);
    await a.close();
  });

  it("returns article content routed to the owning backend", async () => {
    harness.deps.readLater.content.set("b1", "<article>hello</article>");
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "readeck:b1", html: "<article>hello</article>" });
    await a.close();
  });
});

describe("highlights", () => {
  it("creates and lists an RSS highlight via the glue store", async () => {
    const a = app();
    const created = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/highlights",
      headers: auth,
      payload: {
        text: "key idea",
        startSelector: "p:nth-child(1)",
        startOffset: 0,
        endSelector: "p:nth-child(1)",
        endOffset: 8,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const listed = await a.inject({
      method: "GET",
      url: "/api/v1/documents/miniflux:1/highlights",
      headers: auth,
    });
    expect(listed.json().highlights).toHaveLength(1);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/v1/highlights/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    await a.close();
  });
});

describe("tags", () => {
  it("returns aggregated tag counts", async () => {
    await harness.deps.overlay.indexFromBackend(
      makeCard({ id: "miniflux:1", source: "miniflux", tags: ["a", "b"] }),
    );
    await harness.deps.overlay.indexFromBackend(
      makeCard({ id: "miniflux:2", source: "miniflux", tags: ["a"] }),
    );
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/tags", headers: auth });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(res.json().tags.map((t: Tag) => [t.name, t.count]));
    expect(byName.a).toBe(2);
    expect(byName.b).toBe(1);
    await a.close();
  });
});

describe("views", () => {
  it("supports create, list, update, and delete", async () => {
    const a = app();
    const view = {
      name: "Unread dev",
      query: { kind: "term", field: "location", op: "eq", value: "inbox" },
      pinned: true,
      sortBy: "savedAt",
      sortDir: "desc",
    };
    const created = await a.inject({
      method: "POST",
      url: "/api/v1/views",
      headers: auth,
      payload: view,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const listed = await a.inject({ method: "GET", url: "/api/v1/views", headers: auth });
    expect(listed.json().views).toHaveLength(1);

    const updated = await a.inject({
      method: "PATCH",
      url: `/api/v1/views/${id}`,
      headers: auth,
      payload: { name: "Renamed" },
    });
    expect(updated.json().name).toBe("Renamed");

    const del = await a.inject({ method: "DELETE", url: `/api/v1/views/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const missing = await a.inject({
      method: "DELETE",
      url: `/api/v1/views/${id}`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    await a.close();
  });
});

describe("sync", () => {
  it("pulls a combined delta", async () => {
    harness.deps.rss.entries.set("1", makeCard({ id: "miniflux:1", source: "miniflux" }));
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    const a = app();
    await poll();
    const res = await a.inject({ method: "GET", url: "/api/v1/sync", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().cards).toHaveLength(2);
    expect(typeof res.json().cursor).toBe("string");
    await a.close();
  });

  it("returns the full library and reports deletions on the next pull", async () => {
    for (let i = 0; i < 4; i++) {
      harness.deps.readLater.bookmarks.set(
        `b${i}`,
        makeCard({ id: `readeck:b${i}`, source: "readeck", url: `https://x.test/${i}` }),
      );
    }
    harness.deps.rss.entries.set("1", makeCard({ id: "miniflux:1", source: "miniflux" }));
    const a = app();
    await poll();

    // Full snapshot (no cursor): every indexed document, no duplicates.
    const first = await a.inject({ method: "GET", url: "/api/v1/sync", headers: auth });
    const ids = (first.json().cards as { id: string }[]).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5); // 4 read-later + 1 rss
    const cursor = first.json().cursor as string;

    // A backend item disappears (e.g. dedup); reconcile tombstones it.
    await new Promise((r) => setTimeout(r, 5));
    harness.deps.readLater.bookmarks.delete("b0");
    await harness.deps.overlay.softDeleteMissing(
      "readeck",
      new Set(["readeck:b1", "readeck:b2", "readeck:b3"]),
    );

    // The next pull reports the deletion instead of a stale card.
    const next = await a.inject({
      method: "GET",
      url: `/api/v1/sync?since=${encodeURIComponent(cursor)}`,
      headers: auth,
    });
    expect(next.json().deletedIds).toContain("readeck:b0");
    expect((next.json().cards as { id: string }[]).map((c) => c.id)).not.toContain("readeck:b0");
    await a.close();
  });

  it("pushes mutations and reports applied + conflicts", async () => {
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:2", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: auth,
      payload: {
        mutations: [
          { type: "setLocation", id: "readeck:b1", location: "archive" },
          { type: "setTags", id: "miniflux:2", tags: ["x"] },
          { type: "removeHighlight", id: "miniflux:2", highlightId: "missing" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(2);
    expect(res.json().conflicts).toHaveLength(1);
    expect(res.json().conflicts[0].id).toBe("miniflux:2");
    await a.close();
  });

  it("rejects a malformed mutation payload (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: auth,
      payload: { mutations: [{ type: "bogus", id: "x" }] },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});

describe("feeds", () => {
  it("lists feeds and folders", async () => {
    harness.deps.rss.feeds = [
      Feed.parse({
        id: "1",
        title: "Simon Willison's Weblog",
        feedUrl: "https://simonwillison.net/atom/everything/",
        siteUrl: "http://simonwillison.net/",
        folderId: "2",
        folderTitle: "Lectern Spike",
        unreadCount: 29,
      }),
    ];
    harness.deps.rss.folders = [{ id: "2", title: "Lectern Spike", unreadCount: 29 }];
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/feeds", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.feeds).toHaveLength(1);
    expect(body.feeds[0].id).toBe("1");
    expect(body.folders).toEqual([{ id: "2", title: "Lectern Spike", unreadCount: 29 }]);
    await a.close();
  });

  it("rejects /feeds without a bearer token (401)", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("subscribes to a feed (201) and returns the created feed", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/feeds",
      headers: auth,
      payload: { feedUrl: "https://example.com/feed.xml", folderId: "2" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().feedUrl).toBe("https://example.com/feed.xml");
    expect(res.json().folderId).toBe("2");
    expect(harness.deps.rss.feeds).toHaveLength(1);
    await a.close();
  });

  it("rejects a non-url feedUrl (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/feeds",
      headers: auth,
      payload: { feedUrl: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it("renames / moves a feed via PATCH (200)", async () => {
    harness.deps.rss.feeds = [
      Feed.parse({ id: "1", title: "Old", feedUrl: "https://example.com/feed.xml" }),
    ];
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/feeds/1",
      headers: auth,
      payload: { title: "New", folderId: "3" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("New");
    expect(res.json().folderId).toBe("3");
    await a.close();
  });

  it("unsubscribes via DELETE (204)", async () => {
    harness.deps.rss.feeds = [
      Feed.parse({ id: "1", title: "Old", feedUrl: "https://example.com/feed.xml" }),
    ];
    const a = app();
    const res = await a.inject({ method: "DELETE", url: "/api/v1/feeds/1", headers: auth });
    expect(res.statusCode).toBe(204);
    expect(harness.deps.rss.feeds).toHaveLength(0);
    await a.close();
  });

  it("refreshes all feeds (202)", async () => {
    const a = app();
    const res = await a.inject({ method: "POST", url: "/api/v1/feeds/refresh", headers: auth });
    expect(res.statusCode).toBe(202);
    expect(harness.deps.rss.refreshed).toBe(1);
    await a.close();
  });

  it("imports OPML (200) and returns a status message", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/feeds/import",
      headers: auth,
      payload: { opml: "<opml/>" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("Feeds imported");
    expect(harness.deps.rss.imported).toEqual(["<opml/>"]);
    await a.close();
  });
});

describe("readwise import", () => {
  it("POST /import/readwise creates a bookmark per http row and reports counts", async () => {
    const a = app();
    const csv = [
      "Title,Source URL,Document tags,Location",
      "A,https://a.test/1,news,later",
      "B,https://b.test/2,,archive",
      "skipme,,,",
    ].join("\n");
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/import/readwise",
      headers: auth,
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 2, imported: 2, failed: 0 });
    expect(harness.deps.readLater.bookmarks.size).toBe(2);
    await a.close();
  });

  it("maps Readwise locations to unified locations so imported items are visible", async () => {
    const a = app();
    const csv = [
      "Title,Source URL,Document tags,Location",
      "New one,https://a.test/new,,new",
      "Later one,https://b.test/later,,later",
      "Short one,https://c.test/short,reading,shortlist",
      "Archived one,https://d.test/arch,,archive",
      "Feed one,https://e.test/feed,,feed",
    ].join("\n");
    const imp = await a.inject({
      method: "POST",
      url: "/api/v1/import/readwise",
      headers: auth,
      payload: { csv },
    });
    expect(imp.json()).toMatchObject({ total: 5, imported: 5, failed: 0 });

    const res = await a.inject({ method: "GET", url: "/api/v1/documents", headers: auth });
    const byUrl = new Map<string, string>(
      (res.json().results as { url: string; location: string }[]).map((c) => [c.url, c.location]),
    );
    // The Readwise "new" location is the unified inbox: the default landing list.
    // Without an overlay these would all collapse to Readeck's archived-derived
    // "later"/"archive" and never appear in Inbox/Shortlist.
    expect(byUrl.get("https://a.test/new")).toBe("inbox");
    expect(byUrl.get("https://b.test/later")).toBe("later");
    expect(byUrl.get("https://c.test/short")).toBe("shortlist");
    expect(byUrl.get("https://d.test/arch")).toBe("archive");
    expect(byUrl.get("https://e.test/feed")).toBe("later");
    await a.close();
  });
});
