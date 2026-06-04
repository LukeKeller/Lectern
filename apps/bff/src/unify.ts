import type {
  BackendListParams,
  BackendPage,
  Card,
  CreateViewRequest,
  Highlight,
  Location,
  NewHighlight,
  ReadLaterBackend,
  ReadState,
  RssBackend,
  SavedView,
  SearchResult,
  Source,
  Tag,
  UpdateViewRequest,
} from "@lectern/shared";

/**
 * Unification: list + merge `Card`s from both backends and overlay BFF-owned
 * glue state (unified location/tags/note, RSS reading progress + highlight
 * counts). Also the pure mappers between the unified `Location`/`ReadState` and
 * each backend's native state, kept here so D4's mutation routes reuse them.
 */

// ---- Pure progress + state mappers -----------------------------------------

/** Readeck stores reading progress as an integer 0..100; the model uses 0..1. */
export function progressToReadeck(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.round(clamped * 100);
}

export function progressFromReadeck(value: number): number {
  return Math.min(1, Math.max(0, value / 100));
}

/**
 * Readeck has no read-status enum; derive it from archive + progress:
 * archived or fully scrolled => finished, any progress => reading, else unopened.
 */
export function deriveReadeckReadState(isArchived: boolean, readProgress0to100: number): ReadState {
  if (isArchived || readProgress0to100 >= 100) return "finished";
  if (readProgress0to100 > 0) return "reading";
  return "unopened";
}

/** Unified location implied purely by Readeck's `is_archived` flag. */
export function readeckLocationFromArchived(isArchived: boolean): Location {
  return isArchived ? "archive" : "later";
}

/** Whether a unified location should set Readeck's `is_archived`. */
export function locationToReadeckArchived(location: Location): boolean {
  return location === "archive";
}

/** Whether a unified location should mark a MiniFlux entry read. */
export function locationToMinifluxRead(location: Location): boolean {
  return location === "archive";
}

// ---- Glue-DB overlay --------------------------------------------------------

/** BFF-owned overlay for a single unified document (subset of the documents row). */
export interface Overlay {
  location?: Location | null;
  tags?: string[] | null;
  note?: string | null;
  /** RSS-only: BFF-owned reading progress 0..1. */
  readProgress?: number | null;
  /** RSS-only: BFF-owned scroll anchor. */
  readAnchor?: string | null;
}

/**
 * Apply a glue-DB overlay onto a normalized card. For RSS cards reading
 * progress/anchor and highlight count are BFF-owned and always overlaid; unified
 * location/tags/note win over backend-derived values when present for any source.
 */
export function mergeOverlay(card: Card, overlay?: Overlay, rssHighlightCount = 0): Card {
  let next: Card = card;

  if (card.source === "miniflux") {
    next = {
      ...next,
      highlightCount: rssHighlightCount,
      readingProgress: overlay?.readProgress ?? next.readingProgress,
      readAnchor: overlay?.readAnchor ?? next.readAnchor,
    };
  }

  if (overlay) {
    next = {
      ...next,
      location: overlay.location ?? next.location,
      tags: overlay.tags && overlay.tags.length > 0 ? overlay.tags : next.tags,
      note: overlay.note ?? next.note,
    };
  }

  return next;
}

// ---- Combined cursor --------------------------------------------------------

/** Encode the two per-backend cursors into one opaque cursor; null when both done. */
export function encodeCombinedCursor(rss: string | null, readLater: string | null): string | null {
  if (rss === null && readLater === null) return null;
  return Buffer.from(JSON.stringify({ m: rss, r: readLater })).toString("base64url");
}

export function decodeCombinedCursor(cursor: string | undefined): {
  rss: string | null | undefined;
  readLater: string | null | undefined;
} {
  if (!cursor) return { rss: undefined, readLater: undefined };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      m: string | null;
      r: string | null;
    };
    // Preserve null: a null sub-cursor means that backend is EXHAUSTED (skip it
    // on the next page), which is distinct from undefined (no cursor yet -> start
    // from the top). Collapsing the two made a finished backend restart, so a
    // paginating caller would loop forever and re-emit its first page.
    return { rss: parsed.m, readLater: parsed.r };
  } catch {
    return { rss: undefined, readLater: undefined };
  }
}

// ---- Service ----------------------------------------------------------------

/** Partial overlay write for a single unified document (glue `documents` row). */
export interface OverlayPatch {
  location?: Location;
  tags?: string[];
  note?: string | null;
  readProgress?: number;
  readAnchor?: string | null;
  title?: string;
}

/** Filters + pagination for an index list query. Cursor is an opaque offset. */
export interface ListDocumentsParams {
  location?: Location;
  category?: string;
  source?: Source;
  tag?: string;
  search?: string;
  pageSize: number;
  cursor?: string;
}

export interface DocumentsPage {
  cards: Card[];
  nextCursor: string | null;
}

/** A sync delta read straight from the index: changed cards + deleted ids. */
export interface ChangedDocuments {
  cards: Card[];
  deletedIds: string[];
}

/**
 * The BFF-owned glue store. `UnificationService` only consumes the two read
 * methods at the top; the API routes use the full surface. Abstracted so routes
 * are unit-testable without a live Postgres (the production impl is drizzle, the
 * tests inject an in-memory fake).
 */
