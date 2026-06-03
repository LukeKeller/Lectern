import { z } from "zod";

/**
 * Seed of the Lectern unified domain model (expanded in D2).
 *
 * A `Card` is the source-agnostic unit the client renders: it normalizes a MiniFlux
 * entry or a Readeck bookmark into one shape. Fields the backends cannot store
 * (unified location, unified tags, RSS reading progress) are owned by the BFF.
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

/** Readeck-style read status, mapped to/from `Location`. */
export const ReadStatus = z.enum(["unread", "reading", "read"]);
export type ReadStatus = z.infer<typeof ReadStatus>;

/** The unified card rendered by the client. ISO-8601 timestamps are strings. */
export const Card = z.object({
  id: z.string(),
  source: Source,
  sourceId: z.string(),
  category: Category,
  location: Location,
  title: z.string(),
  author: z.string().nullable().default(null),
  siteName: z.string().nullable().default(null),
  url: z.url(),
  wordCount: z.number().int().nonnegative().nullable().default(null),
  readingTime: z.string().nullable().default(null),
  readingProgress: z.number().min(0).max(1).default(0),
  readAnchor: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  highlightCount: z.number().int().nonnegative().default(0),
  savedAt: z.string(),
  updatedAt: z.string(),
});
export type Card = z.infer<typeof Card>;
