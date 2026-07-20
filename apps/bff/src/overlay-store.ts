import { createHash, randomUUID } from "node:crypto";
import {
  and,
  arrayContains,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql as dsql,
} from "drizzle-orm";
import {
  Card,
  CreateCandidateInput,
  DiscoveryCandidate,
  DiscoveryConfig,
  DiscoveryProfile,
  DiscoveryRun,
  DiscoverySeed,
  DiscoveryVote,
  FINISHED_THRESHOLD,
  PlayerState,
  computeIdf,
  cosine,
  l2normalize,
  termFrequencies,
  tfidfVector,
  tokenize,
  surfaceForms,
} from "@lectern/shared";
import type { TagSuggestion, TermVector } from "@lectern/shared";
import type {
  CandidateStatus,
  CreateRunRequest,
  CreateViewRequest,
  DiscoverySeedDoc,
  DiscoverySeedTag,
  FollowSuggestion,
  Highlight,
  HighlightColor,
  Location,
  NewHighlight,
  SavedView,
  SearchResult,
  Source,
  SourceThemeSummary,
  Tag,
  TtsProvider,
  UpdateDiscoverySettingsRequest,
  UpdateRunRequest,
  UpdateViewRequest,
  VoteValue,
} from "@lectern/shared";
// TtsProvider is also used as a value (runtime enum parsing), so import the
// schema itself in addition to the type above.
import { TtsProvider as TtsProviderSchema } from "@lectern/shared";
import type { Db } from "./db/client";
import {
  appSettings,
  discoveryCandidates,
  discoveryProfile,
  discoveryRuns,
  discoveryVotes,
  documentAccent,
  documentContent,
  documents,
  podcastEpisodes,
  rssHighlights,
  savedViews,
  sourceTheme,
  ttsAudio,
} from "./db/schema";
import type {
  DiscoveryCandidateRow,
  DiscoveryProfileRow,
  DiscoveryRunRow,
  DiscoveryVoteRow,
  DocumentRow,
  NewDiscoveryCandidateRow,
  NewDocumentRow,
  NewPodcastEpisodeRow,
  PodcastEpisodeRow,
} from "./db/schema";
import { hostOf, normalizeUrl } from "./discovery-url";
import { htmlToText } from "./html-text";
import { parseId } from "./ids";
import type { SourceThemeTokens } from "./source-theme";
import {
  mergeOverlay,
  type ChangedDocuments,
  type DocumentRef,
  type DocumentsPage,
  type IndexedUrlMatch,
  type ListDocumentsParams,
  type MaintenanceFilter,
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
      return { cards: await this.cardsFromRows(rows), deletedIds: [], maxDeletedAt: null };
    }
    const sinceDate = new Date(since);
    const changed = await this.db
      .select()
      .from(documents)
      .where(and(isNull(documents.deletedAt), gt(documents.updatedAt, sinceDate)));
    const deleted = await this.db
      .select({ id: documents.id, deletedAt: documents.deletedAt })
      .from(documents)
      .where(and(isNotNull(documents.deletedAt), gt(documents.deletedAt, sinceDate)));
    // The caller derives the next cursor from what it actually delivers, so the
    // tombstone timestamps have to come back with the ids.
    let maxDeletedAt: Date | null = null;
    for (const row of deleted) {
      if (row.deletedAt && (!maxDeletedAt || row.deletedAt > maxDeletedAt))
        maxDeletedAt = row.deletedAt;
    }
    return {
      cards: await this.cardsFromRows(changed),
      deletedIds: deleted.map((r) => r.id),
      maxDeletedAt: maxDeletedAt ? maxDeletedAt.toISOString() : null,
    };
  }

  async liveDocumentIds(): Promise<string[]> {
    // Ids straight off the index — no card reconstruction and no highlight-count
    // join, so this stays a single cheap indexed scan however large the library.
    const rows = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(isNull(documents.deletedAt));
    return rows.map((r) => r.id);
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

  async findByAnyUrl(urls: readonly string[]): Promise<IndexedUrlMatch | null> {
    if (urls.length === 0) return null;
    // NOTE the deliberate absence of an `isNull(documents.deletedAt)` filter: a
    // tombstoned row still answers "yes, we've seen this URL". Filtering deleted
    // rows out would let a deleted newsletter be re-ingested on the next replay
    // and resurrect itself. See the interface docstring in unify.ts.
    //
    // `inArray` keeps this an index-friendly `url IN (...)`, so it still rides
    // documents_url_idx (migration 0013) rather than degrading to a scan.
    //
    // The ORDER BY is not cosmetic. Duplicates under one URL exist in production
    // (that is the bug this whole effort is fixing), and an unordered `limit 1`
    // picks an arbitrary one — so a live document could be reported as
    // `deleted: true` purely because a tombstoned sibling sorted first. `nulls
    // first` on deleted_at makes a live row win deterministically whenever one
    // exists; among tombstones the newest id breaks the tie.
    const [row] = await this.db
      .select({ id: documents.id, deletedAt: documents.deletedAt })
      .from(documents)
      .where(inArray(documents.url, [...urls]))
      .orderBy(dsql`${documents.deletedAt} asc nulls first`, desc(documents.id))
      .limit(1);
    return row ? { id: row.id, deleted: row.deletedAt !== null } : null;
  }

  /**
   * Live (non-tombstoned) index rows for a source, with the backend id needed to
   * verify each one individually. Used by the deletion reconcile, which must
   * re-check a would-be deletion at the backend before tombstoning it.
   */
  async listLiveBySource(source: string): Promise<{ id: string; sourceId: string }[]> {
    return this.db
      .select({ id: documents.id, sourceId: documents.sourceId })
      .from(documents)
      .where(and(eq(documents.source, source), isNull(documents.deletedAt)));
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

  async listReadEmail(): Promise<DocumentRef[]> {
    // Newsletters carry no read enum, so "read" is the same OR the client uses in
    // `isFinished`: progress past the threshold (denormalized into the read_progress
    // column on every setReadingProgress) OR a finished readState from a poll.
    const rows = await this.db
      .select({ id: documents.id, source: documents.source, sourceId: documents.sourceId })
      .from(documents)
      .where(
        and(
          eq(documents.category, "email"),
          isNull(documents.deletedAt),
          or(
            gte(documents.readProgress, FINISHED_THRESHOLD),
            dsql`${documents.metadata}->'card'->>'readState' = 'finished'`,
          ),
        ),
      );
    return rows.map((r) => ({ id: r.id, source: r.source as Source, sourceId: r.sourceId }));
  }

  async listForMaintenance(filter: MaintenanceFilter): Promise<DocumentRef[]> {
    const col = filter.dateField === "updatedAt" ? documents.updatedAt : documents.savedAt;
    const conds = [
      isNull(documents.deletedAt),
      filter.inclusive ? lte(col, filter.before) : lt(col, filter.before),
    ];
    if (filter.location) conds.push(eq(documents.location, filter.location));
    if (filter.category) conds.push(eq(documents.category, filter.category));
    if (filter.source) conds.push(eq(documents.source, filter.source));
    const rows = await this.db
      .select({ id: documents.id, source: documents.source, sourceId: documents.sourceId })
      .from(documents)
      .where(and(...conds));
    return rows.map((r) => ({ id: r.id, source: r.source as Source, sourceId: r.sourceId }));
  }

  async markIndexedReadMany(ids: string[], read: boolean): Promise<void> {
    if (ids.length === 0) return;
    const state = read ? "finished" : "unopened";
    // jsonb_set the denormalized read flag in place (no per-row read) and bump
    // updatedAt so the change rides the next sync delta out to clients.
    for (let i = 0; i < ids.length; i += 500) {
      await this.db
        .update(documents)
        .set({
          metadata: dsql`jsonb_set(${documents.metadata}, '{card,readState}', to_jsonb(${state}::text))`,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(documents.id, ids.slice(i, i + 500)),
            isNotNull(dsql`${documents.metadata} -> 'card'`),
          ),
        );
    }
  }

  async listEmailSenders(): Promise<{ name: string; count: number }[]> {
    const rows = (await this.db.execute(dsql`
      select coalesce(metadata->'card'->>'author', '') as name, count(*)::int as count
      from documents
      where category = 'email' and deleted_at is null
      group by 1
      having coalesce(metadata->'card'->>'author', '') <> ''
      order by count desc, name asc
    `)) as unknown as Array<{ name: string; count: number }>;
    return rows.map((r) => ({ name: String(r.name), count: Number(r.count) }));
  }

  async listEmailDocsBySender(sender: string): Promise<DocumentRef[]> {
    const rows = await this.db
      .select({ id: documents.id, source: documents.source, sourceId: documents.sourceId })
      .from(documents)
      .where(
        and(
          eq(documents.category, "email"),
          isNull(documents.deletedAt),
          dsql`lower(${documents.metadata}->'card'->>'author') = ${sender.trim().toLowerCase()}`,
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
    // delimited with «» sentinels (rendered as text, never injected as HTML). The
    // title is selected alongside for the TF-IDF re-rank below; it is dropped
    // before returning so the SearchResult shape is unchanged.
    const rows = (await this.db.execute(dsql`
      select d.id as id, d.title as title,
        ts_headline('english', regexp_replace(left(c.html, 200000), '<[^>]+>', ' ', 'g'), query,
          'StartSel=«,StopSel=»,MaxFragments=2,MaxWords=18,MinWords=5,FragmentDelimiter= … ') as snippet,
        ts_rank(setweight(to_tsvector('english', coalesce(d.title, '')), 'A') || setweight(c.body_tsv, 'B'), query) as rank
      from document_content c
        join documents d on d.id = c.document_id,
        websearch_to_tsquery('english', ${q}) query
      where d.deleted_at is null and c.body_tsv @@ query
      order by rank desc, d.updated_at desc nulls last
      limit ${limit}
    `)) as unknown as Array<{ id: string; title: string | null; snippet: string; rank: number }>;
    const hits = rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: r.snippet,
      rank: Number(r.rank),
    }));
    // Additive, SET-preserving re-rank: keep exactly the FTS hits Postgres
    // returned (never drop one), just reorder them by a blend of ts_rank and
    // TF-IDF cosine to the query so the most on-topic keyword hits float up.
    return rerankSearchHits(q, hits).map(({ id, snippet, rank }) => ({ id, snippet, rank }));
  }

  /**
   * "More like this": library documents most similar to `id` by local TF-IDF
   * cosine (no LLM). Uses the source doc's salient terms to pull an FTS candidate
   * set (cheap keyword recall), then re-ranks those candidates by cosine of the
   * full source vector vs each candidate's title+body vector. Returns null when
   * the source doc doesn't exist; [] when it exists but nothing relates.
   */
  async relatedDocuments(id: string, limit: number): Promise<Card[] | null> {
    const source = await this.getIndexedCard(id);
    if (!source) return null;
    const content = await this.getContent(id);
    const body = content ? htmlToText(content.html) : "";
    // Fall back to title-only terms when no body is captured yet (best-effort).
    const sourceText = `${source.title ?? ""} ${body}`.trim();
    const sourceTf = termFrequencies(tokenize(sourceText));
    if (Object.keys(sourceTf).length === 0) return [];
    // Query the FTS with the top salient SURFACE words (websearch_to_tsquery wants
    // real words, not Porter stems), OR-joined so it recalls a broad candidate set.
    const queryTerms = salientSurfaceTerms(sourceText, 10);
    if (queryTerms.length === 0) return [];
    const hits = await this.searchContent(queryTerms.join(" or "), 40);
    const candidateIds = hits.map((h) => h.id).filter((cid) => cid !== id);
    if (candidateIds.length === 0) return [];
    // Load the candidate cards (what we return) and their bodies (for the vector)
    // in two batched reads — single-user scale, so a small IN-list scan is fine.
    const [cards, contentRows] = await Promise.all([
      this.cardsByIds(candidateIds),
      this.db
        .select({ id: documentContent.documentId, html: documentContent.html })
        .from(documentContent)
        .where(inArray(documentContent.documentId, candidateIds)),
    ]);
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const htmlById = new Map(contentRows.map((r) => [r.id, r.html]));
    const snippetById = new Map(hits.map((h) => [h.id, h.snippet]));
    const candidates = candidateIds
      .filter((cid) => cardById.has(cid))
      .map((cid) => {
        const card = cardById.get(cid)!;
        const html = htmlById.get(cid);
        // Prefer the captured body; fall back to the FTS snippet if uncaptured.
        const bodyText = html ? htmlToText(html) : (snippetById.get(cid) ?? "");
        const tf = termFrequencies(tokenize(`${card.title ?? ""} ${bodyText}`));
        return { id: cid, tf };
      });
    const rankedIds = rankRelated(sourceTf, candidates, limit);
    return rankedIds.map((rid) => cardById.get(rid)!).filter(Boolean);
  }

  /** Batch-load live (non-deleted) indexed cards by id (order not preserved). */
  private async cardsByIds(ids: string[]): Promise<Card[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(documents)
      .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)));
    return this.cardsFromRows(rows);
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

  /**
   * Suggested tags for a document: cosine of its TF-IDF vector to each tag's
   * centroid over the library (local IR, no LLM), top 3 above a small threshold,
   * excluding tags the doc already carries. Null if the doc doesn't exist.
   */
  async tagSuggestions(id: string): Promise<TagSuggestion[] | null> {
    const source = await this.getIndexedCard(id);
    if (!source) return null;
    const content = await this.getContent(id);
    const text = `${source.title ?? ""} ${content ? htmlToText(content.html) : ""}`.trim();
    const centroids = await this.getTagCentroids();
    return suggestTagsFromCentroids(text, source.tags, centroids);
  }

  /**
   * The per-tag TF-IDF centroids, cached module-wide with a short TTL (single
   * user, so no key). Recomputed lazily when stale — a capped per-tag scan.
   */
  private async getTagCentroids(): Promise<TagCentroids> {
    const now = Date.now();
    if (tagCentroidCache && now - tagCentroidCache.builtAt < TAG_CENTROID_TTL_MS) {
      return tagCentroidCache;
    }
    const samples = await this.sampleTagCorpus(40);
    tagCentroidCache = { ...buildTagCentroids(samples), builtAt: now };
    return tagCentroidCache;
  }

  /**
   * For each tag, sample up to `perTag` docs carrying it and load their
   * title+body text. Single-user scale — one capped query per tag is fine
   * (mirrors the other "single-user scale" scans in this store).
   */
  private async sampleTagCorpus(perTag: number): Promise<{ tag: string; texts: string[] }[]> {
    const tags = await this.listTags();
    const out: { tag: string; texts: string[] }[] = [];
    for (const t of tags) {
      const rows = await this.db
        .select({ title: documents.title, html: documentContent.html })
        .from(documents)
        .leftJoin(documentContent, eq(documentContent.documentId, documents.id))
        .where(and(isNull(documents.deletedAt), arrayContains(documents.tags, [t.name])))
        .limit(perTag);
      const texts = rows
        .map((r) => `${r.title ?? ""} ${r.html ? htmlToText(r.html) : ""}`.trim())
        .filter((s) => s.length > 0);
      out.push({ tag: t.name, texts });
    }
    return out;
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
      // Preserve any provider the enum knows (elevenlabs/kokoro/piper); an
      // unknown/legacy value falls back to the hosted default.
      provider: TtsProviderSchema.catch("elevenlabs").parse(v.provider),
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

  // --- newsletter ignore list ---
  async getEmailIgnoreList(): Promise<string[]> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "email-ignore"));
    const v = (row?.value ?? {}) as Record<string, unknown>;
    return Array.isArray(v.senders)
      ? v.senders.filter((s): s is string => typeof s === "string")
      : [];
  }

  async setEmailIgnoreList(senders: string[]): Promise<void> {
    // Normalize: trim, drop blanks, de-dupe case-insensitively (keep first form).
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const s of senders) {
      const t = s.trim();
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      seen.add(key);
      clean.push(t);
    }
    const value = { senders: clean };
    await this.db
      .insert(appSettings)
      .values({ key: "email-ignore", value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  // --- newsletter poison-message counters ---
  /**
   * How many times each still-failing newsletter UID has failed to save, keyed
   * by UID. Persisted (rather than held in the poll's memory) so a restart —
   * or the crash the bad message caused — cannot reset the count and let one
   * unsaveable message block ingestion forever. Only actively-failing UIDs are
   * stored; entries are dropped on success or on the final skip.
   */
  async getEmailFailures(): Promise<Record<string, number>> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "email-failures"));
    const v = (row?.value ?? {}) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [uid, count] of Object.entries(v)) {
      if (typeof count === "number" && Number.isFinite(count)) out[uid] = count;
    }
    return out;
  }

  async setEmailFailures(failures: Record<string, number>): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key: "email-failures", value: failures, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: failures, updatedAt: new Date() },
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

  /**
   * Cached per-source theming tokens for a host with the time they were fetched
   * (so the caller can apply a TTL), or undefined if never fetched. Stored empty
   * strings mean "checked, none" and read back as null, distinct from the
   * undefined "never computed" so callers skip re-fetching the site.
   */
  async getSourceTheme(
    host: string,
  ): Promise<{ tokens: SourceThemeTokens; fetchedAt: Date } | undefined> {
    const [row] = await this.db
      .select({
        accent: sourceTheme.accent,
        accentDark: sourceTheme.accentDark,
        background: sourceTheme.background,
        backgroundDark: sourceTheme.backgroundDark,
        text: sourceTheme.text,
        link: sourceTheme.link,
        bodyFont: sourceTheme.bodyFont,
        displayFont: sourceTheme.displayFont,
        faviconUrl: sourceTheme.faviconUrl,
        siteName: sourceTheme.siteName,
        derivation: sourceTheme.derivation,
        fetchedAt: sourceTheme.fetchedAt,
      })
      .from(sourceTheme)
      .where(eq(sourceTheme.host, host));
    if (!row) return undefined;
    return {
      tokens: {
        accent: row.accent === "" ? null : row.accent,
        accentDark: row.accentDark === "" ? null : row.accentDark,
        background: row.background === "" ? null : row.background,
        backgroundDark: row.backgroundDark === "" ? null : row.backgroundDark,
        text: row.text === "" ? null : row.text,
        link: row.link === "" ? null : row.link,
        bodyFont: row.bodyFont === "" ? null : row.bodyFont,
        displayFont: row.displayFont === "" ? null : row.displayFont,
        faviconUrl: row.faviconUrl === "" ? null : row.faviconUrl,
        siteName: row.siteName === "" ? null : row.siteName,
        // A string union, not a colour: '' means "no re-skin palette".
        derivation: row.derivation === "" ? null : (row.derivation as "literal" | "derived"),
      },
      fetchedAt: row.fetchedAt,
    };
  }

  async putSourceTheme(host: string, theme: SourceThemeTokens): Promise<void> {
    const values = {
      host,
      accent: theme.accent ?? "",
      accentDark: theme.accentDark ?? "",
      background: theme.background ?? "",
      backgroundDark: theme.backgroundDark ?? "",
      text: theme.text ?? "",
      link: theme.link ?? "",
      bodyFont: theme.bodyFont ?? "",
      displayFont: theme.displayFont ?? "",
      faviconUrl: theme.faviconUrl ?? "",
      siteName: theme.siteName ?? "",
      derivation: theme.derivation ?? "",
      fetchedAt: new Date(),
    };
    await this.db
      .insert(sourceTheme)
      .values(values)
      .onConflictDoUpdate({
        target: sourceTheme.host,
        set: {
          accent: values.accent,
          accentDark: values.accentDark,
          background: values.background,
          backgroundDark: values.backgroundDark,
          text: values.text,
          link: values.link,
          bodyFont: values.bodyFont,
          displayFont: values.displayFont,
          faviconUrl: values.faviconUrl,
          siteName: values.siteName,
          derivation: values.derivation,
          fetchedAt: values.fetchedAt,
        },
      });
  }

  /** Every cached source theme as a summary (host + tokens + fetch time), ordered
   *  by host. Powers the Settings "Cached sources" list. */
  async listSourceThemes(): Promise<SourceThemeSummary[]> {
    const rows = await this.db.select().from(sourceTheme).orderBy(sourceTheme.host);
    return rows.map((row) => ({
      host: row.host,
      accent: row.accent === "" ? null : row.accent,
      accentDark: row.accentDark === "" ? null : row.accentDark,
      background: row.background === "" ? null : row.background,
      backgroundDark: row.backgroundDark === "" ? null : row.backgroundDark,
      text: row.text === "" ? null : row.text,
      link: row.link === "" ? null : row.link,
      bodyFont: row.bodyFont === "" ? null : row.bodyFont,
      displayFont: row.displayFont === "" ? null : row.displayFont,
      faviconUrl: row.faviconUrl === "" ? null : row.faviconUrl,
      siteName: row.siteName === "" ? null : row.siteName,
      derivation: row.derivation === "" ? null : (row.derivation as "literal" | "derived"),
      fetchedAt: row.fetchedAt.toISOString(),
    }));
  }

  /** Drop every cached source theme so each host re-fetches on next open. */
  async clearSourceThemes(): Promise<void> {
    await this.db.delete(sourceTheme);
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

  // --- content discovery (candidates, votes, profile, settings, runs) ---
  async listCandidates(params: {
    status?: CandidateStatus;
    limit: number;
  }): Promise<DiscoveryCandidate[]> {
    const rows = await this.db
      .select()
      .from(discoveryCandidates)
      .where(params.status ? eq(discoveryCandidates.status, params.status) : undefined)
      .orderBy(desc(discoveryCandidates.score), desc(discoveryCandidates.firstSeenAt))
      .limit(params.limit);
    return rows.map(candidateFromRow);
  }

  async insertCandidates(
    inputs: CreateCandidateInput[],
  ): Promise<{ inserted: number; skipped: number }> {
    if (inputs.length === 0) return { inserted: 0, skipped: 0 };
    // Defense-in-depth muted-domain filter: never surface a candidate from a host
    // the user has muted (the worker also filters, but a stale worker config or a
    // direct POST must not leak one through). Host matches a muted domain exactly
    // or as a subdomain (`host === d` or `host` endsWith `.d`).
    const muted = (await this.getDiscoverySettings()).mutedDomains
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const isMuted = (url: string): boolean => {
      if (muted.length === 0) return false;
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return false;
      }
      return muted.some((d) => host === d || host.endsWith("." + d));
    };
    // Dedup within the batch by normalized URL (first wins); the DB unique index
    // dedups against prior runs (ON CONFLICT DO NOTHING below).
    const byNorm = new Map<string, NewDiscoveryCandidateRow>();
    for (const input of inputs) {
      if (isMuted(input.url)) continue;
      const urlNormalized = normalizeUrl(input.url);
      if (byNorm.has(urlNormalized)) continue;
      byNorm.set(urlNormalized, {
        id: `disc:${createHash("sha1").update(urlNormalized).digest("hex")}`,
        url: input.url,
        urlNormalized,
        title: input.title ?? null,
        excerpt: input.excerpt ?? null,
        fetcher: input.fetcher,
        score: input.score,
        termVector: input.termVector,
        status: "active",
        vote: null,
        runId: input.runId ?? null,
        metadata: {
          author: input.author ?? null,
          siteName: input.siteName ?? null,
          imageUrl: input.imageUrl ?? null,
          publishedAt: input.publishedAt ?? null,
          matchedTerms: input.matchedTerms ?? [],
        },
      });
    }
    // Never re-surface an article already in the library: drop any candidate whose
    // normalized URL matches a saved document's URL (single-user scale — a full
    // scan of the small non-null URL set is fine).
    const docUrls = await this.db
      .select({ url: documents.url })
      .from(documents)
      .where(isNotNull(documents.url));
    const savedNorm = new Set(docUrls.map((r) => normalizeUrl(r.url as string)));
    const rows = [...byNorm.values()].filter((r) => !savedNorm.has(r.urlNormalized));
    if (rows.length === 0) return { inserted: 0, skipped: inputs.length };
    const inserted = await this.db
      .insert(discoveryCandidates)
      .values(rows)
      .onConflictDoNothing({ target: discoveryCandidates.urlNormalized })
      .returning({ id: discoveryCandidates.id });
    return { inserted: inserted.length, skipped: inputs.length - inserted.length };
  }

  async getCandidate(id: string): Promise<DiscoveryCandidate | null> {
    const [row] = await this.db
      .select()
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.id, id));
    return row ? candidateFromRow(row) : null;
  }

  async setCandidateStatus(
    id: string,
    status: CandidateStatus,
    vote?: VoteValue | null,
  ): Promise<DiscoveryCandidate | null> {
    const set: Record<string, unknown> = { status, updatedAt: new Date() };
    if (vote !== undefined) set.vote = vote;
    const [row] = await this.db
      .update(discoveryCandidates)
      .set(set)
      .where(eq(discoveryCandidates.id, id))
      .returning();
    return row ? candidateFromRow(row) : null;
  }

  async clearCandidates(ids?: string[]): Promise<number> {
    // Dismiss without recording a vote (no training). No ids = every active one.
    const active = eq(discoveryCandidates.status, "active");
    const where =
      ids && ids.length > 0 ? and(active, inArray(discoveryCandidates.id, ids)) : active;
    const rows = await this.db
      .update(discoveryCandidates)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(where)
      .returning({ id: discoveryCandidates.id });
    return rows.length;
  }

  async recordVote(candidateId: string, value: VoteValue): Promise<DiscoveryCandidate | null> {
    const [candidate] = await this.db
      .select()
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.id, candidateId));
    if (!candidate) return null;
    // Copy the candidate's term vector into the vote so a later-pruned candidate
    // still trains the model.
    await this.db.insert(discoveryVotes).values({
      candidateId,
      value,
      termVector: candidate.termVector,
      processed: false,
    });
    // `up` is signal-only (stays active/visible); `down` dismisses it.
    const status = value === "down" ? "dismissed" : "active";
    const [row] = await this.db
      .update(discoveryCandidates)
      .set({ vote: value, status, updatedAt: new Date() })
      .where(eq(discoveryCandidates.id, candidateId))
      .returning();
    return row ? candidateFromRow(row) : null;
  }

  async listUnprocessedVotes(): Promise<DiscoveryVote[]> {
    const rows = await this.db
      .select()
      .from(discoveryVotes)
      .where(eq(discoveryVotes.processed, false))
      .orderBy(discoveryVotes.id);
    return rows.map(voteFromRow);
  }

  async putDiscoveryProfile(
    profile: DiscoveryProfile,
    processedVoteIds: number[],
  ): Promise<DiscoveryProfile> {
    const now = new Date();
    const lastVoteProcessedAt =
      processedVoteIds.length > 0
        ? now
        : profile.lastVoteProcessedAt
          ? new Date(profile.lastVoteProcessedAt)
          : null;
    const values = {
      name: profile.name || "default",
      vector: profile.vector,
      idf: profile.idf,
      docCount: profile.docCount,
      seededAt: profile.seededAt ? new Date(profile.seededAt) : null,
      updatedAt: now,
      lastVoteProcessedAt,
    };
    await this.db
      .insert(discoveryProfile)
      .values(values)
      .onConflictDoUpdate({
        target: discoveryProfile.name,
        set: {
          vector: values.vector,
          idf: values.idf,
          docCount: values.docCount,
          seededAt: values.seededAt,
          updatedAt: values.updatedAt,
          lastVoteProcessedAt: values.lastVoteProcessedAt,
        },
      });
    if (processedVoteIds.length > 0) {
      await this.db
        .update(discoveryVotes)
        .set({ processed: true })
        .where(inArray(discoveryVotes.id, processedVoteIds));
    }
    return this.getDiscoveryProfile();
  }

  async getDiscoveryProfile(): Promise<DiscoveryProfile> {
    const [row] = await this.db
      .select()
      .from(discoveryProfile)
      .where(eq(discoveryProfile.name, "default"));
    // Empty default profile until the first worker run persists one.
    return row ? profileFromRow(row) : DiscoveryProfile.parse({});
  }

  async getDiscoverySettings(): Promise<DiscoveryConfig> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "discovery"));
    // DiscoveryConfig fills every default (incl. an empty braveApiKey) so a
    // never-configured install still parses.
    return DiscoveryConfig.parse(row?.value ?? {});
  }

  async setDiscoverySettings(patch: UpdateDiscoverySettingsRequest): Promise<void> {
    const next = await this.getDiscoverySettings();
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.topics !== undefined) next.topics = patch.topics;
    if (patch.seedUrls !== undefined) next.seedUrls = patch.seedUrls;
    if (patch.fetchers !== undefined) next.fetchers = patch.fetchers;
    if (patch.schedule !== undefined) next.schedule = patch.schedule;
    if (patch.searxngUrl !== undefined) next.searxngUrl = patch.searxngUrl;
    // Omitted = leave unchanged; null or "" = clear the stored key.
    if (patch.braveApiKey !== undefined) next.braveApiKey = patch.braveApiKey ?? "";
    if (patch.crawlDepth !== undefined) next.crawlDepth = patch.crawlDepth;
    if (patch.crawlTimeMs !== undefined) next.crawlTimeMs = patch.crawlTimeMs;
    if (patch.rocchio !== undefined) next.rocchio = patch.rocchio;
    if (patch.targetCount !== undefined) next.targetCount = patch.targetCount;
    if (patch.freshnessHalfLifeDays !== undefined)
      next.freshnessHalfLifeDays = patch.freshnessHalfLifeDays;
    if (patch.fullText !== undefined) next.fullText = patch.fullText;
    if (patch.fullTextCandidates !== undefined) next.fullTextCandidates = patch.fullTextCandidates;
    if (patch.mutedDomains !== undefined) next.mutedDomains = patch.mutedDomains;
    if (patch.followDismissed !== undefined) next.followDismissed = patch.followDismissed;
    await this.db
      .insert(appSettings)
      .values({ key: "discovery", value: next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  }

  async buildDiscoverySeed(): Promise<DiscoverySeed> {
    // A bounded weighted corpus the worker tokenizes to build the initial
    // profile. Signals are stripped of HTML (same regexp as searchContent) and
    // each doc is truncated so one long article can't dominate.
    const CAP = 300;
    const TRUNC = 4096;
    const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, TRUNC);
    const docs: DiscoverySeedDoc[] = [];

    // Shortlisted articles (title + stripped body), the strongest interest signal.
    const shortlist = (await this.db.execute(dsql`
      select coalesce(d.title, '') as title,
        regexp_replace(left(coalesce(c.html, ''), 200000), '<[^>]+>', ' ', 'g') as body
      from documents d
        left join document_content c on c.document_id = d.id
      where d.deleted_at is null and d.location = 'shortlist'
      limit ${CAP}
    `)) as unknown as Array<{ title: string; body: string }>;
    for (const r of shortlist) {
      const text = clean(`${r.title} ${r.body}`);
      if (text) docs.push({ text, weight: 3.0 });
    }

    // Highlighted passages — the user hand-picked these, so they're high signal.
    const highlights = (await this.db.execute(dsql`
      select text from rss_highlights limit ${CAP}
    `)) as unknown as Array<{ text: string }>;
    for (const r of highlights) {
      const text = clean(r.text);
      if (text) docs.push({ text, weight: 3.0 });
    }

    // Finished reads (title + excerpt) — a softer "I read this" signal.
    const read = (await this.db.execute(dsql`
      select coalesce(d.title, '') as title,
        coalesce(d.metadata->'card'->>'excerpt', '') as excerpt
      from documents d
      where d.deleted_at is null
        and (d.metadata->'card'->>'readState' = 'finished'
             or d.read_progress >= ${FINISHED_THRESHOLD})
      limit ${CAP}
    `)) as unknown as Array<{ title: string; excerpt: string }>;
    for (const r of read) {
      const text = clean(`${r.title} ${r.excerpt}`);
      if (text) docs.push({ text, weight: 1.5 });
    }

    // Tags, weighted by log(usage) so a heavily-used tag counts more (but not
    // linearly — one prolific tag shouldn't swamp the vocabulary).
    const tags: DiscoverySeedTag[] = (await this.listTags()).map((t) => ({
      name: t.name,
      weight: 2.0 * Math.log(1 + t.count),
    }));

    return DiscoverySeed.parse({ docs: docs.slice(0, CAP), tags });
  }

  async createRun(input: CreateRunRequest): Promise<DiscoveryRun> {
    const [row] = await this.db
      .insert(discoveryRuns)
      .values({ id: input.id, trigger: input.trigger, stage: input.stage, status: "running" })
      .returning();
    return runFromRow(row!);
  }

  async updateRun(id: string, patch: UpdateRunRequest): Promise<DiscoveryRun | null> {
    const [existing] = await this.db.select().from(discoveryRuns).where(eq(discoveryRuns.id, id));
    if (!existing) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.stage !== undefined) set.stage = patch.stage;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.error !== undefined) set.error = patch.error;
    // The worker sends the (potentially large) forensic trace once, at the
    // terminal/failure update. Persist it verbatim; only the detail endpoint reads it.
    if (patch.trace !== undefined) set.trace = patch.trace;
    // Shallow-merge stats so a partial progress update keeps prior counters.
    if (patch.stats !== undefined) {
      set.stats = { ...((existing.stats ?? {}) as Record<string, unknown>), ...patch.stats };
    }
    // A terminal status stamps the finish time.
    if (patch.status !== undefined && patch.status !== "running") set.finishedAt = new Date();
    const [row] = await this.db
      .update(discoveryRuns)
      .set(set)
      .where(eq(discoveryRuns.id, id))
      .returning();
    return row ? runFromRow(row) : null;
  }

  async listRuns(limit: number): Promise<DiscoveryRun[]> {
    const rows = await this.db
      .select()
      .from(discoveryRuns)
      .orderBy(desc(discoveryRuns.startedAt))
      .limit(limit);
    // Wrap so Array.map's index arg isn't forwarded as `includeTrace` — lists
    // never ship the trace.
    return rows.map((row) => runFromRow(row));
  }

  async getLatestRun(): Promise<DiscoveryRun | null> {
    const [row] = await this.db
      .select()
      .from(discoveryRuns)
      .orderBy(desc(discoveryRuns.startedAt))
      .limit(1);
    return row ? runFromRow(row) : null;
  }

  /**
   * A single run WITH its full forensic trace — for the detail endpoint only.
   * The list/latest views deliberately omit the trace (it can be large), so this
   * is the one path that hydrates it (`includeTrace`).
   */
  async getRun(id: string): Promise<DiscoveryRun | null> {
    const [row] = await this.db.select().from(discoveryRuns).where(eq(discoveryRuns.id, id));
    return row ? runFromRow(row, true) : null;
  }

  /**
   * Domains the user keeps engaging with — a positive signal per DISTINCT
   * candidate from a host that was either saved (`status = 'saved'`) or up-voted
   * (`discovery_votes.value = 'up'` joined back to the candidate for its url). The
   * two sets are unioned by candidate id (a saved-and-upvoted candidate counts
   * once), grouped by host, and any host with at least `minSignals` distinct
   * signals is returned with up to 3 sample titles, sorted by signal count desc.
   * Single-user scale — a full scan of the small saved/upvoted candidate set is
   * fine (mirrors insertCandidates' saved-URL scan).
   */
  async suggestFollowDomains(minSignals: number): Promise<FollowSuggestion[]> {
    const saved = await this.db
      .select({
        id: discoveryCandidates.id,
        url: discoveryCandidates.url,
        title: discoveryCandidates.title,
      })
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.status, "saved"));
    const upvoted = await this.db
      .select({
        id: discoveryCandidates.id,
        url: discoveryCandidates.url,
        title: discoveryCandidates.title,
      })
      .from(discoveryCandidates)
      .innerJoin(discoveryVotes, eq(discoveryVotes.candidateId, discoveryCandidates.id))
      .where(eq(discoveryVotes.value, "up"));
    // Union by candidate id so a candidate that is BOTH saved and up-voted (and a
    // candidate with multiple up-votes) contributes a single signal.
    const byId = new Map<string, { url: string; title: string | null }>();
    for (const r of [...saved, ...upvoted]) {
      if (!byId.has(r.id)) byId.set(r.id, { url: r.url, title: r.title });
    }
    return groupFollowSuggestions([...byId.values()], minSignals);
  }
}

