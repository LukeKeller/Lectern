import { z } from "zod";

/**
 * Lectern unified domain model.
 *
 * A `Card` is the source-agnostic unit the client renders: it normalizes a MiniFlux
 * entry or a Readeck bookmark into one shape. Fields the backends cannot store
 * (unified location, unified tags, RSS reading progress + highlights) are owned by
 * the BFF. Units are normalized here (see docs/spikes/D1-findings.md):
 *   - readingProgress is 0..1 (Readeck's 0..100 is divided in its adapter)
 *   - readingTimeMinutes is an integer count of minutes
 */

/** Which backend a card originates from. */
export const Source = z.enum(["miniflux", "readeck"]);
export type Source = z.infer<typeof Source>;

/** Content type. EPUB is intentionally excluded from v1. */
export const Category = z.enum(["article", "rss", "email", "pdf"]);
export type Category = z.infer<typeof Category>;

/** Unified triage location (BFF-owned, mirrored to backend states). */
export const Location = z.enum(["inbox", "later", "shortlist", "archive", "feed"]);
export type Location = z.infer<typeof Location>;

/**
 * Derived, unified read state. Readeck has no read-status enum; the BFF computes
 * this from `is_archived` + `read_progress`. MiniFlux maps its binary read flag.
 */
export const ReadState = z.enum(["unopened", "reading", "finished"]);
export type ReadState = z.infer<typeof ReadState>;

export const HighlightColor = z.enum(["yellow", "red", "blue", "green"]);
export type HighlightColor = z.infer<typeof HighlightColor>;

/** A text highlight, anchored to the rendered article via DOM range selectors. */
export const Highlight = z.object({
  id: z.string(),
  documentId: z.string(),
  text: z.string(),
  note: z.string().nullable().default(null),
  color: HighlightColor.default("yellow"),
  startSelector: z.string(),
  startOffset: z.number().int().nonnegative(),
  endSelector: z.string(),
  endOffset: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Highlight = z.infer<typeof Highlight>;

/** A unified tag with its document count. */
export const Tag = z.object({
  name: z.string(),
  count: z.number().int().nonnegative().default(0),
});
export type Tag = z.infer<typeof Tag>;

/** The unified card rendered by the client. ISO-8601 timestamps are strings. */
export const Card = z.object({
  id: z.string(),
  source: Source,
  sourceId: z.string(),
  category: Category,
  location: Location,
  readState: ReadState.default("unopened"),
  title: z.string(),
  // Short plain-text snippet/summary for list previews (RSS: derived from the
  // entry content; saved articles: the source's description). Null when none.
  excerpt: z.string().nullable().default(null),
  author: z.string().nullable().default(null),
  siteName: z.string().nullable().default(null),
  url: z.url(),
  coverImage: z.url().nullable().default(null),
  wordCount: z.number().int().nonnegative().nullable().default(null),
  readingTimeMinutes: z.number().int().nonnegative().nullable().default(null),
  readingProgress: z.number().min(0).max(1).default(0),
  readAnchor: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  highlightCount: z.number().int().nonnegative().default(0),
  note: z.string().nullable().default(null),
  savedAt: z.string(),
  updatedAt: z.string(),
  // Original article publication date (RSS: MiniFlux published_at; saved
  // articles: the source's published date when known). Distinct from savedAt
  // (when the item entered Lectern). Null when the backend has no publish date.
  publishedAt: z.string().nullable().default(null),
});
export type Card = z.infer<typeof Card>;
