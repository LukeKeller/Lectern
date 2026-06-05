import type {
  BackendListParams,
  BackendPage,
  Card,
  Feed,
  FeedFolder,
  ReadState,
  RssBackend,
} from "@lectern/shared";
import { BackendHttpError } from "../errors";
import { extractCoverImage } from "../cover";
import { htmlToText, snippet } from "../html-text";

/**
 * MiniFlux RSS adapter. Talks to `/v1/*`, normalizing entries into `Card`s.
 * Reading progress / scroll anchor and unified tags are BFF-owned (the glue DB
 * overlays them later); the adapter emits backend-truth only: read flag, star,
 * feed-derived tags, and `reading_time` (already in minutes).
 */

/** Raw MiniFlux category shape (subset we consume). A category groups feeds. */
export interface MinifluxCategory {
  id: number;
  title: string;
}

/** Raw MiniFlux feed shape (subset we consume). See docs/spikes/D1-findings.md. */
export interface MinifluxFeed {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  /** Present on the feeds-list and single-feed endpoints, absent on entry.feed. */
  category?: MinifluxCategory;
}

/** `GET /v1/feeds/counters` payload: per-feed read/unread tallies keyed by feed id. */
export interface MinifluxFeedCounters {
  reads: Record<string, number>;
  unreads: Record<string, number>;
}

export interface MinifluxEntry {
  id: number;
  feed_id: number;
  status: "unread" | "read" | "removed";
  title: string;
  url: string;
  author: string;
  published_at: string;
  created_at: string;
  changed_at: string;
  content: string;
  starred: boolean;
  reading_time: number;
  tags: string[] | null;
  feed?: MinifluxFeed;
}

export interface MinifluxEntriesResponse {
  total: number;
  entries: MinifluxEntry[];
}

export interface MinifluxOptions {
  baseUrl: string;
  /** When set, sent as `X-Auth-Token`. */
  apiToken?: string;
  /** `user:pass` for HTTP Basic; used when no API token is present. */
  basic?: string;
}

const DEFAULT_PAGE_SIZE = 50;

/** Map a unified MiniFlux read flag to the derived `ReadState`. */
export function minifluxReadState(read: boolean): ReadState {
  return read ? "finished" : "unopened";
}

/**
 * Normalize a MiniFlux entry into a `Card`. Reading progress/anchor are zeroed
 * here (overlaid from the glue DB); tags are the feed-derived entry tags.
 */
export function minifluxEntryToCard(entry: MinifluxEntry): Card {
  return {
    id: `miniflux:${entry.id}`,
    source: "miniflux",
    sourceId: String(entry.id),
    category: "rss",
    location: "feed",
    readState: minifluxReadState(entry.status === "read"),
    title: entry.title,
    excerpt: snippet(htmlToText(entry.content)),
    author: entry.author || null,
    siteName: entry.feed?.title ?? null,
    // Some MiniFlux entries (e.g. webmention/comment items) carry an empty
    // `url`; fall back to the feed's canonical link so the card keeps a valid,
    // openable URL and survives `Card` validation on the sync read path.
    url: entry.url || entry.feed?.site_url || entry.feed?.feed_url || "",
    // No native image on RSS entries — pull og:image / first <img> from the
    // entry content (best-effort, absolute http(s) only, else null).
    coverImage: extractCoverImage(entry.content, entry.url || entry.feed?.site_url || ""),
    wordCount: null,
    readingTimeMinutes: entry.reading_time ?? null,
    readingProgress: 0,
    readAnchor: null,
    tags: entry.tags ?? [],
    highlightCount: 0,
    note: null,
    savedAt: entry.published_at,
    updatedAt: entry.changed_at,
    publishedAt: entry.published_at,
  };
}

/**
 * Normalize a MiniFlux feed into the unified `Feed`. Numeric ids are stringified;
 * an empty `site_url` collapses to `null`; folder fields are derived from the
 * embedded category. `unreadCount` comes from the separate counters endpoint.
 */
export function minifluxFeedToFeed(feed: MinifluxFeed, unreadCount = 0): Feed {
  return {
    id: String(feed.id),
    title: feed.title,
    feedUrl: feed.feed_url,
    siteUrl: feed.site_url || null,
    folderId: feed.category ? String(feed.category.id) : null,
    folderTitle: feed.category?.title ?? null,
    unreadCount,
  };
}

/** Normalize a MiniFlux category into the unified `FeedFolder`. */
export function minifluxCategoryToFolder(category: MinifluxCategory, unreadCount = 0): FeedFolder {
  return {
    id: String(category.id),
    title: category.title,
    unreadCount,
  };
}

