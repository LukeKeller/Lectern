import { inArray, sql as dsql } from "drizzle-orm";
import type { Location } from "@lectern/shared";
import type { Db } from "./db/client";
import { documents, rssHighlights } from "./db/schema";
import type { Overlay, OverlayStore } from "./unify";

/**
 * Glue-DB-backed `OverlayStore`: reads the BFF-owned overlay (documents row) and
 * RSS highlight counts for a batch of unified ids.
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
}
