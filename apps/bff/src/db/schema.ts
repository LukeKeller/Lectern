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
    // Soft-delete tombstone: set when a backend item disappears (e.g. dedup) so
    // /sync can report deletions to clients. Null = live.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [unique("documents_source_source_id_key").on(t.source, t.sourceId)],
);

/**
 * Owned article full text (one row per captured document). Lives apart from the
 * `documents` index so list/sync never load bodies. `body_tsv` is a generated
 * STORED tsvector (see migration 0002) for full-text search; it is not modeled
 * here because it must never appear in inserts.
 */
export const documentContent = pgTable("document_content", {
  documentId: text("document_id").primaryKey(),
  html: text("html").notNull(),
  charCount: integer("char_count").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  icon: text("icon"),
  position: integer("position").notNull().default(0),
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

/** Generic single-user app settings (jsonb blob per key). Used for TTS config
 * (ElevenLabs key + voice/model) so the key lives server-side, never in the SPA. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Synthesized read-aloud audio, cached by content hash (text+voice+model) so
 * re-listens and queue replays never re-bill ElevenLabs. Audio is base64 text
 * (driver-agnostic; single-user scale). */
export const ttsAudio = pgTable("tts_audio", {
  contentHash: text("content_hash").primaryKey(),
  documentId: text("document_id").notNull(),
  mime: text("mime").notNull(),
  audioBase64: text("audio_base64").notNull(),
  charCount: integer("char_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-document reader accent colour, derived server-side from the cover image
 * (dominant, contrast-clamped). Separate table so it survives backend re-ingest.
 * `color` is a hex string, or `''` to record "computed, no usable colour" so the
 * lazy compute doesn't re-run on every open.
 */
export const documentAccent = pgTable("document_accent", {
  documentId: text("document_id").primaryKey(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
export type DocumentContentRow = typeof documentContent.$inferSelect;
export type NewDocumentContentRow = typeof documentContent.$inferInsert;
export type AppSettingRow = typeof appSettings.$inferSelect;
export type TtsAudioRow = typeof ttsAudio.$inferSelect;
