/**
 * Sync cursor derivation.
 *
 * The cursor a `/sync` response hands back is the `since` of every pull that
 * follows it, and the delta query is `updatedAt > since` / `deletedAt > since`.
 * That makes the cursor a promise: "you have been given everything at or before
 * this instant". Anything the cursor skips is skipped FOREVER, because no later
 * pull ever looks below it again.
 *
 * The cursor used to be `new Date().toISOString()` — the server's clock at
 * response time — which breaks that promise under concurrency. A pull reads a
 * snapshot; rows whose transaction commits after that snapshot but whose
 * `updated_at` is older than the response's wall clock are in neither this
 * response nor any future one. In production this stranded 160 of 164
 * newsletters on one client: an import was writing rows with `updated_at`
 * between 01:09:2x and 01:09:36 while the client pulled and banked a cursor of
 * 01:09:34.617Z.
 *
 * The rule here is: never advance the cursor past data the client has actually
 * been handed, and never advance it into the window where writes may still be
 * in flight.
 *
 * Three deliberate choices, all biased toward RE-DELIVERY over loss (the client
 * merges by id with `bulkPut`, so an overlap costs bandwidth and nothing else):
 *
 *  1. **Derived from delivered rows.** The watermark is the max `updatedAt`
 *     across the returned cards and the max `deletedAt` across the returned
 *     tombstones. Nothing else can raise it.
 *
 *  2. **Capped by a safety lag** (`SYNC_CURSOR_LAG_MS`). The watermark alone is
 *     not sufficient. `documents.updated_at` is *backend*-supplied — Readeck's
 *     `updated`, MiniFlux's `changed_at` (see `backends/*.ts`) — so it is not
 *     even the glue DB's commit clock, let alone monotonic with commit order. A
 *     row can be committed now bearing a timestamp interleaved among rows we
 *     just delivered. Holding the cursor at least `SYNC_CURSOR_LAG_MS` behind
 *     `now` means such a row is still above the cursor and rides the next pull.
 *     The lag only bites while writes are recent: in the steady state the newest
 *     row is older than the window and the watermark wins outright.
 *
 *  3. **An empty delta does not advance the cursor at all.** This is the case
 *     that corrupted state fastest — an empty response jumping the cursor to
 *     `now()` is precisely how a client leaps over in-flight writes. `since` is
 *     returned verbatim.
 *
 * Precision: Postgres `timestamptz` is microsecond, JS `Date` (and therefore
 * `Date.parse` / `toISOString`) is millisecond. Every truncation here goes
 * through `Date.parse`, which rounds DOWN — so a cursor is never above the true
 * value of the row it came from, and the row at the boundary is re-delivered
 * rather than dropped. That is also why the query can stay strictly `>`: the
 * sub-millisecond remainder makes the boundary row satisfy it again.
 *
 * NOT a substitute for a monotonic sequence. See the note in `routes.ts`.
 */

/**
 * How far behind `now` the cursor is held while recent writes exist.
 *
 * One minute covers the realistic window between a writer's timestamp being
 * chosen (upstream, on a backend's clock) and its row becoming visible here: a
 * poll's per-item save loop, an import batch, and any modest clock skew between
 * Readeck/MiniFlux and the glue DB. A transaction that outlives the window can
 * still strand a row — only a sequence column closes that hole completely — but
 * the exposure drops from "any concurrent write" to "a write that took longer
 * than a minute to land".
 *
 * The cost of the lag is bounded and cheap: at most one minute of already-seen
 * changes re-delivered on the next pull, merged idempotently by id.
 */
export const SYNC_CURSOR_LAG_MS = 60_000;

export interface SyncCursorInput {
  /** The cursor the client sent, if any. */
  since: string | undefined;
  /** The cards actually included in this response. */
  cards: readonly { updatedAt: string }[];
  /** Max `deletedAt` across the tombstones included in this response. */
  maxDeletedAt?: string | null;
  /** Injectable clock, for tests. */
  now?: Date;
}

/** The cursor to hand back for a delta. See the module comment for the rules. */
export function nextSyncCursor(input: SyncCursorInput): string {
  const nowMs = (input.now ?? new Date()).getTime();
  const lagBoundMs = nowMs - SYNC_CURSOR_LAG_MS;

  let watermarkMs: number | undefined;
  const consider = (value: string | null | undefined): void => {
    if (!value) return;
    const t = Date.parse(value);
    if (Number.isNaN(t)) return;
    if (watermarkMs === undefined || t > watermarkMs) watermarkMs = t;
  };
  for (const card of input.cards) consider(card.updatedAt);
  consider(input.maxDeletedAt);

  const sinceMs = input.since === undefined ? Number.NaN : Date.parse(input.since);
  const hasSince = !Number.isNaN(sinceMs);

  // Nothing delivered: stand still. Returning `since` verbatim (not a re-encoded
  // copy) keeps the client's stored value byte-identical across no-op pulls.
  if (watermarkMs === undefined) {
    if (input.since !== undefined) return input.since;
    // First-ever pull against a library with no changes at all: the lag bound is
    // the only defensible anchor, and nothing was delivered that it could skip.
    return new Date(lagBoundMs).toISOString();
  }

  let nextMs = Math.min(watermarkMs, lagBoundMs);
  // Never go backwards: a `since` inside the lag window (or a skewed clock)
  // would otherwise re-deliver the same delta on every pull indefinitely.
  if (hasSince && nextMs < sinceMs) nextMs = sinceMs;
  return new Date(nextMs).toISOString();
}
