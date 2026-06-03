import { z } from "zod";
import { Card, HighlightColor, Location } from "./model";

/**
 * Offline sync. The client pulls deltas by cursor and queues mutations while
 * offline; the BFF applies each mutation to the owning store (backend or glue DB).
 */

export const Mutation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setLocation"), id: z.string(), location: Location }),
  z.object({
    type: z.literal("setReadingProgress"),
    id: z.string(),
    readingProgress: z.number().min(0).max(1),
    readAnchor: z.string().nullable().default(null),
  }),
  z.object({ type: z.literal("setTags"), id: z.string(), tags: z.array(z.string()) }),
  z.object({ type: z.literal("setNote"), id: z.string(), note: z.string().nullable() }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({
    type: z.literal("addHighlight"),
    id: z.string(),
    text: z.string(),
    color: HighlightColor.default("yellow"),
    note: z.string().nullable().default(null),
    startSelector: z.string(),
    startOffset: z.number().int().nonnegative(),
    endSelector: z.string(),
    endOffset: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("removeHighlight"), id: z.string(), highlightId: z.string() }),
]);
export type Mutation = z.infer<typeof Mutation>;

export const SyncPullResponse = z.object({
  cards: z.array(Card),
  deletedIds: z.array(z.string()).default([]),
  cursor: z.string(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

export const SyncPushRequest = z.object({ mutations: z.array(Mutation) });
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const SyncConflict = z.object({ id: z.string(), reason: z.string() });
export type SyncConflict = z.infer<typeof SyncConflict>;

export const SyncPushResponse = z.object({
  applied: z.number().int().nonnegative(),
  conflicts: z.array(SyncConflict).default([]),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;