/**
 * Pure grouping for follow suggestions: given the DISTINCT saved/up-voted
 * candidate rows (already unioned by id upstream), group by `hostOf(url)`, count
 * one signal per row, keep hosts at or above `minSignals`, attach up to 3 non-null
 * sample titles, and sort by signal count descending (host asc as a stable tie-
 * break). Rows whose url has no parseable host are skipped. Exported for unit
 * tests so the grouping can be verified without a database.
 */
export function groupFollowSuggestions(
  rows: { url: string; title: string | null }[],
  minSignals: number,
): FollowSuggestion[] {
  const byHost = new Map<string, { count: number; titles: string[] }>();
  for (const row of rows) {
    const host = hostOf(row.url);
    if (!host) continue;
    const entry = byHost.get(host) ?? { count: 0, titles: [] };
    entry.count += 1;
    const title = row.title?.trim();
    if (title && entry.titles.length < 3) entry.titles.push(title);
    byHost.set(host, entry);
  }
  return [...byHost.entries()]
    .filter(([, e]) => e.count >= minSignals)
    .map(([domain, e]) => ({ domain, signalCount: e.count, sampleTitles: e.titles }))
    .sort((a, b) => b.signalCount - a.signalCount || a.domain.localeCompare(b.domain));
}

// ---- local-IR helpers (pure; unit-tested without a DB) --------------------