export interface OverlayStore {
  // --- index reads (the unified index is the source of truth for the UI) ---
  /** Filtered, sorted, paginated list of live (non-deleted) documents. */
  listDocuments(params: ListDocumentsParams): Promise<DocumentsPage>;
  /**
   * Delta for sync: live documents updated since `since` plus the ids of
   * documents soft-deleted since then. `since` undefined = full snapshot.
   */
  documentsChangedSince(since: string | undefined): Promise<ChangedDocuments>;
  // --- consumed by UnificationService ---
  getOverlays(ids: string[]): Promise<Record<string, Overlay>>;
  getRssHighlightCounts(ids: string[]): Promise<Record<string, number>>;

  // --- unified document index (denormalized, populated by backend polling) ---
  /** Reconstruct a fully-overlaid `Card` from the glue index, or null if absent. */
  getIndexedCard(id: string): Promise<Card | null>;
  /** Index a card writing BOTH backend-truth and overlay columns (new saves). */
  upsertIndex(card: Card): Promise<void>;
  /** Index from a backend poll: refresh backend-truth columns, PRESERVE overlay. */
  indexFromBackend(card: Card): Promise<void>;
  /** Flip the read state on the indexed backend card (RSS "mark seen" on open). */
  markIndexedRead(id: string, read: boolean): Promise<void>;
  /** Drop the glue index + overlay (and RSS highlights) for a document. */
  deleteDocument(id: string): Promise<void>;
  /**
   * Soft-delete (tombstone) live documents of `source` whose id is not in
   * `presentIds` — the backend no longer has them. Returns how many were marked.
   */
  softDeleteMissing(source: Source, presentIds: Set<string>): Promise<number>;

  // --- owned article content + full-text search ---
  /** Stored article HTML for a document, or null if we haven't captured it yet. */
  getContent(id: string): Promise<{ html: string } | null>;
  /** Store/refresh the captured article HTML (no-op for empty html). */
  putContent(id: string, html: string): Promise<void>;
  /** Full-text search over owned bodies (live docs only), ranked, with snippets. */
  searchContent(q: string, limit: number): Promise<SearchResult[]>;

  // --- overlay writes ---
  upsertOverlay(id: string, patch: OverlayPatch): Promise<void>;

  // --- tags ---
  listTags(): Promise<Tag[]>;

  // --- saved views ---
  listViews(): Promise<SavedView[]>;
  createView(input: CreateViewRequest): Promise<SavedView>;
  updateView(id: string, patch: UpdateViewRequest): Promise<SavedView | null>;
  deleteView(id: string): Promise<boolean>;

  // --- RSS highlights (BFF-owned; MiniFlux has no highlight API) ---
  listRssHighlights(documentId: string): Promise<Highlight[]>;
  addRssHighlight(documentId: string, input: NewHighlight): Promise<Highlight>;
  removeRssHighlight(highlightId: string): Promise<boolean>;
}

/**
 * Resolve one backend's settled list result. A fulfilled result passes through;
 * a rejection degrades to an empty page that retains the backend's incoming
 * cursor, so the offline/faulting backend is retried on the next pull without
 * sinking the sibling backend's results. The failure is logged for operators.
 */
function settledPage(
  result: PromiseSettledResult<BackendPage<Card>>,
  label: string,
  fallbackCursor: string | undefined,
): BackendPage<Card> {
  if (result.status === "fulfilled") return result.value;
  console.warn(`[unify] ${label} backend list failed; serving partial results:`, result.reason);
  return { items: [], nextCursor: fallbackCursor ?? null };
}

export class UnificationService {
  constructor(
    private readonly rss: RssBackend,
    private readonly readLater: ReadLaterBackend,
    private readonly overlays: OverlayStore,
  ) {}

  /**
   * List from both backends in parallel, then overlay glue state. The two
   * backends are independent: if one is unreachable or faulting (e.g. MiniFlux
   * returns 404), we still serve the other's items rather than failing the whole
   * pull — otherwise a single broken backend would empty the entire library and
   * feed. A failed backend keeps its incoming cursor so the next pull retries it.
   * Only when BOTH backends fail do we surface the error (a real outage).
   */
  async list(params: BackendListParams): Promise<BackendPage<Card>> {
    const cursors = decodeCombinedCursor(params.cursor);
    const exhausted: BackendPage<Card> = { items: [], nextCursor: null };
    const [rssResult, readLaterResult] = await Promise.allSettled([
      cursors.rss === null
        ? Promise.resolve(exhausted)
        : this.rss.listEntries({ ...params, cursor: cursors.rss }),
      cursors.readLater === null
        ? Promise.resolve(exhausted)
        : this.readLater.list({ ...params, cursor: cursors.readLater }),
    ]);

    if (rssResult.status === "rejected" && readLaterResult.status === "rejected") {
      throw rssResult.reason;
    }

    const rssPage = settledPage(rssResult, "rss", cursors.rss ?? undefined);
    const readLaterPage = settledPage(
      readLaterResult,
      "read-later",
      cursors.readLater ?? undefined,
    );

    const items = await this.applyOverlays([...rssPage.items, ...readLaterPage.items]);
    return {
      items,
      nextCursor: encodeCombinedCursor(rssPage.nextCursor, readLaterPage.nextCursor),
    };
  }

  /** Overlay glue-DB state onto already-normalized cards. */
  async applyOverlays(cards: Card[]): Promise<Card[]> {
    if (cards.length === 0) return cards;
    const ids = cards.map((c) => c.id);
    const [overlays, highlightCounts] = await Promise.all([
      this.overlays.getOverlays(ids),
      this.overlays.getRssHighlightCounts(ids),
    ]);
    return cards.map((card) =>
      mergeOverlay(card, overlays[card.id], highlightCounts[card.id] ?? 0),
    );
  }
}
