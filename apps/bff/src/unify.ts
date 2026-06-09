import type {
  Card,
  CreateViewRequest,
  Highlight,
  Location,
  NewHighlight,
  PlayerState,
  ReadState,
  SavedView,
  SearchResult,
  Source,
  Tag,
  TtsProvider,
  UpdateViewRequest,
} from "@lectern/shared";

/**
 * Unification: list + merge `Card`s from both backends and overlay BFF-owned
 * glue state (unified location/tags/note, RSS reading progress + highlight
 * counts). Also the pure mappers between the unified `Location`/`ReadState` and
 * each backend's native state, kept here so D4's mutation routes reuse them.
 */

/** A published podcast episode row (self-contained snapshot of the source card
 * plus a pointer to the cached audio by content hash). Kept here so the store
 * interface stays decoupled from the drizzle schema. */
export interface PodcastEpisodeRecord {
  documentId: string;
  contentHash: string;
  title: string;
  sourceUrl: string | null;
  excerpt: string | null;
  coverImage: string | null;
  author: string | null;
  mime: string;
  byteLength: number;
  durationSeconds: number;
  addedAt: Date;
}

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

/** Facets + age cutoff for a bulk maintenance sweep (delete / mark-read). The
 * facets scope it; `before`/`dateField` select everything older than a cutoff. */
export interface MaintenanceFilter {
  location?: Location;
  category?: string;
  source?: Source;
  before: Date;
  dateField: "savedAt" | "updatedAt";
  /** Match items whose timestamp equals `before` too (used to include an anchor). */
  inclusive?: boolean;
}

/** A sync delta read straight from the index: changed cards + deleted ids. */
export interface ChangedDocuments {
  cards: Card[];
  deletedIds: string[];
}

/** Minimal index-row identity used by bulk-delete routing (id -> source/sourceId). */
export interface DocumentRef {
  id: string;
  source: Source;
  sourceId: string;
}

/**
 * The BFF-owned glue store, split by responsibility. The production impl
 * (`DrizzleOverlayStore`) implements the whole composite (`OverlayStore`), but
 * each consumer SHOULD depend on the narrowest facet it needs — e.g.
 * `UnificationService` takes an `OverlayReader`, `MutationApplier` a
 * `DocumentStore & HighlightStore` — so neither has to know the full surface.
 */

/** The two overlay reads `UnificationService.applyOverlays` needs to merge glue
 * state onto a freshly-fetched backend card. */
export interface OverlayReader {
  getOverlays(ids: string[]): Promise<Record<string, Overlay>>;
  getRssHighlightCounts(ids: string[]): Promise<Record<string, number>>;
}

/**
 * The unified document index: the source-of-truth read path for the UI plus the
 * denormalized backend-truth/overlay rows the poll and the write path maintain.
 */
export interface DocumentStore extends OverlayReader {
  // --- index reads (the unified index is the source of truth for the UI) ---
  /** Filtered, sorted, paginated list of live (non-deleted) documents. */
  listDocuments(params: ListDocumentsParams): Promise<DocumentsPage>;
  /**
   * Delta for sync: live documents updated since `since` plus the ids of
   * documents soft-deleted since then. `since` undefined = full snapshot.
   */
  documentsChangedSince(since: string | undefined): Promise<ChangedDocuments>;

  // --- unified document index (denormalized, populated by backend polling) ---
  /** Reconstruct a fully-overlaid `Card` from the glue index, or null if absent. */
  getIndexedCard(id: string): Promise<Card | null>;
  /** Index a card writing BOTH backend-truth and overlay columns (new saves). */
  upsertIndex(card: Card): Promise<void>;
  /** Index from a backend poll: refresh backend-truth columns, PRESERVE overlay. */
  indexFromBackend(card: Card): Promise<void>;
  /**
   * Whether a document id already exists in the index. Lets the poll distinguish
   * a genuinely-new entry from a re-indexed one — `indexFromBackend` is a blind
   * upsert with no insert-vs-update signal. Must be called BEFORE indexing.
   */
  isIndexed(id: string): Promise<boolean>;
  /** Flip the read state on the indexed backend card (RSS "mark seen" on open). */
  markIndexedRead(id: string, read: boolean): Promise<void>;
  /** Drop the glue index + overlay (and RSS highlights) for a document. */
  deleteDocument(id: string): Promise<void>;
  /**
   * Tombstone (set `deletedAt`) the given ids so the deletion rides the next
   * `/sync` delta out to clients. Used by the full-delete path and bulk delete;
   * the row is kept (not hard-deleted) so `documentsChangedSince` can report it.
   */
  softDelete(ids: string[]): Promise<void>;
  /**
   * Live (non-tombstoned) documents in the given unified location, any source —
   * the targets of an "empty <location>" bulk delete.
   */
  listByLocation(location: Location): Promise<DocumentRef[]>;
  /**
   * Live (non-tombstoned) read documents of `source` — the targets of a
   * "delete all read feed items" bulk delete. Read state lives in the indexed
   * backend card (`metadata.card.readState === "finished"`).
   */
  listReadBySource(source: Source): Promise<DocumentRef[]>;
  /**
   * Live (non-tombstoned) documents matching the facets whose `dateField`
   * precedes `before` — the targets of an age-based delete/mark-read sweep
   * ("older than a week" / "everything below this item").
   */
  listForMaintenance(filter: MaintenanceFilter): Promise<DocumentRef[]>;
  /** Batch-flip the read state on indexed backend cards (age-based mark-read). */
  markIndexedReadMany(ids: string[], read: boolean): Promise<void>;
  /** Live email-category documents grouped by sender (card author), with counts —
   * powers the Settings ignore list's "senders in your library". */
  listEmailSenders(): Promise<{ name: string; count: number }[]>;
  /** Live email-category documents from `sender` (author, case-insensitive) —
   * the existing emails removed when a sender is added to the ignore list. */
  listEmailDocsBySender(sender: string): Promise<DocumentRef[]>;
  /**
   * Soft-delete (tombstone) live documents of `source` whose id is not in
   * `presentIds` — the backend no longer has them. Returns how many were marked.
   */
  softDeleteMissing(source: Source, presentIds: Set<string>): Promise<number>;