/**
 * The top `k` most frequent salient terms of `text`, returned as SURFACE words
 * (the readable form the reader saw) rather than Porter stems, because
 * `websearch_to_tsquery` wants real words. Ties break alphabetically for
 * determinism. Powers the "more like this" FTS candidate query.
 */
export function salientSurfaceTerms(text: string, k: number): string[] {
  const tf = termFrequencies(tokenize(text));
  const surfaces = surfaceForms(text);
  return Object.entries(tf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([stem]) => surfaces[stem] ?? stem);
}

/**
 * Re-rank FTS candidates by TF-IDF cosine to `sourceTf`: computes an IDF over the
 * source + candidate corpus, scores each candidate by cosine, and returns the top
 * `limit` candidate ids (score desc, id asc as a stable tie-break). Zero-overlap
 * candidates keep a real (possibly 0) score; the caller already guaranteed a
 * keyword match, so the FTS recall is the safety net. Pure — exported for tests.
 */
export function rankRelated(
  sourceTf: TermVector,
  candidates: { id: string; tf: TermVector }[],
  limit: number,
): string[] {
  if (candidates.length === 0) return [];
  const { idf } = computeIdf([sourceTf, ...candidates.map((c) => c.tf)]);
  const sv = tfidfVector(sourceTf, idf);
  return candidates
    .map((c) => ({ id: c.id, score: cosine(sv, tfidfVector(c.tf, idf)) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((s) => s.id);
}

/** An FTS hit enriched with the doc title for the cosine re-rank (title is not
 *  part of the public SearchResult; the store drops it after ranking). */
export interface RankableHit {
  id: string;
  title: string | null;
  snippet: string;
  rank: number;
}

/**
 * SET-preserving re-rank of the FTS hit list: reorder the top `window` hits by a
 * blend of the normalized `ts_rank` and the TF-IDF cosine of the query vs each
 * hit's title+snippet vector, leaving any beyond the window in place. The blend
 * is `rank/maxRank + cosine` — both in [0,1], summed with equal weight, so a
 * strong keyword hit keeps its footing and cosine only lifts genuinely on-topic
 * hits / breaks ties (original ts_rank order is the stable tie-break). No hit is
 * ever dropped, and a query that tokenizes to nothing returns the input untouched
 * — the change is purely additive ordering, never a change to the result set.
 */
export function rerankSearchHits(query: string, hits: RankableHit[], window = 50): RankableHit[] {
  const qtf = termFrequencies(tokenize(query));
  if (Object.keys(qtf).length === 0 || hits.length <= 1) return hits;
  const head = hits.slice(0, window).map((h) => ({
    h,
    tf: termFrequencies(tokenize(`${h.title ?? ""} ${h.snippet}`)),
  }));
  const tail = hits.slice(window);
  const { idf } = computeIdf([qtf, ...head.map((e) => e.tf)]);
  const qv = tfidfVector(qtf, idf);
  const maxRank = Math.max(0, ...head.map((e) => e.h.rank));
  const scored = head.map((e, i) => {
    const cos = cosine(qv, tfidfVector(e.tf, idf));
    const normRank = maxRank > 0 ? e.h.rank / maxRank : 0;
    return { h: e.h, i, score: normRank + cos };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return [...scored.map((s) => s.h), ...tail];
}

/** Per-tag TF-IDF centroids plus the IDF they were built with. */
export interface TagCentroids {
  idf: TermVector;
  centroids: { tag: string; vec: TermVector }[];
}

type CachedTagCentroids = TagCentroids & { builtAt: number };
/** Module-wide centroid cache (single user, so keyed by nothing) + its TTL. */
let tagCentroidCache: CachedTagCentroids | null = null;
const TAG_CENTROID_TTL_MS = 10 * 60 * 1000;

/**
 * Build per-tag TF-IDF centroids from sampled tag corpora. The IDF is computed
 * over every sampled doc across all tags; each tag's centroid is the L2-normalized
 * average of its docs' TF-IDF vectors. Tags with no usable sample are dropped.
 * Pure — exported for tests.
 */
export function buildTagCentroids(samples: { tag: string; texts: string[] }[]): TagCentroids {
  const perTag = samples.map((s) => ({
    tag: s.tag,
    tfs: s.texts
      .map((t) => termFrequencies(tokenize(t)))
      .filter((tf) => Object.keys(tf).length > 0),
  }));
  const { idf } = computeIdf(perTag.flatMap((p) => p.tfs));
  const centroids = perTag
    .filter((p) => p.tfs.length > 0)
    .map((p) => {
      const sum: TermVector = {};
      for (const tf of p.tfs) {
        for (const [term, w] of Object.entries(tfidfVector(tf, idf))) {
          sum[term] = (sum[term] ?? 0) + w;
        }
      }
      return { tag: p.tag, vec: l2normalize(sum) };
    });
  return { idf, centroids };
}

/**
 * Cosine of a document's TF-IDF vector (built with the centroids' IDF) to each
 * tag centroid; the top `topN` above `threshold`, excluding `existingTags`,
 * sorted by score desc (tag asc as a stable tie-break). Pure — exported for tests.
 */
export function suggestTagsFromCentroids(
  docText: string,
  existingTags: string[],
  centroids: TagCentroids,
  opts: { topN?: number; threshold?: number } = {},
): TagSuggestion[] {
  const { topN = 3, threshold = 0.05 } = opts;
  const tf = termFrequencies(tokenize(docText));
  if (Object.keys(tf).length === 0) return [];
  const dv = tfidfVector(tf, centroids.idf);
  const have = new Set(existingTags);
  return centroids.centroids
    .filter((c) => !have.has(c.tag))
    .map((c) => ({ tag: c.tag, score: cosine(dv, c.vec) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
    .slice(0, topN);
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
 *
 * Read state is deliberately NOT in this list. It lives inside the `metadata`
 * jsonb (`metadata.card.readState`) and is genuine backend truth for RSS and
 * saved articles — un-reading in MiniFlux or un-archiving in Readeck are real
 * upstream events that must win. The one exception is `category = 'email'`; see
 * `backendTruthSet`.
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
 *
 * EMAIL CARVE-OUT. Newsletters live in Readeck, which has no read flag: its read
 * state is re-derived from archive + progress (`deriveReadeckReadState`), so a
 * newsletter the user finished but did not archive comes back as `unopened` on
 * every poll and the `metadata` overwrite below would erase the read state Lectern
 * owns. For `category = 'email'` only, this set therefore never downgrades a
 * stored `finished` read state — the incoming metadata is written with
 * `card.readState` pinned back to `finished`.
 *
 * It is scoped to email ON PURPOSE. For miniflux RSS entries and readeck articles
 * the backend's read state IS the truth: marking unread in MiniFlux or
 * un-archiving in Readeck are real user actions that must propagate. A blanket
 * sticky rule would make un-reading from either backend permanently impossible.
 * An explicit local un-read still works everywhere — `markIndexedRead(id, false)`
 * writes `metadata` directly and never goes through this conflict set.
 */
export function backendTruthSet(row: NewDocumentRow) {
  return {
    category: row.category,
    title: row.title,
    url: row.url,
    metadata: row.category === "email" ? stickyFinishedMetadata() : row.metadata,
    savedAt: row.savedAt,
    updatedAt: row.updatedAt,
    deletedAt: null,
  };
}

/**
 * The email backstop as SQL: take the incoming (`excluded`) metadata, but if the
 * row already on disk says the newsletter is finished, pin the incoming card's
 * `readState` back to `finished`. Both `jsonb_exists` guards matter — `jsonb_set`
 * of a NULL blob returns NULL, which would wipe the stored card entirely.
 */
function stickyFinishedMetadata() {
  return dsql`case
    when jsonb_exists(${documents.metadata}, 'card')
     and ${documents.metadata}->'card'->>'readState' = 'finished'
     and jsonb_exists(excluded.metadata, 'card')
    then jsonb_set(excluded.metadata, '{card,readState}', '"finished"'::jsonb, true)
    else excluded.metadata
  end`;
}

/** Map a candidate row to the contract type: metadata jsonb spreads back out to
 *  author/siteName/imageUrl/publishedAt; the term vector stays server-side. */
function candidateFromRow(row: DiscoveryCandidateRow): DiscoveryCandidate {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const matchedTerms = Array.isArray(meta.matchedTerms)
    ? meta.matchedTerms.filter((t): t is string => typeof t === "string")
    : [];
  return DiscoveryCandidate.parse({
    id: row.id,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    fetcher: row.fetcher,
    score: row.score,
    status: row.status,
    vote: row.vote,
    runId: row.runId,
    author: str(meta.author),
    siteName: str(meta.siteName),
    imageUrl: str(meta.imageUrl),
    publishedAt: str(meta.publishedAt),
    matchedTerms,
    firstSeenAt: row.firstSeenAt.toISOString(),
  });
}

function voteFromRow(row: DiscoveryVoteRow): DiscoveryVote {
  return DiscoveryVote.parse({
    id: row.id,
    candidateId: row.candidateId,
    value: row.value,
    termVector: row.termVector,
    createdAt: row.createdAt.toISOString(),
  });
}

function profileFromRow(row: DiscoveryProfileRow): DiscoveryProfile {
  return DiscoveryProfile.parse({
    name: row.name,
    vector: row.vector,
    idf: row.idf,
    docCount: row.docCount,
    seededAt: row.seededAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    lastVoteProcessedAt: row.lastVoteProcessedAt?.toISOString() ?? null,
  });
}

// `includeTrace` is opt-in: list/latest views must NOT ship the (potentially
// large) forensic trace — only the single-run detail endpoint hydrates it.
function runFromRow(row: DiscoveryRunRow, includeTrace = false): DiscoveryRun {
  return DiscoveryRun.parse({
    id: row.id,
    status: row.status,
    stage: row.stage,
    trigger: row.trigger,
    stats: row.stats ?? {},
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    trace: includeTrace ? (row.trace ?? null) : null,
  });
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
