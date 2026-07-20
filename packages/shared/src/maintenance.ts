import { z } from "zod";
import { Category, Location, Source } from "./model";

/**
 * Library maintenance operations: bulk deletes and on-demand sync. These remove
 * items AT THE SOURCE (so the 5-minute poll can't re-add them) and tombstone the
 * local index rows so the deletion propagates to other devices via `/sync`.
 */

/**
 * What a bulk delete targets:
 *   - `archive`    — every document in `location="archive"` (any source).
 *   - `read-feed`  — read MiniFlux/RSS feed items only.
 *   - `read-all`   — read feed items AND read newsletter (email) issues, in one
 *                    sweep — the global "delete everything I've finished".
 */
export const BulkDeleteScope = z.enum(["archive", "read-feed", "read-all"]);
export type BulkDeleteScope = z.infer<typeof BulkDeleteScope>;

export const BulkDeleteRequest = z.object({ scope: BulkDeleteScope });
export type BulkDeleteRequest = z.infer<typeof BulkDeleteRequest>;

export const BulkDeleteResponse = z.object({ deleted: z.number().int().nonnegative() });
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponse>;

/**
 * A targeted age-based sweep over the unified index. Either deletes the matched
 * items (removed at the source so the poll can't re-add them — the cure for a
 * backend that keeps re-serving stale entries) or marks them read. Powers two
 * UI actions that share one cutoff model:
 *   - "clean up items older than a week"  → `before` = now − 7d
 *   - "clear everything below this item"  → `before` = the anchor's timestamp
 * The facets (location/source/category) scope the sweep; at least one SHOULD be
 * set so it never spans the whole library by accident.
 */
export const BulkMaintenanceAction = z.enum(["delete", "mark-read"]);
export type BulkMaintenanceAction = z.infer<typeof BulkMaintenanceAction>;

/** Which timestamp the cutoff compares against. `savedAt` is an RSS entry's
 * publish date (MiniFlux `published_at`) and a saved article's save date;
 * `updatedAt` is the backend's last-change time. */
export const BulkMaintenanceDateField = z.enum(["savedAt", "updatedAt"]);
export type BulkMaintenanceDateField = z.infer<typeof BulkMaintenanceDateField>;

export const BulkMaintenanceRequest = z.object({
  action: BulkMaintenanceAction,
  /** ISO-8601 cutoff: items strictly older than this are swept (see `inclusive`). */
  before: z.string(),
  dateField: BulkMaintenanceDateField.default("savedAt"),
  /** Include items whose timestamp equals `before` (used to include the anchor). */
  inclusive: z.boolean().default(false),
  location: Location.optional(),
  source: Source.optional(),
  category: Category.optional(),
});
export type BulkMaintenanceRequest = z.infer<typeof BulkMaintenanceRequest>;

export const BulkMaintenanceResponse = z.object({
  action: BulkMaintenanceAction,
  affected: z.number().int().nonnegative(),
});
export type BulkMaintenanceResponse = z.infer<typeof BulkMaintenanceResponse>;

/**
 * Result of an on-demand force sync: how many items each backend poll indexed
 * plus how many index rows the deletion reconcile tombstoned.
 */
export const ForceSyncResponse = z.object({
  miniflux: z.number().int().nonnegative(),
  readeck: z.number().int().nonnegative(),
  /** Newsletters ingested from IMAP. Defaults to 0 so a server that predates the
   *  manual newsletter trigger (or has IMAP unconfigured) still parses. */
  email: z.number().int().nonnegative().default(0),
  tombstoned: z.number().int().nonnegative(),
});
export type ForceSyncResponse = z.infer<typeof ForceSyncResponse>;
