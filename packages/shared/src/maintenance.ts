import { z } from "zod";

/**
 * Library maintenance operations: bulk deletes and on-demand sync. These remove
 * items AT THE SOURCE (so the 5-minute poll can't re-add them) and tombstone the
 * local index rows so the deletion propagates to other devices via `/sync`.
 */

/**
 * What a bulk delete targets:
 *   - `archive`    — every document in `location="archive"` (any source).
 *   - `read-feed`  — read MiniFlux/RSS feed items only.
 */
export const BulkDeleteScope = z.enum(["archive", "read-feed"]);
export type BulkDeleteScope = z.infer<typeof BulkDeleteScope>;

export const BulkDeleteRequest = z.object({ scope: BulkDeleteScope });
export type BulkDeleteRequest = z.infer<typeof BulkDeleteRequest>;

export const BulkDeleteResponse = z.object({ deleted: z.number().int().nonnegative() });
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponse>;

/**
 * Result of an on-demand force sync: how many items each backend poll indexed
 * plus how many index rows the deletion reconcile tombstoned.
 */
export const ForceSyncResponse = z.object({
  miniflux: z.number().int().nonnegative(),
  readeck: z.number().int().nonnegative(),
  tombstoned: z.number().int().nonnegative(),
});
export type ForceSyncResponse = z.infer<typeof ForceSyncResponse>;