/** Convert an ISO-8601 instant to MiniFlux's unix-seconds `changed_after`. */
function toUnixSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export class MinifluxBackend implements RssBackend {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(opts: MinifluxOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    if (opts.apiToken) {
      this.authHeader = opts.apiToken;
    } else if (opts.basic) {
      this.authHeader = "Basic " + Buffer.from(opts.basic).toString("base64");
    } else {
      throw new Error("MinifluxBackend: either apiToken or basic credentials required");
    }
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.authHeader.startsWith("Basic ")) h["Authorization"] = this.authHeader;
    else h["X-Auth-Token"] = this.authHeader;
    if (json) h["content-type"] = "application/json";
    return h;
  }

  private async request(
    path: string,
    init?: { method?: string; body?: unknown; opml?: string },
  ): Promise<Response> {
    const hasJson = init?.body !== undefined;
    const hasOpml = init?.opml !== undefined;
    const headers = this.headers(hasJson);
    if (hasOpml) headers["content-type"] = "text/xml";
    const res = await fetch(this.baseUrl + path, {
      method: init?.method ?? "GET",
      headers,
      body: hasOpml ? init.opml : hasJson ? JSON.stringify(init?.body) : undefined,
    });
    if (!res.ok) {
      throw new BackendHttpError(
        "MiniFlux",
        res.status,
        res.headers.get("retry-after"),
        `MiniFlux ${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`,
      );
    }
    return res;
  }

  async listEntries(
    params: BackendListParams & { onlyUnread?: boolean },
  ): Promise<BackendPage<Card>> {
    const limit = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      // Order by the unique, stable `id`: offset pagination over the non-unique
      // `changed_at` overlaps and skips rows across pages (entries sharing a
      // changed_at reshuffle), silently dropping ~a third of the library.
      order: "id",
      direction: "desc",
    });
    // Exclude `removed` entries (our full-delete tombstones): keep unread+read,
    // so a removed entry is never re-indexed and reads as "missing" to the
    // deletion reconcile. `onlyUnread` narrows further to unread.
    if (params.onlyUnread) query.append("status", "unread");
    else for (const s of ["unread", "read"]) query.append("status", s);
    if (params.search) query.set("search", params.search);
    if (params.updatedAfter) query.set("changed_after", String(toUnixSeconds(params.updatedAfter)));

    const res = await this.request(`/v1/entries?${query.toString()}`);
    const body = (await res.json()) as MinifluxEntriesResponse;
    const items = body.entries.map(minifluxEntryToCard);
    const nextOffset = offset + items.length;
    return { items, nextCursor: nextOffset < body.total ? String(nextOffset) : null };
  }

  /**
   * Like `listEntries`, but each item is paired with the raw entry's `feed_id`,
   * feed title, and unread flag — the signals the push poll needs to tally new
   * articles per feed. `minifluxEntryToCard` drops `feed_id` (the unified `Card`
   * has no feed field), so the poll reaches it through this raw-aware variant.
   * The card's `id` (`miniflux:<entryId>`) still drives the dedup/index path;
   * `feedId` is the stringified numeric feed id, equal to the `id` GET /feeds
   * returns for that feed.
   */
  async listEntriesWithFeed(
    params: BackendListParams & { onlyUnread?: boolean },
  ): Promise<
    BackendPage<{ card: Card; feedId: string; feedTitle: string | null; unread: boolean }>
  > {
    const limit = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      order: "id",
      direction: "desc",
    });
    // Same `removed`-excluding status filter as `listEntries` (see there).
    if (params.onlyUnread) query.append("status", "unread");
    else for (const s of ["unread", "read"]) query.append("status", s);
    if (params.search) query.set("search", params.search);
    if (params.updatedAfter) query.set("changed_after", String(toUnixSeconds(params.updatedAfter)));

    const res = await this.request(`/v1/entries?${query.toString()}`);
    const body = (await res.json()) as MinifluxEntriesResponse;
    const items = body.entries.map((entry) => ({
      card: minifluxEntryToCard(entry),
      feedId: String(entry.feed_id),
      feedTitle: entry.feed?.title ?? null,
      unread: entry.status === "unread",
    }));
    const nextOffset = offset + items.length;
    return { items, nextCursor: nextOffset < body.total ? String(nextOffset) : null };
  }

  async getEntryContent(sourceId: string): Promise<string> {
    const res = await this.request(`/v1/entries/${sourceId}/fetch-content`);
    const body = (await res.json()) as { content?: string };
    return body.content ?? "";
  }

  async setRead(sourceId: string, read: boolean): Promise<void> {
    await this.request("/v1/entries", {
      method: "PUT",
      body: { entry_ids: [Number(sourceId)], status: read ? "read" : "unread" },
    });
  }

  /**
   * Hide entries from the feed: MiniFlux has no hard delete, so the `removed`
   * status takes an entry out of unread+read listings (and our poll excludes
   * `removed`, so it won't be re-indexed/un-tombstoned). Batch-capable — one PUT
   * for the whole set. A no-op on an empty list.
   */
  async setRemoved(sourceIds: string[]): Promise<void> {
    const ids = sourceIds.map(Number).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return;
    await this.request("/v1/entries", {
      method: "PUT",
      body: { entry_ids: ids, status: "removed" },
    });
  }

  async setStarred(sourceId: string, starred: boolean): Promise<void> {
    // The bookmark endpoint toggles; read current state so the call is idempotent.
    const res = await this.request(`/v1/entries/${sourceId}`);
    const entry = (await res.json()) as MinifluxEntry;
    if (entry.starred === starred) return;
    await this.request(`/v1/entries/${sourceId}/bookmark`, { method: "PUT" });
  }

  async refresh(): Promise<void> {
    await this.request("/v1/feeds/refresh", { method: "PUT" });
  }

  async exportOpml(): Promise<string> {
    const res = await this.request("/v1/export");
    return res.text();
  }

  async listFeeds(): Promise<{ feeds: Feed[]; folders: FeedFolder[] }> {
    const [feedsRes, catsRes, countersRes] = await Promise.all([
      this.request("/v1/feeds"),
      this.request("/v1/categories"),
      this.request("/v1/feeds/counters"),
    ]);
    const rawFeeds = (await feedsRes.json()) as MinifluxFeed[];
    const rawCats = (await catsRes.json()) as MinifluxCategory[];
    const counters = (await countersRes.json()) as MinifluxFeedCounters;
    const unreadByFeed = counters.unreads ?? {};

    const feeds = rawFeeds.map((f) => minifluxFeedToFeed(f, unreadByFeed[String(f.id)] ?? 0));
    // Folder unread is the sum of its feeds' unread tallies.
    const unreadByFolder: Record<string, number> = {};
    for (const f of feeds) {
      if (f.folderId)
        unreadByFolder[f.folderId] = (unreadByFolder[f.folderId] ?? 0) + f.unreadCount;
    }
    const folders = rawCats.map((c) =>
      minifluxCategoryToFolder(c, unreadByFolder[String(c.id)] ?? 0),
    );
    return { feeds, folders };
  }

  async subscribe(input: { feedUrl: string; folderId?: string }): Promise<Feed> {
    // MiniFlux requires a category; fall back to the first existing one.
    let categoryId: number;
    if (input.folderId !== undefined) {
      categoryId = Number(input.folderId);
    } else {
      const catsRes = await this.request("/v1/categories");
      const cats = (await catsRes.json()) as MinifluxCategory[];
      const first = cats[0];
      if (!first) throw new Error("MinifluxBackend.subscribe: no category available");
      categoryId = first.id;
    }
    const res = await this.request("/v1/feeds", {
      method: "POST",
      body: { feed_url: input.feedUrl, category_id: categoryId },
    });
    const created = (await res.json()) as { feed_id: number };
    return this.getFeed(created.feed_id);
  }

  async updateFeed(id: string, patch: { folderId?: string | null; title?: string }): Promise<Feed> {
    const body: { category_id?: number; title?: string } = {};
    // MiniFlux feeds always belong to a category, so a null folderId is a no-op.
    if (patch.folderId !== undefined && patch.folderId !== null) {
      body.category_id = Number(patch.folderId);
    }
    if (patch.title !== undefined) body.title = patch.title;
    await this.request(`/v1/feeds/${id}`, { method: "PUT", body });
    return this.getFeed(Number(id));
  }

  async deleteFeed(id: string): Promise<void> {
    await this.request(`/v1/feeds/${id}`, { method: "DELETE" });
  }

  async importOpml(opml: string): Promise<string> {
    const res = await this.request("/v1/import", { method: "POST", opml });
    const body = (await res.json()) as { message?: string };
    return body.message ?? "";
  }

  /** Fetch a single feed and decorate it with its current unread count. */
  private async getFeed(id: number): Promise<Feed> {
    const [feedRes, countersRes] = await Promise.all([
      this.request(`/v1/feeds/${id}`),
      this.request("/v1/feeds/counters"),
    ]);
    const raw = (await feedRes.json()) as MinifluxFeed;
    const counters = (await countersRes.json()) as MinifluxFeedCounters;
    return minifluxFeedToFeed(raw, counters.unreads?.[String(id)] ?? 0);
  }
}

export function createMinifluxBackend(opts: MinifluxOptions): MinifluxBackend {
  return new MinifluxBackend(opts);
}
