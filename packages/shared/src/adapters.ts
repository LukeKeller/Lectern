import type { Feed, FeedFolder } from "./feeds";
import type { Card, Highlight } from "./model";

/**
 * Backend adapter seam. The BFF talks to MiniFlux and the read-later backend only
 * through these interfaces, so the read-later backend (Readeck) can be swapped for
 * Wallabag by writing one adapter. Adapters return normalized `Card`s (units already
 * converted: reading progress 0..1, reading time in minutes).
 */

export interface BackendListParams {
  /** ISO-8601; return items changed strictly after this instant. */
  updatedAfter?: string;
  cursor?: string;
  pageSize?: number;
  search?: string;
}

export interface BackendPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** RSS backend (MiniFlux). Owns feeds/entries/read-state/star. */
export interface RssBackend {
  listEntries(params: BackendListParams & { onlyUnread?: boolean }): Promise<BackendPage<Card>>;
  getEntryContent(sourceId: string): Promise<string>;
  setRead(sourceId: string, read: boolean): Promise<void>;
  /** Batch read/unread for an age-based sweep. One request for the whole set. */
  setReadMany(sourceIds: string[], read: boolean): Promise<void>;
  setStarred(sourceId: string, starred: boolean): Promise<void>;
  /**
   * Hide entries from the feed at the source. MiniFlux has no hard delete; the
   * `removed` status hides an entry so it no longer lists (and the poll won't
   * re-index it). Batch-capable so a bulk delete is one request.
   */
  setRemoved(sourceIds: string[]): Promise<void>;
  /** Trigger a feed refresh (all feeds). */
  refresh(): Promise<void>;
  exportOpml(): Promise<string>;
  // Feed + folder management.
  listFeeds(): Promise<{ feeds: Feed[]; folders: FeedFolder[] }>;
  subscribe(input: { feedUrl: string; folderId?: string }): Promise<Feed>;
  updateFeed(id: string, patch: { folderId?: string | null; title?: string }): Promise<Feed>;
  deleteFeed(id: string): Promise<void>;
  /** Import an OPML document; returns a status message. */
  importOpml(opml: string): Promise<string>;
}

export type NewHighlight = Omit<Highlight, "id" | "documentId" | "createdAt">;

/** Read-later backend (Readeck). Owns saved-article content/progress/highlights. */
export interface ReadLaterBackend {
  list(params: BackendListParams): Promise<BackendPage<Card>>;
  get(sourceId: string): Promise<Card>;
  getContent(sourceId: string): Promise<string>;
  /** Save a URL (optionally with prefetched HTML). Returns the new source id. */
  save(input: { url: string; html?: string; labels?: string[] }): Promise<string>;
  /**
   * Create a bookmark without waiting for extraction to finish (fire-and-forget).
   * Used by bulk import where polling each item would be prohibitively slow.
   * Returns the new source id.
   */
  createBookmark(input: { url: string; labels?: string[]; archived?: boolean }): Promise<string>;
  /** progress is 0..1; the adapter scales to the backend's native unit. */
  setReadingProgress(sourceId: string, progress: number, anchor: string | null): Promise<void>;
  setArchived(sourceId: string, archived: boolean): Promise<void>;
  /**
   * Delete a bookmark at the source so the poll can't re-add it. A 404 is treated
   * as success (the bookmark is already gone).
   */
  delete(sourceId: string): Promise<void>;
  setLabels(sourceId: string, labels: string[]): Promise<void>;
  listHighlights(sourceId: string): Promise<Highlight[]>;
  addHighlight(sourceId: string, highlight: NewHighlight): Promise<Highlight>;
  removeHighlight(sourceId: string, highlightId: string): Promise<void>;
}
