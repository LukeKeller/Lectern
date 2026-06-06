import { randomUUID } from "node:crypto";
import {
  and,
  arrayContains,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql as dsql,
} from "drizzle-orm";
import { Card, PlayerState } from "@lectern/shared";
import type {
  CreateViewRequest,
  Highlight,
  HighlightColor,
  Location,
  NewHighlight,
  SavedView,
  SearchResult,
  Source,
  Tag,
  TtsProvider,
  UpdateViewRequest,
} from "@lectern/shared";
import type { Db } from "./db/client";
import {
  appSettings,
  documentAccent,
  documentContent,
  documents,
  podcastEpisodes,
  rssHighlights,
  savedViews,
  ttsAudio,
} from "./db/schema";
import type {
  DocumentRow,
  NewDocumentRow,
  NewPodcastEpisodeRow,
  PodcastEpisodeRow,
} from "./db/schema";
import { parseId } from "./ids";
import {
  mergeOverlay,
  type ChangedDocuments,
  type DocumentRef,
  type DocumentsPage,
  type ListDocumentsParams,
  type Overlay,
  type OverlayPatch,
  type OverlayStore,
} from "./unify";

/**
 * Glue-DB-backed `OverlayStore`. Backs the unified document index (one row per
 * document, backend-truth denormalized into `metadata.card` + queryable columns),
 * the BFF-owned overlay columns (location/tags/note/read_progress/read_anchor),
 * RSS highlights, tags, and saved views. The backends remain authoritative for
 * their own data; this store holds only what they cannot.
 */
export class DrizzleOverlayStore implements OverlayStore {
  constructor(private readonly db: Db) {}

  async getOverlays(ids: string[]): Promise<Record<string, Overlay>> {
    if (ids.length === 0) return {};
    const rows = await this.db.select().from(documents).where(inArray(documents.id, ids));
    const out: Record<string, Overlay> = {};
    for (const row of rows) {
      out[row.id] = {
        location: row.location as Location,
        tags: row.tags,
        note: row.note,
        readProgress: row.readProgress,
        readAnchor: row.readAnchor,
      };
    }
    return out;
  }