  // --- overlay writes (BFF-owned columns; win over backend truth on merge) ---
  upsertOverlay(id: string, patch: OverlayPatch): Promise<void>;
}

/** Captured article HTML + full-text search over owned bodies. */
export interface ContentStore {
  /** Stored article HTML for a document, or null if we haven't captured it yet. */
  getContent(id: string): Promise<{ html: string } | null>;
  /** Store/refresh the captured article HTML (no-op for empty html). */
  putContent(id: string, html: string): Promise<void>;
  /** Full-text search over owned bodies (live docs only), ranked, with snippets. */
  searchContent(q: string, limit: number): Promise<SearchResult[]>;
}

/** Cross-source organization: aggregated tags + saved views. */
export interface OrganizationStore {
  listTags(): Promise<Tag[]>;
  listViews(): Promise<SavedView[]>;
  createView(input: CreateViewRequest): Promise<SavedView>;
  updateView(id: string, patch: UpdateViewRequest): Promise<SavedView | null>;
  deleteView(id: string): Promise<boolean>;
}

/** BFF-owned RSS highlights (MiniFlux has no highlight API). */
export interface HighlightStore {
  listRssHighlights(documentId: string): Promise<Highlight[]>;
  addRssHighlight(documentId: string, input: NewHighlight): Promise<Highlight>;
  removeRssHighlight(highlightId: string): Promise<boolean>;
}

/**
 * Pure server-side asset + config caches that are NOT part of the unified
 * document model: TTS config/audio, the podcast feed, reader accent, and the
 * cross-device Listen player state.
 */
export interface AssetStore {
  // --- text-to-speech config + audio cache (BFF-owned, server-side only) ---
  /** TTS config including the raw API key. Server-internal: NEVER sent to the SPA. */
  getTtsConfig(): Promise<{
    provider: TtsProvider;
    apiKey: string | null;
    voiceId: string;
    modelId: string;
  }>;
  /** Merge a partial TTS config patch (apiKey === null clears the key). */
  setTtsConfig(patch: {
    provider?: TtsProvider;
    apiKey?: string | null;
    voiceId?: string;
    modelId?: string;
  }): Promise<void>;

  // --- newsletter ignore list (matched against incoming From name/address) ---
  /** Ignored newsletter senders (names and/or addresses). Empty when unset. */
  getEmailIgnoreList(): Promise<string[]>;
  /** Replace the ignored-sender list (normalized: trimmed, de-duped, no blanks). */
  setEmailIgnoreList(senders: string[]): Promise<void>;
  /** Synthesized audio cached under a content hash, or null on a miss. */
  getCachedAudio(contentHash: string): Promise<{ mime: string; bytes: Buffer } | null>;
  /** Persist synthesized audio under its content hash (ignored if it exists). */
  putCachedAudio(row: {
    contentHash: string;
    documentId: string;
    mime: string;
    bytes: Buffer;
    charCount: number;
  }): Promise<void>;

  // --- podcast feed (tokenized RSS of rendered episodes) ---
  /** The feed token if one has been minted, else null. */
  getPodcastToken(): Promise<string | null>;
  /** The feed token, minting (and persisting) one on first use. */
  ensurePodcastToken(): Promise<string>;
  /** Mint a fresh feed token, revoking the previous URL. */
  regeneratePodcastToken(): Promise<string>;
  /** Add (or refresh) a podcast episode for a document (idempotent per document). */
  addPodcastEpisode(row: Omit<PodcastEpisodeRecord, "addedAt">): Promise<void>;
  /** All published episodes, newest first. */
  listPodcastEpisodes(): Promise<PodcastEpisodeRecord[]>;
  /** A single episode by document id, or null if it isn't published. */
  getPodcastEpisode(documentId: string): Promise<PodcastEpisodeRecord | null>;

  // --- adaptive reader accent (cover-derived colour cache) ---
  /** Cached accent: a hex string, null for "computed, no colour", or undefined
   *  when not yet computed. */
  getAccent(documentId: string): Promise<string | null | undefined>;
  /** Persist a computed accent (null records "no usable colour"). */
  putAccent(documentId: string, color: string | null): Promise<void>;

  // --- cross-device Listen player state ---
  /** The player's queue/index/position/rate (defaults when never saved). */
  getPlayerState(): Promise<PlayerState>;
  /** Persist the player state; stamps updatedAt and returns the saved value. */
  setPlayerState(state: PlayerState): Promise<PlayerState>;
}

/**
 * The full glue store: the composite of every focused facet, implemented by
 * `DrizzleOverlayStore`. Held by `AppDeps.overlay`; prefer a narrower facet at
 * each consumer (see the per-interface docs above).
 */
export interface OverlayStore
  extends DocumentStore, ContentStore, OrganizationStore, HighlightStore, AssetStore {}

/**
 * Applies BFF-owned glue-DB overlay state onto already-normalized backend cards.
 * The unified index (`OverlayStore.listDocuments` / `documentsChangedSince`) is
 * the source of truth for every list and sync read; this service is only used on
 * the live get-by-id path, to overlay a single Readeck card fetched fresh from
 * the backend (see `routes.ts` `loadDocument`).
 */
export class UnificationService {
  constructor(private readonly overlays: OverlayReader) {}

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
