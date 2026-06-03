import type {
  BackendListParams,
  BackendPage,
  Card,
  Location,
  ReadLaterBackend,
  ReadState,
  RssBackend,
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
  rss: string | undefined;
  readLater: string | undefined;
} {
  if (!cursor) return { rss: undefined, readLater: undefined };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      m: string | null;
      r: string | null;
    };
    return { rss: parsed.m ?? undefined, readLater: parsed.r ?? undefined };
  } catch {
    return { rss: undefined, readLater: undefined };
  }
}

// ---- Service ----------------------------------------------------------------

/**
 * Source of glue-DB overlays. Abstracted so the service is unit-testable without
 * a live Postgres; the production implementation is backed by drizzle.
 */
export interface OverlayStore {
  getOverlays(ids: string[]): Promise<Record<string, Overlay>>;
  getRssHighlightCounts(ids: string[]): Promise<Record<string, number>>;
}

export class UnificationService {
  constructor(
    private readonly rss: RssBackend,
    private readonly readLater: ReadLaterBackend,
    private readonly overlays: OverlayStore,
  ) {}

  /** List from both backends in parallel, then overlay glue state. */
  async list(params: BackendListParams): Promise<BackendPage<Card>> {
    const cursors = decodeCombinedCursor(params.cursor);
    const [rssPage, readLaterPage] = await Promise.all([
      this.rss.listEntries({ ...params, cursor: cursors.rss }),
      this.readLater.list({ ...params, cursor: cursors.readLater }),
    ]);
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
