import { FINISHED_THRESHOLD } from "@lectern/shared";
import type {
  Card,
  CandidateStatus,
  CreateCandidateInput,
  CreateRunRequest,
  CreateViewRequest,
  DiscoveryCandidate,
  DiscoveryConfig,
  DiscoveryProfile,
  DiscoveryRun,
  DiscoverySeed,
  DiscoveryVote,
  FollowSuggestion,
  Highlight,
  Location,
  NewHighlight,
  PlayerState,
  ReadState,
  SavedView,
  SearchResult,
  Source,
  SourceThemeSummary,
  Tag,
  TagSuggestion,
  TtsProvider,
  UpdateDiscoverySettingsRequest,
  UpdateRunRequest,
  UpdateViewRequest,
  VoteValue,
} from "@lectern/shared";
import type { SourceThemeTokens } from "./source-theme";

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
 * Readeck has no read-status enum; derive it from archive + progress: archived or
 * scrolled past the finished threshold => finished, any progress => reading, else
 * unopened. `FINISHED_THRESHOLD` is 0..1; Readeck stores progress as an integer
 * 0..100, so scale it for the comparison.
 */
export function deriveReadeckReadState(isArchived: boolean, readProgress0to100: number): ReadState {
  if (isArchived || readProgress0to100 >= FINISHED_THRESHOLD * 100) return "finished";
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
   * Live (non-tombstoned) read email-category documents — the newsletter half of
   * the global "delete all read" sweep. Newsletters are Readeck docs with no read
   * enum, so "read" is progress past the finished threshold OR a denormalized
   * `readState === "finished"` (matches the client's `isFinished`).
   */
  listReadEmail(): Promise<DocumentRef[]>;
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
  /**
   * "More like this": up to `limit` library documents most similar (TF-IDF
   * cosine, local IR) to the given one. Null if the source doc doesn't exist;
   * an empty array is a valid "found, nothing related" answer.
   */
  relatedDocuments(id: string, limit: number): Promise<Card[] | null>;
}

/** Cross-source organization: aggregated tags + saved views. */
export interface OrganizationStore {
  listTags(): Promise<Tag[]>;
  /**
   * Suggested tags for a document: cosine of the doc's TF-IDF vector to each
   * tag's centroid over the library (local IR, no LLM), excluding tags it
   * already has. Null if the doc doesn't exist; empty array is a valid answer.
   */
  tagSuggestions(id: string): Promise<TagSuggestion[] | null>;
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

  // --- per-source ("dress") theming (host-keyed token cache) ---
  /** Cached source theming tokens for a host plus the time they were fetched (for
   *  a TTL), or undefined when not yet fetched. */
  getSourceTheme(host: string): Promise<{ tokens: SourceThemeTokens; fetchedAt: Date } | undefined>;
  /** Persist a source's theming tokens (empty fields record "checked, none"). */
  putSourceTheme(host: string, theme: SourceThemeTokens): Promise<void>;
  /** Every cached source theme as a summary (host + tokens + fetch time). */
  listSourceThemes(): Promise<SourceThemeSummary[]>;
  /** Drop every cached source theme so each host re-fetches on next open. */
  clearSourceThemes(): Promise<void>;

  // --- cross-device Listen player state ---
  /** The player's queue/index/position/rate (defaults when never saved). */
  getPlayerState(): Promise<PlayerState>;
  /** Persist the player state; stamps updatedAt and returns the saved value. */
  setPlayerState(state: PlayerState): Promise<PlayerState>;
}

/**
 * Content-discovery store (BFF-owned; the BFF is the single writer of every
 * discovery table). Backs the user-facing Discover/Activity views and the
 * service-facing endpoints the discovery worker calls. Maps rows <-> the shared
 * contract types (timestamps to ISO strings; candidate metadata jsonb <->
 * author/siteName/imageUrl/publishedAt).
 */
export interface DiscoveryStore {
  /** Candidates for the Discover view, most-relevant first, capped by `limit`. */
  listCandidates(params: {
    status?: CandidateStatus;
    limit: number;
  }): Promise<DiscoveryCandidate[]>;
  /** Bulk-insert scored candidates, deduped by normalized URL (ON CONFLICT DO
   *  NOTHING) and skipping any URL already saved as a document. */
  insertCandidates(inputs: CreateCandidateInput[]): Promise<{ inserted: number; skipped: number }>;
  /** A single candidate by id, or null if it doesn't exist. */
  getCandidate(id: string): Promise<DiscoveryCandidate | null>;
  /** Set a candidate's status (and optionally its vote); returns the updated row. */
  setCandidateStatus(
    id: string,
    status: CandidateStatus,
    vote?: VoteValue | null,
  ): Promise<DiscoveryCandidate | null>;
  /** Record an up/down vote: append a vote row copying the candidate's term
   *  vector, then update the candidate (up keeps it active, down dismisses it). */
  recordVote(candidateId: string, value: VoteValue): Promise<DiscoveryCandidate | null>;
  /** Dismiss active candidates WITHOUT recording a vote (no training). No ids =
   *  clear all active. Returns how many were cleared. */
  clearCandidates(ids?: string[]): Promise<number>;
  /** Votes not yet folded into the profile (worker training input). */
  listUnprocessedVotes(): Promise<DiscoveryVote[]>;
  /** Persist the profile AND mark the given vote ids processed, atomically. */
  putDiscoveryProfile(
    profile: DiscoveryProfile,
    processedVoteIds: number[],
  ): Promise<DiscoveryProfile>;
  /** The persisted profile, or an empty default profile if none exists yet. */
  getDiscoveryProfile(): Promise<DiscoveryProfile>;
  /** Raw stored settings, including the Brave key (worker config view). */
  getDiscoverySettings(): Promise<DiscoveryConfig>;
  /** Merge a settings patch (braveApiKey omitted = unchanged; null/"" = clear). */
  setDiscoverySettings(patch: UpdateDiscoverySettingsRequest): Promise<void>;
  /** Weighted seed corpus assembled from existing library signals. */
  buildDiscoverySeed(): Promise<DiscoverySeed>;
  /** Open a run record (status = running). */
  createRun(input: CreateRunRequest): Promise<DiscoveryRun>;
  /** Update a run's stage/status/stats/error (stats shallow-merged). */
  updateRun(id: string, patch: UpdateRunRequest): Promise<DiscoveryRun | null>;
  /** Recent runs, newest first, capped by `limit`. */
  listRuns(limit: number): Promise<DiscoveryRun[]>;
  /** The current/most-recent run, or null if none. */
  getLatestRun(): Promise<DiscoveryRun | null>;
  /** Domains with at least `minSignals` DISTINCT saved/up-voted candidates —
   *  auto-follow suggestions, sorted by signal count desc. */
  suggestFollowDomains(minSignals: number): Promise<FollowSuggestion[]>;
}

/**
 * The full glue store: the composite of every focused facet, implemented by
 * `DrizzleOverlayStore`. Held by `AppDeps.overlay`; prefer a narrower facet at
 * each consumer (see the per-interface docs above).
 */
export interface OverlayStore
  extends
    DocumentStore,
    ContentStore,
    OrganizationStore,
    HighlightStore,
    AssetStore,
    DiscoveryStore {}

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
