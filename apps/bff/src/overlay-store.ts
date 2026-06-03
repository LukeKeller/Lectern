import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql as dsql } from "drizzle-orm";
import type {
  Card,
  CreateViewRequest,
  Highlight,
  HighlightColor,
  Location,
  NewHighlight,
  SavedView,
  Source,
  Tag,
  UpdateViewRequest,
} from "@lectern/shared";
import type { Db } from "./db/client";
import { documents, rssHighlights, savedViews } from "./db/schema";
import type { NewDocumentRow } from "./db/schema";
import { parseId } from "./ids";
import { mergeOverlay, type Overlay, type OverlayPatch, type OverlayStore } from "./unify";

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
    const counts = await this.getRssHighlightCounts([id]);
    const merged = mergeOverlay(base, overlay, counts[id] ?? 0);
    return row.title ? { ...merged, title: row.title } : merged;
  }

  async upsertIndex(card: Card): Promise<void> {
    const row = rowFromCard(card);
    await this.db
      .insert(documents)
      .values(row)
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          category: row.category,
          location: row.location,
          readProgress: row.readProgress,
          readAnchor: row.readAnchor,
          tags: row.tags,
          note: row.note,
          title: row.title,
          url: row.url,
          metadata: row.metadata,
          savedAt: row.savedAt,
          updatedAt: row.updatedAt,
        },
      });
  }

  async indexFromBackend(card: Card): Promise<void> {
    const row = rowFromCard(card);
    // On conflict refresh only backend-truth columns; the overlay columns
    // (location/tags/note/read_progress/read_anchor) stay BFF-authoritative.
    await this.db
      .insert(documents)
      .values(row)
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          category: row.category,
          title: row.title,
          url: row.url,
          metadata: row.metadata,
          savedAt: row.savedAt,
          updatedAt: row.updatedAt,
        },
      });
  }

  async deleteDocument(id: string): Promise<void> {
    await this.db.delete(rssHighlights).where(eq(rssHighlights.documentId, id));
    await this.db.delete(documents).where(eq(documents.id, id));
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
    const rows = await this.db.select().from(savedViews).orderBy(desc(savedViews.createdAt));
    return rows.map(viewRowToView);
  }

  async createView(input: CreateViewRequest): Promise<SavedView> {
    const [row] = await this.db
      .insert(savedViews)
      .values({
        id: randomUUID(),
        name: input.name,
        query: input.query,
        pinned: input.pinned,
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
}

function defaultCategory(source: Source): string {
  return source === "miniflux" ? "rss" : "article";
}

function defaultLocation(source: Source): Location {
  return source === "miniflux" ? "feed" : "later";
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

function viewRowToView(row: typeof savedViews.$inferSelect): SavedView {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    pinned: row.pinned,
    sortBy: row.sortBy as SavedView["sortBy"],
    sortDir: row.sortDir as SavedView["sortDir"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