  async getRssHighlightCounts(ids: string[]): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const rows = await this.db
      .select({ documentId: rssHighlights.documentId, count: dsql<number>`count(*)::int` })
      .from(rssHighlights)
      .where(inArray(rssHighlights.documentId, ids))
      .groupBy(rssHighlights.documentId);
    const out: Record<string, number> = {};
    for (const row of rows) out[row.documentId] = row.count;
    return out;
  }

  async getIndexedCard(id: string): Promise<Card | null> {
    const [row] = await this.db.select().from(documents).where(eq(documents.id, id));
    if (!row) return null;
    const counts = await this.getRssHighlightCounts([id]);
    return cardFromRow(row, counts[id] ?? 0);
  }

  async listDocuments(params: ListDocumentsParams): Promise<DocumentsPage> {
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const conds = [isNull(documents.deletedAt)];
    if (params.location) conds.push(eq(documents.location, params.location));
    if (params.category) conds.push(eq(documents.category, params.category));
    if (params.source) conds.push(eq(documents.source, params.source));
    if (params.tag) conds.push(arrayContains(documents.tags, [params.tag]));
    if (params.search) {
      const like = `%${params.search}%`;
      conds.push(dsql`(${documents.title} ilike ${like} or ${documents.url} ilike ${like})`);
    }
    // Fetch one extra row to tell whether another page exists.
    const rows = await this.db
      .select()
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(params.pageSize + 1)
      .offset(offset);
    const hasMore = rows.length > params.pageSize;
    const pageRows = hasMore ? rows.slice(0, params.pageSize) : rows;
    const cards = await this.cardsFromRows(pageRows);
    return { cards, nextCursor: hasMore ? String(offset + pageRows.length) : null };
  }

  async documentsChangedSince(since: string | undefined): Promise<ChangedDocuments> {
    if (!since) {
      const rows = await this.db.select().from(documents).where(isNull(documents.deletedAt));
      return { cards: await this.cardsFromRows(rows), deletedIds: [] };
    }
    const sinceDate = new Date(since);
    const changed = await this.db
      .select()
      .from(documents)
      .where(and(isNull(documents.deletedAt), gt(documents.updatedAt, sinceDate)));
    const deleted = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(isNotNull(documents.deletedAt), gt(documents.deletedAt, sinceDate)));
    return {
      cards: await this.cardsFromRows(changed),
      deletedIds: deleted.map((r) => r.id),
    };
  }

  /** Reconstruct cards from index rows, batching the highlight-count lookup. */
  private async cardsFromRows(rows: DocumentRow[]): Promise<Card[]> {
    if (rows.length === 0) return [];
    const counts = await this.getRssHighlightCounts(rows.map((r) => r.id));
    const cards: Card[] = [];
    for (const row of rows) {
      const card = cardFromRow(row, counts[row.id] ?? 0);
      if (card) cards.push(card);
    }
    return cards;
  }

  async upsertIndex(card: Card): Promise<void> {
    const row = rowFromCard(card);
    // A new save: the card is the source of truth for BOTH ownership zones, so the
    // overlay columns are written alongside the backend-truth ones.
    await this.db
      .insert(documents)
      .values(row)
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          ...backendTruthSet(row),
          location: row.location,
          readProgress: row.readProgress,
          readAnchor: row.readAnchor,
          tags: row.tags,
          note: row.note,
        },
      });
  }

  async indexFromBackend(card: Card): Promise<void> {
    const row = rowFromCard(card);
    // A poll refresh: backend-truth columns only. The overlay columns stay
    // BFF-authoritative — `backendTruthSet` cannot reach them.
    await this.db
      .insert(documents)
      .values(row)
      .onConflictDoUpdate({ target: documents.id, set: backendTruthSet(row) });
  }

  async isIndexed(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, id));
    return !!row;
  }

  async markIndexedRead(id: string, read: boolean): Promise<void> {
    const [row] = await this.db.select().from(documents).where(eq(documents.id, id));
    const meta = (row?.metadata ?? null) as { card?: Card } | null;
    if (!meta?.card) return;
    // Patch the stored backend card's read state and bump updatedAt so the
    // change rides the next sync delta out to clients.
    const card: Card = { ...meta.card, readState: read ? "finished" : "unopened" };
    await this.db
      .update(documents)
      .set({ metadata: { ...meta, card }, updatedAt: new Date() })
      .where(eq(documents.id, id));
  }

  async deleteDocument(id: string): Promise<void> {
    await this.db.delete(rssHighlights).where(eq(rssHighlights.documentId, id));
    await this.db.delete(documents).where(eq(documents.id, id));
  }

  async softDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date();
    for (let i = 0; i < ids.length; i += 500) {
      await this.db
        .update(documents)
        .set({ deletedAt: now })
        .where(inArray(documents.id, ids.slice(i, i + 500)));
    }
  }

  async listByLocation(location: Location): Promise<DocumentRef[]> {
    const rows = await this.db
      .select({ id: documents.id, source: documents.source, sourceId: documents.sourceId })
      .from(documents)
      .where(and(eq(documents.location, location), isNull(documents.deletedAt)));
    return rows.map((r) => ({ id: r.id, source: r.source as Source, sourceId: r.sourceId }));
  }

  async listReadBySource(source: Source): Promise<DocumentRef[]> {
    // Read state is denormalized into the indexed backend card; "finished" is the
    // unified read flag (set by markIndexedRead on open / by a backend poll).
    const rows = await this.db
      .select({ id: documents.id, source: documents.source, sourceId: documents.sourceId })
      .from(documents)
      .where(
        and(
          eq(documents.source, source),
          isNull(documents.deletedAt),
          dsql`${documents.metadata}->'card'->>'readState' = 'finished'`,
        ),
      );
    return rows.map((r) => ({ id: r.id, source: r.source as Source, sourceId: r.sourceId }));
  }

  async softDeleteMissing(source: string, presentIds: Set<string>): Promise<number> {
    const live = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.source, source), isNull(documents.deletedAt)));
    const missing = live.map((r) => r.id).filter((id) => !presentIds.has(id));
    if (missing.length === 0) return 0;
    const now = new Date();
    for (let i = 0; i < missing.length; i += 500) {
      await this.db
        .update(documents)
        .set({ deletedAt: now })
        .where(inArray(documents.id, missing.slice(i, i + 500)));
    }
    return missing.length;
  }

  async getContent(id: string): Promise<{ html: string } | null> {
    const [row] = await this.db
      .select({ html: documentContent.html })
      .from(documentContent)
      .where(eq(documentContent.documentId, id));
    return row ? { html: row.html } : null;
  }

  async putContent(id: string, html: string): Promise<void> {
    const charCount = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim().length;
    // Don't cache a body with no readable text (e.g. empty `<p></p>` markup from
    // a failed scrape); leave it uncached so it re-fetches until real content.
    if (charCount === 0) return;
    await this.db
      .insert(documentContent)
      .values({ documentId: id, html, charCount })
      .onConflictDoUpdate({
        target: documentContent.documentId,
        set: { html, charCount, fetchedAt: new Date() },
      });
  }

  async searchContent(q: string, limit: number): Promise<SearchResult[]> {
    // websearch_to_tsquery gives users quoted phrases / OR / -negation and never
    // throws on junk input (returns an empty query -> no rows). Rank blends a
    // weight-A title vector with the weight-B body. Snippets are tag-stripped and
    // delimited with «» sentinels (rendered as text, never injected as HTML).
    const rows = (await this.db.execute(dsql`
      select d.id as id,
        ts_headline('english', regexp_replace(left(c.html, 200000), '<[^>]+>', ' ', 'g'), query,
          'StartSel=«,StopSel=»,MaxFragments=2,MaxWords=18,MinWords=5,FragmentDelimiter= … ') as snippet,
        ts_rank(setweight(to_tsvector('english', coalesce(d.title, '')), 'A') || setweight(c.body_tsv, 'B'), query) as rank
      from document_content c
        join documents d on d.id = c.document_id,
        websearch_to_tsquery('english', ${q}) query
      where d.deleted_at is null and c.body_tsv @@ query
      order by rank desc, d.updated_at desc nulls last
      limit ${limit}
    `)) as unknown as Array<{ id: string; snippet: string; rank: number }>;
    return rows.map((r) => ({ id: r.id, snippet: r.snippet, rank: Number(r.rank) }));
  }

  async upsertOverlay(id: string, patch: OverlayPatch): Promise<void> {
    const parsed = parseId(id);
    if (!parsed) throw new Error(`upsertOverlay: invalid id ${id}`);
    const insert: NewDocumentRow = {
      id,
      source: parsed.source,
      sourceId: parsed.sourceId,
      category: defaultCategory(parsed.source),
      location: patch.location ?? defaultLocation(parsed.source),
      readProgress: patch.readProgress ?? 0,
      readAnchor: patch.readAnchor ?? null,
      tags: patch.tags ?? [],
      note: patch.note ?? null,
      title: patch.title ?? null,
      updatedAt: new Date(),
    };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.location !== undefined) set.location = patch.location;
    if (patch.tags !== undefined) set.tags = patch.tags;
    if (patch.note !== undefined) set.note = patch.note;
    if (patch.readProgress !== undefined) set.readProgress = patch.readProgress;
    if (patch.readAnchor !== undefined) set.readAnchor = patch.readAnchor;
    if (patch.title !== undefined) set.title = patch.title;
    await this.db
      .insert(documents)
      .values(insert)
      .onConflictDoUpdate({ target: documents.id, set });
  }

  async listTags(): Promise<Tag[]> {
    const rows = await this.db.execute<{ name: string; count: number }>(
      dsql`select t.name as name, count(*)::int as count
           from ${documents} d, unnest(d.tags) as t(name)
           group by t.name
           order by count desc, t.name asc`,
    );
    return Array.from(rows, (r) => ({ name: String(r.name), count: Number(r.count) }));
  }

  async listViews(): Promise<SavedView[]> {
    const rows = await this.db
      .select()
      .from(savedViews)
      .orderBy(savedViews.position, desc(savedViews.createdAt));
    return rows.map(viewRowToView);
  }

  async createView(input: CreateViewRequest): Promise<SavedView> {
    const existing = await this.db.select({ id: savedViews.id }).from(savedViews);
    const [row] = await this.db
      .insert(savedViews)
      .values({
        id: randomUUID(),
        name: input.name,
        query: input.query,
        pinned: input.pinned,
        icon: input.icon ?? null,
        // Append to the end unless an explicit position is given.
        position: input.position || existing.length,
        sortBy: input.sortBy,
        sortDir: input.sortDir,
      })
      .returning();
    return viewRowToView(row!);
  }

  async updateView(id: string, patch: UpdateViewRequest): Promise<SavedView | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.query !== undefined) set.query = patch.query;
    if (patch.pinned !== undefined) set.pinned = patch.pinned;
    if (patch.sortBy !== undefined) set.sortBy = patch.sortBy;
    if (patch.sortDir !== undefined) set.sortDir = patch.sortDir;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.position !== undefined) set.position = patch.position;
    const [row] = await this.db
      .update(savedViews)
      .set(set)
      .where(eq(savedViews.id, id))
      .returning();
    return row ? viewRowToView(row) : null;
  }

  async deleteView(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(savedViews)
      .where(eq(savedViews.id, id))
      .returning({ id: savedViews.id });
    return rows.length > 0;
  }

  async listRssHighlights(documentId: string): Promise<Highlight[]> {
    const rows = await this.db
      .select()
      .from(rssHighlights)
      .where(eq(rssHighlights.documentId, documentId))
      .orderBy(desc(rssHighlights.createdAt));
    return rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      text: row.text,
      note: row.note,
      color: row.color as HighlightColor,
      startSelector: row.startSelector,
      startOffset: row.startOffset,
      endSelector: row.endSelector,
      endOffset: row.endOffset,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addRssHighlight(documentId: string, input: NewHighlight): Promise<Highlight> {
    const [row] = await this.db
      .insert(rssHighlights)
      .values({
        id: randomUUID(),
        documentId,
        text: input.text,
        note: input.note,
        color: input.color,
        startSelector: input.startSelector,
        startOffset: input.startOffset,
        endSelector: input.endSelector,
        endOffset: input.endOffset,
      })
      .returning();
    const created = row!;
    return {
      id: created.id,
      documentId: created.documentId,
      text: created.text,
      note: created.note,
      color: created.color as HighlightColor,
      startSelector: created.startSelector,
      startOffset: created.startOffset,
      endSelector: created.endSelector,
      endOffset: created.endOffset,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async removeRssHighlight(highlightId: string): Promise<boolean> {
    const rows = await this.db
      .delete(rssHighlights)
      .where(eq(rssHighlights.id, highlightId))
      .returning({ id: rssHighlights.id });
    return rows.length > 0;
  }

  // --- text-to-speech config + audio cache ---
  async getTtsConfig(): Promise<{
    provider: TtsProvider;
    apiKey: string | null;
    voiceId: string;
    modelId: string;
  }> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "tts"));
    const v = (row?.value ?? {}) as Record<string, unknown>;
    return {
      provider: v.provider === "kokoro" ? "kokoro" : "elevenlabs",
      apiKey: typeof v.apiKey === "string" && v.apiKey ? v.apiKey : null,
      voiceId: typeof v.voiceId === "string" && v.voiceId ? v.voiceId : DEFAULT_TTS.voiceId,
      modelId: typeof v.modelId === "string" && v.modelId ? v.modelId : DEFAULT_TTS.modelId,
    };
  }

  async setTtsConfig(patch: {
    provider?: TtsProvider;
    apiKey?: string | null;
    voiceId?: string;
    modelId?: string;
  }): Promise<void> {
    const current = await this.getTtsConfig();
    // Read the raw stored key (getTtsConfig already normalizes it to string|null).
    const next: Record<string, unknown> = {
      provider: current.provider,
      apiKey: current.apiKey,
      voiceId: current.voiceId,
      modelId: current.modelId,
    };
    if (patch.provider !== undefined) next.provider = patch.provider;
    if (patch.apiKey !== undefined) next.apiKey = patch.apiKey ? patch.apiKey : null;
    if (patch.voiceId !== undefined) next.voiceId = patch.voiceId;
    if (patch.modelId !== undefined) next.modelId = patch.modelId;
    await this.db
      .insert(appSettings)
      .values({ key: "tts", value: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: next, updatedAt: new Date() },
      });
  }

  async getCachedAudio(contentHash: string): Promise<{ mime: string; bytes: Buffer } | null> {
    const [row] = await this.db
      .select({ mime: ttsAudio.mime, audioBase64: ttsAudio.audioBase64 })
      .from(ttsAudio)
      .where(eq(ttsAudio.contentHash, contentHash));
    if (!row) return null;
    return { mime: row.mime, bytes: Buffer.from(row.audioBase64, "base64") };
  }

  async putCachedAudio(row: {
    contentHash: string;
    documentId: string;
    mime: string;
    bytes: Buffer;
    charCount: number;
  }): Promise<void> {
    await this.db
      .insert(ttsAudio)
      .values({
        contentHash: row.contentHash,
        documentId: row.documentId,
        mime: row.mime,
        audioBase64: row.bytes.toString("base64"),
        charCount: row.charCount,
      })
      .onConflictDoNothing({ target: ttsAudio.contentHash });
  }

  // --- podcast feed (tokenized RSS of rendered episodes) ---
  /** The feed token if one has been minted, else null. */
  async getPodcastToken(): Promise<string | null> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "podcast"));
    const v = (row?.value ?? {}) as Record<string, unknown>;
    return typeof v.feedToken === "string" && v.feedToken ? v.feedToken : null;
  }

  /** The feed token, minting (and persisting) one on first use. */
  async ensurePodcastToken(): Promise<string> {
    const existing = await this.getPodcastToken();
    return existing ?? this.regeneratePodcastToken();
  }

  /** Mint a fresh feed token, revoking the previous URL. */
  async regeneratePodcastToken(): Promise<string> {
    const token = randomUUID().replace(/-/g, "");
    const value = { feedToken: token };
    await this.db
      .insert(appSettings)
      .values({ key: "podcast", value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return token;
  }

  /** Add (or refresh) a podcast episode for a document. Idempotent per document;
   *  `addedAt` is preserved on re-add so the feed order is stable. */
  async addPodcastEpisode(row: NewPodcastEpisodeRow): Promise<void> {
    await this.db
      .insert(podcastEpisodes)
      .values(row)
      .onConflictDoUpdate({
        target: podcastEpisodes.documentId,
        set: {
          contentHash: row.contentHash,
          title: row.title,
          sourceUrl: row.sourceUrl,
          excerpt: row.excerpt,
          coverImage: row.coverImage,
          author: row.author,
          mime: row.mime,
          byteLength: row.byteLength,
          durationSeconds: row.durationSeconds,
        },
      });
  }

  /** All published episodes, newest first (drives the feed and the episode count). */
  async listPodcastEpisodes(): Promise<PodcastEpisodeRow[]> {
    return this.db.select().from(podcastEpisodes).orderBy(desc(podcastEpisodes.addedAt));
  }

  /** A single episode by document id, or null if it isn't published. */
  async getPodcastEpisode(documentId: string): Promise<PodcastEpisodeRow | null> {
    const [row] = await this.db
      .select()
      .from(podcastEpisodes)
      .where(eq(podcastEpisodes.documentId, documentId));
    return row ?? null;
  }

  /**
   * Cached reader accent for a document, or null if not computed yet. A stored
   * empty string means "computed, no usable colour" — distinct from null so the
   * caller skips re-fetching the image.
   */
  async getAccent(documentId: string): Promise<string | null | undefined> {
    const [row] = await this.db
      .select({ color: documentAccent.color })
      .from(documentAccent)
      .where(eq(documentAccent.documentId, documentId));
    if (!row) return undefined; // not computed
    return row.color === "" ? null : row.color; // null = computed, no colour
  }

  async putAccent(documentId: string, color: string | null): Promise<void> {
    await this.db
      .insert(documentAccent)
      .values({ documentId, color: color ?? "" })
      .onConflictDoUpdate({ target: documentAccent.documentId, set: { color: color ?? "" } });
  }

  async getPlayerState(): Promise<PlayerState> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "player"));
    return PlayerState.parse(row?.value ?? {});
  }

  async setPlayerState(state: PlayerState): Promise<PlayerState> {
    const next = PlayerState.parse({ ...state, updatedAt: new Date().toISOString() });
    await this.db
      .insert(appSettings)
      .values({ key: "player", value: next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
    return next;
  }
}

/** Fallback voice (ElevenLabs "Rachel") + model when the user hasn't chosen. */
export const DEFAULT_TTS = {
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_flash_v2_5",
} as const;

function defaultCategory(source: Source): string {
  return source === "miniflux" ? "rss" : "article";
}

function defaultLocation(source: Source): Location {
  return source === "miniflux" ? "feed" : "later";
}

/**
 * Reconstruct a fully-overlaid `Card` from an index row: the backend-truth card
 * lives in `metadata.card`, with the BFF-authoritative overlay columns merged on
 * top. Returns null for rows that have no indexed backend card yet.
 */
export function cardFromRow(row: DocumentRow, highlightCount: number): Card | null {
  const meta = (row.metadata ?? null) as { card?: Card } | null;
  const base = meta?.card ?? null;
  if (!base) return null;
  const overlay: Overlay = {
    location: row.location as Location,
    tags: row.tags,
    note: row.note,
    readProgress: row.readProgress,
    readAnchor: row.readAnchor,
  };
  const merged = mergeOverlay(base, overlay, highlightCount);
  const card = row.title ? { ...merged, title: row.title } : merged;
  // Defensive: a single poisoned index row (e.g. an empty `url` from a quirky
  // upstream entry) must never fail the whole read/sync batch. Drop it here so
  // `/sync` and `/documents` stay resilient; the bad item is simply omitted.
  const parsed = Card.safeParse(card);
  if (!parsed.success) {
    console.warn(
      `[overlay] dropping invalid card ${row.id}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
    return null;
  }
  return parsed.data;
}

function rowFromCard(card: Card): NewDocumentRow {
  return {
    id: card.id,
    source: card.source,
    sourceId: card.sourceId,
    category: card.category,
    location: card.location,
    readProgress: card.readingProgress,
    readAnchor: card.readAnchor,
    tags: card.tags,
    note: card.note,
    title: card.title,
    url: card.url,
    metadata: { card },
    savedAt: new Date(card.savedAt),
    updatedAt: new Date(card.updatedAt),
  };
}

/**
 * The BFF-authoritative overlay columns of a `documents` row (see db/schema.ts).
 * A backend poll MUST NOT write these; `backendTruthSet` excludes them by
 * construction, so refreshing the index from a backend card cannot clobber a
 * user's triage location, tags, note, or RSS reading progress/anchor.
 */
export const OVERLAY_COLUMNS = ["location", "tags", "note", "readProgress", "readAnchor"] as const;

/**
 * The conflict-set a backend refresh applies on a documents upsert: backend-truth
 * columns only, plus clearing any tombstone (a re-indexed backend item is alive
 * again). Both index writers build their `onConflictDoUpdate` set from this; only
 * `upsertIndex` (a fresh save, where the card itself is the truth) additionally
 * writes the overlay columns. Keeping the overlay columns OUT of this builder makes
 * the "index never clobbers the overlay" invariant a property of the seam rather
 * than of remembering which method (`indexFromBackend` vs `upsertIndex`) to call.
 */
export function backendTruthSet(row: NewDocumentRow) {
  return {
    category: row.category,
    title: row.title,
    url: row.url,
    metadata: row.metadata,
    savedAt: row.savedAt,
    updatedAt: row.updatedAt,
    deletedAt: null,
  };
}

function viewRowToView(row: typeof savedViews.$inferSelect): SavedView {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    pinned: row.pinned,
    icon: row.icon ?? null,
    position: row.position,
    sortBy: row.sortBy as SavedView["sortBy"],
    sortDir: row.sortDir as SavedView["sortDir"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
