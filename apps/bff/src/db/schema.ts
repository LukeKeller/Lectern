import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { QueryNode } from "@lectern/shared";

/**
 * Lectern glue schema. The backends (MiniFlux, Readeck) remain the source of
 * truth for their own data; these tables hold the BFF-owned overlay/index that
 * the backends cannot store: unified triage location + tags + note, RSS reading
 * progress and highlights, saved views, backend credentials, sync cursors, and
 * an ingestion audit log.
 */

/**
 * Unified overlay/index, one row per unified document. Backend-derived fields
 * are denormalized here for fast querying; BFF-owned fields (location, tags,
 * note, RSS read_progress/read_anchor) are authoritative.
 */
export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    category: text("category").notNull(),
    location: text("location").notNull(),
    readProgress: real("read_progress").notNull().default(0),
    readAnchor: text("read_anchor"),
    tags: text("tags").array().notNull().default([]),
    note: text("note"),
    title: text("title"),
    url: text("url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [unique("documents_source_source_id_key").on(t.source, t.sourceId)],
);

/** RSS highlights (BFF-owned; MiniFlux has no highlight API). Mirrors `Highlight`. */
export const rssHighlights = pgTable("rss_highlights", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  text: text("text").notNull(),
  note: text("note"),
  color: text("color").notNull().default("yellow"),
  startSelector: text("start_selector").notNull(),
  startOffset: integer("start_offset").notNull(),
  endSelector: text("end_selector").notNull(),
  endOffset: integer("end_offset").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Pinnable saved views: a named, sorted query over the unified library. */
export const savedViews = pgTable("saved_views", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  query: jsonb("query").$type<QueryNode>().notNull(),
  pinned: boolean("pinned").notNull().default(false),
  sortBy: text("sort_by").notNull().default("savedAt"),
  sortDir: text("sort_dir").notNull().default("desc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-backend credentials. Single-user dev keeps these in env, but the table
 * lets the production deploy store per-user tokens minted out of band. */
export const backendTokens = pgTable("backend_tokens", {
  source: text("source").primaryKey(),
  baseUrl: text("base_url"),
  token: text("token"),
  basic: text("basic"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Last-seen delta cursor per backend, used to drive incremental ingestion. */
export const syncCursors = pgTable("sync_cursors", {
  source: text("source").primaryKey(),
  cursor: text("cursor"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only ingestion audit log for observability/debugging of sync runs. */
export const ingestionLog = pgTable("ingestion_log", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  action: text("action").notNull(),
  sourceId: text("source_id"),
  status: text("status").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type RssHighlightRow = typeof rssHighlights.$inferSelect;
export type NewRssHighlightRow = typeof rssHighlights.$inferInsert;
