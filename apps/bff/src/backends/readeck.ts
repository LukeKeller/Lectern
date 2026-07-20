import type {
  BackendListParams,
  BackendPage,
  BackendResource,
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
import { safeHttpUrl } from "../cover";
import { snippet } from "../html-text";
import { EMAIL_DOMAIN_LABEL_PREFIX, EMAIL_LABEL } from "./email-inbox";

/**
 * Readeck read-later adapter. Bearer-token API; normalizes bookmarks into
 * `Card`s (progress scaled 0..1) and bridges highlights via the annotations API.
 */

/**
 * Reserved Readeck label marking a bookmark as a TRANSIENT full-text extraction
 * for content discovery (`POST /discovery/extract`). Such a bookmark exists for
 * only a few seconds — the extract route saves the URL, pulls the article, and
 * deletes it — so it must never be synced into the library index. `list()`
 * excludes bookmarks carrying this label so the poll/reconcile jobs skip them.
 */
export const DISCOVER_LABEL = "lectern:discover";

/**
 * The reserved label namespace. Everything Lectern writes to Readeck that is
 * MACHINE state rather than a user tag carries this prefix: `lectern:email`
 * (category sentinel), `lectern:from:<domain>` (sender identity),
 * `lectern:discover` (transient extraction marker).
 *
 * Two rules follow from that, and both are enforced here rather than at each
 * call site, because Readeck's label PATCH is a FULL REPLACEMENT:
 *
 *  1. Reserved labels are invisible. `readeckBookmarkToCard` strips them from the
 *     user-facing `tags` array, so they can never be round-tripped back by a
 *     client that echoes the tags it was given.
 *  2. Reserved labels survive user writes. `setLabels` re-attaches whatever
 *     reserved labels the bookmark currently carries, so a tag edit cannot drop
 *     them. Before this, adding one tag to a newsletter erased `lectern:email`
 *     and `lectern:from:*`, and the next poll re-derived the document as a plain
 *     article — losing it from the Newsletters surface, from the read/ignore-
 *     sender bulk actions, and from the sticky-finished carve-out, irrecoverably.
 *
 * The prefix is treated as a namespace, not as two known strings, so any label
 * added later is protected without revisiting this file.
 */
export const RESERVED_LABEL_PREFIX = "lectern:";

/** True for a label in the reserved `lectern:` namespace (case-insensitive, so a
 *  user cannot smuggle one in as `Lectern:email`). */
export function isReservedLabel(label: string): boolean {
  return label.trim().toLowerCase().startsWith(RESERVED_LABEL_PREFIX);
}

/** Drop every reserved label from a list of user-supplied tags. */
export function stripReservedLabels(labels: readonly string[]): string[] {
  return labels.filter((l) => !isReservedLabel(l));
}

export interface ReadeckBookmark {
  id: string;
  url: string;
  title: string;
  /** Readeck's extracted article summary/description, when available. */
  description?: string | null;
  site_name: string | null;
  authors: string[];
  created: string;
  updated: string;
  /** Original article publication date when Readeck extracted one. */
  published?: string | null;
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
  /** Readeck-extracted media (subset). Used for the card cover thumbnail. */
  resources?: { image?: { src?: string }; thumbnail?: { src?: string } };
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
// Readeck rejects `limit > 100` outright with a 404, which would fail the whole
// read-later list (and empty the library). Clamp larger unified page sizes
// (e.g. the sync default of 200) to Readeck's max; callers fetch the rest via
// the offset cursor.
const READECK_MAX_PAGE_SIZE = 100;
const HIGHLIGHT_COLORS: Record<string, true> = { yellow: true, red: true, blue: true, green: true };

function toHighlightColor(color: string): HighlightColor {
  return HIGHLIGHT_COLORS[color] ? (color as HighlightColor) : "yellow";
}

/**
 * Normalize a Readeck bookmark into a `Card`. `highlightCount` is supplied by the
 * caller (Readeck's list payload omits it); progress is scaled to 0..1.
 */
export function readeckBookmarkToCard(bookmark: ReadeckBookmark, highlightCount = 0): Card {
  // Newsletters are saved with a reserved sentinel label; map them to the `email`
  // category and hide the sentinel from the user-facing tag list (the sender tag
  // stays). Derived from the label so it survives Readeck re-indexing on poll.
  const labels = bookmark.labels ?? [];
  const isEmail = labels.includes(EMAIL_LABEL);
  // The sender domain rides along as a `lectern:from:<domain>` label (set at
  // ingestion); recover it as the grouping key and hide it from user tags too.
  const domainLabel = labels.find((l) => l.startsWith(EMAIL_DOMAIN_LABEL_PREFIX));
  const senderDomain = domainLabel
    ? domainLabel.slice(EMAIL_DOMAIN_LABEL_PREFIX.length) || null
    : null;
  // Reserved labels are machine state, never user tags — stripped for EVERY
  // bookmark, not just email ones. A non-email bookmark can carry one too
  // (`lectern:discover`), and any reserved label that leaked into `tags` would be
  // echoed straight back by a tag edit, which is how the sentinels used to die.
  const tags = stripReservedLabels(labels);
  return {
    id: `readeck:${bookmark.id}`,
    source: "readeck",
    sourceId: bookmark.id,
    category: isEmail ? "email" : "article",
    location: readeckLocationFromArchived(bookmark.is_archived),
    readState: deriveReadeckReadState(bookmark.is_archived, bookmark.read_progress ?? 0),
    title: bookmark.title,
    excerpt: bookmark.description ? snippet(bookmark.description) : null,
    author: bookmark.authors?.[0] ?? null,
    siteName: bookmark.site_name ?? null,
    senderDomain,
    url: bookmark.url,
    coverImage: safeHttpUrl(bookmark.resources?.image?.src ?? bookmark.resources?.thumbnail?.src),
    wordCount: bookmark.word_count ?? null,
    readingTimeMinutes: bookmark.reading_time ?? null,
    readingProgress: progressFromReadeck(bookmark.read_progress ?? 0),
    readAnchor: bookmark.read_anchor ?? null,
    tags,
    highlightCount,
    note: null,
    savedAt: bookmark.created,
    updatedAt: bookmark.updated,
    // Null when Readeck extracted no publish date, deliberately: `publishedAt` is
    // the article's own date and nothing else. Defaulting it to the save time
    // would fabricate a publication date that reads as real everywhere it is
    // shown (issue dates, cadence, "10 most recent issues"). Consumers that want
    // an arrival instant do the fallback themselves and stay honest about it —
    // see `issueDate` in apps/web/src/lib/newsletters.ts.
    publishedAt: bookmark.published ?? null,
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
    const limit = Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, READECK_MAX_PAGE_SIZE);
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
    // Exclude transient discovery-extract bookmarks (label `lectern:discover`):
    // they live for only seconds and must NEVER become library documents. Drop
    // them from the emitted cards but advance the offset cursor by the RAW page
    // length (not the filtered count) so pagination stays correct.
    const items = body
      .filter((b) => !(b.labels ?? []).includes(DISCOVER_LABEL))
      .map((b) => readeckBookmarkToCard(b));
    const nextOffset = offset + body.length;
    // An empty page cannot advance the offset, so returning a cursor here would
    // hand every `do { } while (cursor)` caller the same offset forever.
    if (body.length === 0) return { items, nextCursor: null };
    // `Number(null)` is 0 and `Number("abc")` is NaN, and `n < NaN` is always
    // false -- so a missing OR malformed total-count header silently ended
    // pagination after page one. For `reconcileDeletions` that meant enumerating
    // one page and treating every document beyond it as deleted.
    //
    // With no trustworthy total, a FULL page is the only honest signal that more
    // may exist: keep going and let the empty-page guard above terminate. A short
    // page means the end. This can cost one extra request when the total happens
    // to be an exact multiple of the limit; truncating a deletion reconcile is
    // the far worse failure.
    // Read the header as a string first: `Number(null)` is 0, which is finite,
    // so an ABSENT header would otherwise read as a legitimate total of zero and
    // truncate just as surely as a malformed one.
    const totalHeader = res.headers.get("total-count");
    const rawTotal = totalHeader === null ? Number.NaN : Number(totalHeader);
    if (!Number.isFinite(rawTotal)) {
      return { items, nextCursor: body.length >= limit ? String(nextOffset) : null };
    }
    return { items, nextCursor: nextOffset < rawTotal ? String(nextOffset) : null };
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

  /**
   * Stream an article resource (image). The captured article HTML points at
   * resources by relative in-archive name (`img/<hash>`), served by the authed
   * `/x/*` route, or occasionally by a root-relative path (`/bm/...`) on the
   * Readeck host. Either form is fetched with the bearer token attached (harmless
   * on the public `/bm` route); the byte stream is relayed to the BFF image proxy.
   */
  async getResource(sourceId: string, ref: string): Promise<BackendResource> {
    const path = ref.startsWith("/")
      ? ref
      : `/api/bookmarks/${sourceId}/x/${ref.replace(/^\.?\//, "")}`;
    const res = await this.request(path);
    const len = res.headers.get("content-length");
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      contentLength: len ? Number(len) || null : null,
      body: res.body as AsyncIterable<Uint8Array>,
    };
  }

  /**
   * Save a URL and wait (bounded) for Readeck to finish extracting it.
   *
   * Returns the id only. The wait's outcome is NOT visible here — see
   * `saveWithStatus`, which is the same call with the extraction result attached.
   * Kept as-is because `save` is the `ReadLaterBackend` contract and because
   * giving up on the wait is not a save failure: the bookmark exists either way.
   */
  async save(input: { url: string; html?: string; labels?: string[] }): Promise<string> {
    return (await this.saveWithStatus(input)).sourceId;
  }

  /**
   * `save`, with the extraction outcome made observable.
   *
   * `loaded: false` means the bounded poll (20 tries × 1.2s ≈ 24s) expired with
   * Readeck still working — NOT that the save failed. Deliberately not an error:
   * the bookmark is real, a later poll/backfill picks the article up, and turning
   * a slow extraction into a throw would abort newsletter ingestion mid-batch
   * over a transiently busy Readeck.
   *
   * What a caller should do with it depends on whether it reads the content
   * straight back. Ingestion can ignore it (the next `pollReadeck` /
   * `backfillReadeckContent` fills the gap). A caller that immediately calls
   * `getContent` — discovery extract does — should treat `loaded: false` as
   * "content probably not ready yet" and prefer its fallback over an empty or
   * half-extracted article, rather than silently caching the gap.
   */
  async saveWithStatus(input: { url: string; html?: string; labels?: string[] }): Promise<{
    sourceId: string;
    loaded: boolean;
  }> {
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

    const loaded = await this.pollLoaded(id);
    return { sourceId: id, loaded };
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

  /**
   * Wait for Readeck to finish extracting a bookmark. Returns true when it
   * reported the article loaded, false when all `pollTries` were exhausted first.
   *
   * The distinction used to be invisible: the loop simply fell out and the caller
   * could not tell a fast extraction from 24 seconds of waiting in vain.
   */
  private async pollLoaded(sourceId: string): Promise<boolean> {
    for (let i = 0; i < this.pollTries; i++) {
      const res = await this.request(`/api/bookmarks/${sourceId}`);
      const bookmark = (await res.json()) as ReadeckBookmark;
      if (bookmark.loaded === true || bookmark.state === 0) return true;
      await sleep(this.pollIntervalMs);
    }
    return false;
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

  /**
   * Replace the bookmark's USER tags, preserving the reserved `lectern:` labels.
   *
   * Readeck's PATCH replaces the label array wholesale, so a naive write of the
   * user-facing tags erases the sentinels the card's identity is derived from
   * (see `RESERVED_LABEL_PREFIX`). The merge lives HERE, in the adapter, rather
   * than in `MutationApplier.setTags`, for three reasons:
   *
   *  - This is the only layer that can see the bookmark's raw labels. The overlay
   *    stores the stripped, user-facing tags, so the caller would have to
   *    reconstruct the sentinels from `category`/`senderDomain` — lossy, and it
   *    would silently drop any reserved label added later.
   *  - It protects EVERY caller, including future ones, instead of one method.
   *  - The full-replacement semantics are a Readeck detail; containing them here
   *    is what the adapter seam is for.
   *
   * The cost is one extra GET per label write. Tag edits are rare, user-initiated,
   * and already round-trip to the backend, so a second request is not worth
   * trading the invariant for. A failed GET aborts the write, which matches the
   * MutationApplier's rule that a backend failure aborts before the overlay write.
   */
  async setLabels(sourceId: string, labels: string[]): Promise<void> {
    const res = await this.request(`/api/bookmarks/${sourceId}`);
    const current = ((await res.json()) as ReadeckBookmark).labels ?? [];
    const reserved = current.filter(isReservedLabel);
    // User input cannot introduce a reserved label — it is machine state, and a
    // forged `lectern:email` would silently re-categorize a document.
    const next = [...reserved];
    for (const label of stripReservedLabels(labels)) {
      if (!next.includes(label)) next.push(label);
    }
    await this.request(`/api/bookmarks/${sourceId}`, {
      method: "PATCH",
      body: { labels: next },
    });
  }

  /**
   * Delete a bookmark at the source (full delete, mirrors `setArchived`'s
   * request/auth but with `DELETE /api/bookmarks/{id}`). A 404 means the
   * bookmark is already gone, which is success for a delete.
   */
  async delete(sourceId: string): Promise<void> {
    try {
      await this.request(`/api/bookmarks/${sourceId}`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof BackendHttpError && err.status === 404) return;
      throw err;
    }
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
