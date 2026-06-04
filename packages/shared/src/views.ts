import { z } from "zod";
import { QueryNode } from "./query";

export const ViewSortBy = z.enum([
  "publishedAt",
  "savedAt",
  "updatedAt",
  "title",
  "wordCount",
  "readingProgress",
]);
export type ViewSortBy = z.infer<typeof ViewSortBy>;

export const SortDir = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof SortDir>;

/** A pinnable saved view: a named, sorted query over the unified library. */
export const SavedView = z.object({
  id: z.string(),
  name: z.string().min(1),
  query: QueryNode,
  pinned: z.boolean().default(false),
  icon: z.string().nullable().default(null),
  position: z.number().int().default(0),
  sortBy: ViewSortBy.default("savedAt"),
  sortDir: SortDir.default("desc"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedView = z.infer<typeof SavedView>;
