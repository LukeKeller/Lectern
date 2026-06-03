import type { BackendListParams, BackendPage, Card, ReadState, RssBackend } from "@lectern/shared";

/**
 * MiniFlux RSS adapter. Talks to `/v1/*`, normalizing entries into `Card`s.
 * Reading progress / scroll anchor and unified tags are BFF-owned (the glue DB
 * overlays them later); the adapter emits backend-truth only: read flag, star,
 * feed-derived tags, and `reading_time` (already in minutes).
 */

/** Raw MiniFlux entry shape (subset we consume). See docs/spikes/D1-findings.md. */
export interface MinifluxFeed {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
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
    author: entry.author || null,
    siteName: entry.feed?.title ?? null,
    url: entry.url,
    wordCount: null,
    readingTimeMinutes: entry.reading_time ?? null,
    readingProgress: 0,
    readAnchor: null,
    tags: entry.tags ?? [],
    highlightCount: 0,
    note: null,
    savedAt: entry.published_at,
    updatedAt: entry.changed_at,
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
    init?: { method?: string; body?: unknown },
  ): Promise<Response> {
    const hasBody = init?.body !== undefined;
    const res = await fetch(this.baseUrl + path, {
      method: init?.method ?? "GET",
      headers: this.headers(hasBody),
      body: hasBody ? JSON.stringify(init?.body) : undefined,
    });
    if (!res.ok) {
      throw new Error(
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
      order: "changed_at",
      direction: "desc",
    });
    if (params.onlyUnread) query.set("status", "unread");
    if (params.search) query.set("search", params.search);
    if (params.updatedAfter) query.set("changed_after", String(toUnixSeconds(params.updatedAfter)));

    const res = await this.request(`/v1/entries?${query.toString()}`);
    const body = (await res.json()) as MinifluxEntriesResponse;
    const items = body.entries.map(minifluxEntryToCard);
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
}

export function createMinifluxBackend(opts: MinifluxOptions): MinifluxBackend {
  return new MinifluxBackend(opts);
}
