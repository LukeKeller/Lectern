import type {
  BackendListParams,
  BackendPage,
  Card,
  Highlight,
  HighlightColor,
  NewHighlight,
  ReadLaterBackend,
} from "@lectern/shared";
import { BackendHttpError } from "../errors";
import {
  deriveReadeckReadState,
  progressFromReadeck,
  progressToReadeck,
  readeckLocationFromArchived,
} from "../unify";

/**
 * Readeck read-later adapter. Bearer-token API; normalizes bookmarks into
 * `Card`s (progress scaled 0..1) and bridges highlights via the annotations API.
 */

export interface ReadeckBookmark {
  id: string;
  url: string;
  title: string;
  site_name: string | null;
  authors: string[];
  created: string;
  updated: string;
  state: number;
  loaded: boolean;
  has_article: boolean;
  is_archived: boolean;
  is_marked: boolean;
  labels: string[];
  read_progress: number;
  read_anchor?: string | null;
  word_count: number | null;
  reading_time: number | null;
}

export interface ReadeckAnnotation {
  id: string;
  start_selector: string;
  start_offset: number;
  end_selector: string;
  end_offset: number;
  color: string;
  note: string;
  text: string;
  created: string;
}

export interface ReadeckOptions {
  baseUrl: string;
  apiToken: string;
  /** Override poll cadence in tests. */
  pollIntervalMs?: number;
  pollTries?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const HIGHLIGHT_COLORS: Record<string, true> = { yellow: true, red: true, blue: true, green: true };

function toHighlightColor(color: string): HighlightColor {
  return HIGHLIGHT_COLORS[color] ? (color as HighlightColor) : "yellow";
}

/**
 * Normalize a Readeck bookmark into a `Card`. `highlightCount` is supplied by the
 * caller (Readeck's list payload omits it); progress is scaled to 0..1.
 */
export function readeckBookmarkToCard(bookmark: ReadeckBookmark, highlightCount = 0): Card {
  return {
    id: `readeck:${bookmark.id}`,
    source: "readeck",
    sourceId: bookmark.id,
    category: "article",
    location: readeckLocationFromArchived(bookmark.is_archived),
    readState: deriveReadeckReadState(bookmark.is_archived, bookmark.read_progress ?? 0),
    title: bookmark.title,
    author: bookmark.authors?.[0] ?? null,
    siteName: bookmark.site_name ?? null,
    url: bookmark.url,
    wordCount: bookmark.word_count ?? null,
    readingTimeMinutes: bookmark.reading_time ?? null,
    readingProgress: progressFromReadeck(bookmark.read_progress ?? 0),
    readAnchor: bookmark.read_anchor ?? null,
    tags: bookmark.labels ?? [],
    highlightCount,
    note: null,
    savedAt: bookmark.created,
    updatedAt: bookmark.updated,
  };
}

/** Map a Readeck annotation into a unified `Highlight`. */
export function annotationToHighlight(annotation: ReadeckAnnotation, sourceId: string): Highlight {
  return {
    id: annotation.id,
    documentId: `readeck:${sourceId}`,
    text: annotation.text,
    note: annotation.note || null,
    color: toHighlightColor(annotation.color),
    startSelector: annotation.start_selector,
    startOffset: annotation.start_offset,
    endSelector: annotation.end_selector,
    endOffset: annotation.end_offset,
    createdAt: annotation.created,
  };
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export class ReadeckBackend implements ReadLaterBackend {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly pollIntervalMs: number;
  private readonly pollTries: number;

  constructor(opts: ReadeckOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.apiToken;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1200;
    this.pollTries = opts.pollTries ?? 20;
  }

  private async request(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<Response> {
    const hasBody = init?.body !== undefined;
    const headers: Record<string, string> = { Authorization: "Bearer " + this.token };
    if (hasBody) headers["content-type"] = "application/json";
    const res = await fetch(this.baseUrl + path, {
      method: init?.method ?? "GET",
      headers,
      body: hasBody ? JSON.stringify(init?.body) : undefined,
    });
    if (!res.ok) {
      throw new BackendHttpError(
        "Readeck",
        res.status,
        res.headers.get("retry-after"),
        `Readeck ${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`,
      );
    }
    return res;
  }

  private async countAnnotations(sourceId: string): Promise<number> {
    const res = await this.request(`/api/bookmarks/${sourceId}/annotations`);
    const list = (await res.json()) as ReadeckAnnotation[];
    return Array.isArray(list) ? list.length : 0;
  }

  async list(params: BackendListParams): Promise<BackendPage<Card>> {
    const limit = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      sort: "-updated",
    });
    if (params.search) query.set("search", params.search);
    if (params.updatedAfter) query.set("updated_since", params.updatedAfter);

    const res = await this.request(`/api/bookmarks?${query.toString()}`);
    const body = (await res.json()) as ReadeckBookmark[];
    const items = body.map((b) => readeckBookmarkToCard(b));
    const total = Number(res.headers.get("total-count") ?? body.length + offset);
    const nextOffset = offset + items.length;
    return { items, nextCursor: nextOffset < total ? String(nextOffset) : null };
  }

  async get(sourceId: string): Promise<Card> {
    const res = await this.request(`/api/bookmarks/${sourceId}`);
    const bookmark = (await res.json()) as ReadeckBookmark;
    const highlightCount = await this.countAnnotations(sourceId);
    return readeckBookmarkToCard(bookmark, highlightCount);
  }

  async getContent(sourceId: string): Promise<string> {
    const res = await this.request(`/api/bookmarks/${sourceId}/article`);
    return res.text();
  }

  async save(input: { url: string; html?: string; labels?: string[] }): Promise<string> {
    const body: Record<string, unknown> = { url: input.url };
    if (input.labels && input.labels.length > 0) body.labels = input.labels;
    if (input.html) body.html = input.html;

    const res = await this.request("/api/bookmarks", { method: "POST", body });
    let id = res.headers.get("bookmark-id");
    if (!id) {
      const location = res.headers.get("location");
      if (location) id = location.split("/").pop() ?? null;
    }
    if (!id) throw new Error("Readeck save: no bookmark id in response headers");

    await this.pollLoaded(id);
    return id;
  }

  async createBookmark(input: {
    url: string;
    labels?: string[];
    archived?: boolean;
  }): Promise<string> {
    const body: Record<string, unknown> = { url: input.url };
    if (input.labels && input.labels.length > 0) body.labels = input.labels;
    const res = await this.request("/api/bookmarks", { method: "POST", body });
    let id = res.headers.get("bookmark-id");
    if (!id) {
      const location = res.headers.get("location");
      if (location) id = location.split("/").pop() ?? null;
    }
    if (!id) throw new Error("Readeck create: no bookmark id in response headers");
    if (input.archived) await this.setArchived(id, true);
    return id;
  }

  private async pollLoaded(sourceId: string): Promise<void> {
    for (let i = 0; i < this.pollTries; i++) {
      const res = await this.request(`/api/bookmarks/${sourceId}`);
      const bookmark = (await res.json()) as ReadeckBookmark;
      if (bookmark.loaded === true || bookmark.state === 0) return;
      await sleep(this.pollIntervalMs);
    }
  }

  async setReadingProgress(
    sourceId: string,
    progress: number,
    anchor: string | null,
  ): Promise<void> {
    await this.request(`/api/bookmarks/${sourceId}`, {
      method: "PATCH",
      body: { read_progress: progressToReadeck(progress), read_anchor: anchor },
    });
  }

  async setArchived(sourceId: string, archived: boolean): Promise<void> {
    await this.request(`/api/bookmarks/${sourceId}`, {
      method: "PATCH",
      body: { is_archived: archived },
    });
  }

  async setLabels(sourceId: string, labels: string[]): Promise<void> {
    await this.request(`/api/bookmarks/${sourceId}`, {
      method: "PATCH",
      body: { labels },
    });
  }

  async listHighlights(sourceId: string): Promise<Highlight[]> {
    const res = await this.request(`/api/bookmarks/${sourceId}/annotations`);
    const list = (await res.json()) as ReadeckAnnotation[];
    return list.map((a) => annotationToHighlight(a, sourceId));
  }

  async addHighlight(sourceId: string, highlight: NewHighlight): Promise<Highlight> {
    const res = await this.request(`/api/bookmarks/${sourceId}/annotations`, {
      method: "POST",
      body: {
        start_selector: highlight.startSelector,
        start_offset: highlight.startOffset,
        end_selector: highlight.endSelector,
        end_offset: highlight.endOffset,
        color: highlight.color,
        note: highlight.note ?? "",
      },
    });
    const created = (await res.json()) as ReadeckAnnotation;
    return annotationToHighlight(created, sourceId);
  }

  async removeHighlight(sourceId: string, highlightId: string): Promise<void> {
    await this.request(`/api/bookmarks/${sourceId}/annotations/${highlightId}`, {
      method: "DELETE",
    });
  }
}

export function createReadeckBackend(opts: ReadeckOptions): ReadeckBackend {
  return new ReadeckBackend(opts);
}
