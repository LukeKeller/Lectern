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
 * Published podcast episodes: one saved article rendered to audio and exposed
 * through the tokenized RSS feed. The row is a self-contained snapshot
 * (title/url/excerpt/cover taken at add-time) so the feed survives the source
 * document being un-saved or re-voiced; the audio bytes live in `tts_audio`,
 * joined by `content_hash`. One episode per document (PK).
 */
export const podcastEpisodes = pgTable("podcast_episodes", {
  documentId: text("document_id").primaryKey(),
  contentHash: text("content_hash").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  excerpt: text("excerpt"),
  coverImage: text("cover_image"),
  author: text("author"),
  mime: text("mime").notNull(),
  byteLength: integer("byte_length").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
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

/**
 * Per-source ("dress") theming tokens, extracted from a publication's site
 * `<head>` and keyed by host — every article from a source shares one row.
 * Computed lazily on first read and cached here; a manual refresh re-fetches.
 * Empty-string columns record "checked, none" (distinct from a null-absent row
 * meaning "never fetched") so the lazy compute doesn't re-run on every open.
 */
export const sourceTheme = pgTable("source_theme", {
  host: text("host").primaryKey(),
  accent: text("accent").notNull().default(""),
  accentDark: text("accent_dark").notNull().default(""),
  background: text("background").notNull().default(""),
  backgroundDark: text("background_dark").notNull().default(""),
  text: text("text").notNull().default(""),
  link: text("link").notNull().default(""),
  bodyFont: text("body_font").notNull().default(""),
  displayFont: text("display_font").notNull().default(""),
  faviconUrl: text("favicon_url").notNull().default(""),
  siteName: text("site_name").notNull().default(""),
  // '' | 'literal' | 'derived' — how the re-skin palette was obtained.
  derivation: text("derivation").notNull().default(""),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Browser Web Push subscriptions (single-user, but one row per browser/device).
 * Keyed by endpoint so re-subscribing the same browser upserts rather than
 * duplicates. The p256dh/auth keys are the subscription's encryption material.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-feed notification preference: whether a batched Web Push fires when the
 * poll indexes genuinely-new entries for this feed. `feed_id` is the stringified
 * MiniFlux feed id (matches the `id` returned by GET /feeds). Default enabled.
 */
export const feedNotificationPrefs = pgTable("feed_notification_prefs", {
  feedId: text("feed_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Content-discovery candidates: articles the discovery worker found on the open
 * web and scored (TF-IDF cosine to the interest profile). One row per deduped
 * URL. `termVector` is the candidate's TF map, persisted so a later vote can
 * train the Rocchio profile without re-fetching the page. BFF-owned; the worker
 * writes these only via the API.
 */
export const discoveryCandidates = pgTable("discovery_candidates", {
  id: text("id").primaryKey(), // disc:<sha1(url_normalized)>
  url: text("url").notNull(),
  urlNormalized: text("url_normalized").notNull().unique(),
  title: text("title"),
  excerpt: text("excerpt"),
  fetcher: text("fetcher").notNull(), // searxng | brave | crawl
  score: real("score").notNull().default(0),
  termVector: jsonb("term_vector").$type<Record<string, number>>().notNull().default({}),
  status: text("status").notNull().default("active"), // active | dismissed | saved
  vote: text("vote"), // null | up | down
  runId: text("run_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(), // author/siteName/imageUrl/publishedAt
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only vote signal log. Each vote copies the candidate's `termVector` at
 * vote time so a later-pruned candidate still trains the model. `processed`
 * flips true once a run folds it into the profile.
 */
export const discoveryVotes = pgTable("discovery_votes", {
  id: serial("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  value: text("value").notNull(), // up | down
  termVector: jsonb("term_vector").$type<Record<string, number>>().notNull().default({}),
  processed: boolean("processed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The persisted Rocchio interest model (one logical row, keyed by name). */
export const discoveryProfile = pgTable("discovery_profile", {
  name: text("name").primaryKey().default("default"),
  vector: jsonb("vector").$type<Record<string, number>>().notNull().default({}),
  idf: jsonb("idf").$type<Record<string, number>>().notNull().default({}),
  docCount: integer("doc_count").notNull().default(0),
  seededAt: timestamp("seeded_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastVoteProcessedAt: timestamp("last_vote_processed_at", { withTimezone: true }),
});

/**
 * One row per discovery run, updated live by the worker so the Activity page can
 * show progress. `stats` holds fetched/deduped/scored/inserted counts + a
 * per-fetcher tally.
 */
export const discoveryRuns = pgTable("discovery_runs", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("running"), // running | succeeded | failed
  stage: text("stage").notNull().default("starting"),
  trigger: text("trigger").notNull().default("manual"), // cron | manual
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  // Deep forensic trace (queries, per-source raw results, crawler internals,
  // per-candidate scoring funnel). Written once at run end; null for older runs.
  trace: jsonb("trace").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
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
export type PodcastEpisodeRow = typeof podcastEpisodes.$inferSelect;
export type NewPodcastEpisodeRow = typeof podcastEpisodes.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
export type FeedNotificationPrefRow = typeof feedNotificationPrefs.$inferSelect;
export type DiscoveryCandidateRow = typeof discoveryCandidates.$inferSelect;
export type NewDiscoveryCandidateRow = typeof discoveryCandidates.$inferInsert;
export type DiscoveryVoteRow = typeof discoveryVotes.$inferSelect;
export type NewDiscoveryVoteRow = typeof discoveryVotes.$inferInsert;
export type DiscoveryProfileRow = typeof discoveryProfile.$inferSelect;
export type NewDiscoveryProfileRow = typeof discoveryProfile.$inferInsert;
export type DiscoveryRunRow = typeof discoveryRuns.$inferSelect;
export type NewDiscoveryRunRow = typeof discoveryRuns.$inferInsert;
