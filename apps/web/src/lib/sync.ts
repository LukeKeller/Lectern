import {
	FINISHED_THRESHOLD,
	type Card,
	type Mutation,
	type SyncManifestResponse,
	type SyncPullResponse,
	type SyncPushRequest,
	type SyncPushResponse
} from '@lectern/shared';
import { db, type LecternDB } from './db';
import { getClient } from './config';

/**
 * Offline-first sync engine. Deltas are pulled by cursor and merged into Dexie;
 * mutations are applied optimistically to the local mirror and queued in an
 * outbox that is drained (with retry/backoff) whenever the client is online.
 *
 * The merge/queue primitives are pure functions so they can be unit-tested
 * without IndexedDB; the engine wires them to Dexie and the network.
 */

const CURSOR_KEY = 'cursor';
const RECONCILED_KEY = 'reconciledAt';

/**
 * How often the local mirror is checked against the server's authoritative id
 * set. Deltas are additive, so drift (a hard-deleted row, a missed delta) is
 * permanent until a reconcile notices it; six hours heals it within a day of
 * normal use while costing one id-only request — a few KB — per window.
 */
export const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Minimal surface of the API client the engine depends on. */
export interface SyncClient {
	syncPull(query?: { since?: string; pageSize?: number }): Promise<SyncPullResponse>;
	syncPush(body: SyncPushRequest): Promise<SyncPushResponse>;
	syncManifest(): Promise<SyncManifestResponse>;
	/** Fetch one card by id — how the reconcile backfills a short mirror. */
	getDocument(id: string): Promise<Card>;
}

export interface SyncEngineOptions {
	db: LecternDB;
	client: SyncClient;
	/** Max push attempts before the outbox is left intact for a later retry. */
	maxRetries?: number;
	/** Backoff delay in ms for a given (1-based) attempt. */
	backoff?: (attempt: number) => number;
	sleep?: (ms: number) => Promise<void>;
}

// ---- Pure primitives --------------------------------------------------------

/**
 * Apply a mutation to a local card, returning the next card state. Returns
 * `undefined` when the card should be removed (a `delete` mutation) or when the
 * card is not present locally and the mutation cannot create one.
 */
export function applyMutation(card: Card | undefined, mutation: Mutation): Card | undefined {
	if (!card) return undefined;
	const updatedAt = new Date().toISOString();
	switch (mutation.type) {
		case 'setLocation':
			return { ...card, location: mutation.location, updatedAt };
		case 'setReadingProgress': {
			// Mirror the BFF's derived read state (archived → finished, scrolled past
			// the finished threshold → finished, started → reading) so the optimistic
			// card already matches what the next pull returns without a round-trip.
			const readState: Card['readState'] =
				card.location === 'archive' || mutation.readingProgress >= FINISHED_THRESHOLD
					? 'finished'
					: mutation.readingProgress > 0
						? 'reading'
						: 'unopened';
			return {
				...card,
				readingProgress: mutation.readingProgress,
				readAnchor: mutation.readAnchor,
				readState,
				updatedAt
			};
		}
		case 'setTags':
			return { ...card, tags: mutation.tags, updatedAt };
		case 'setNote':
			return { ...card, note: mutation.note, updatedAt };
		case 'addHighlight':
			return { ...card, highlightCount: card.highlightCount + 1, updatedAt };
		case 'removeHighlight':
			return { ...card, highlightCount: Math.max(0, card.highlightCount - 1), updatedAt };
		case 'markRead':
			return { ...card, readState: mutation.read ? 'finished' : 'unopened', updatedAt };
		case 'delete':
			return undefined;
	}
}

/** The server's authoritative id set, as the reconcile planner consumes it. */
export interface AuthoritativeSet {
	ids: string[];
	/** The server's own count of the set, used to prove nothing was truncated. */
	count: number;
}

export interface ReconcilePlanInput {
	/** Local card ids, snapshotted BEFORE the authoritative set was fetched. */
	localIds: string[];
	authoritative: AuthoritativeSet;
	/** Ids referenced by queued outbox mutations — never pruned. */
	pendingIds: string[];
}

/**
 * How the missing half of a divergence is repaired.
 *
 *  - `none` — the mirror holds every id the server does.
 *  - `fetch` — a handful of ids are missing; pull them individually by id.
 *  - `full` — too many are missing for N round-trips to make sense; re-pull the
 *    whole live set in one cursor-less request, exactly as `rebuild` does.
 */
export type BackfillStrategy = 'none' | 'fetch' | 'full';

export interface ReconcilePlan {
	/** Local ids the server no longer has. */
	removeIds: string[];
	/** Server ids the mirror is missing. Empty when `backfill` is `none`. */
	missingIds: string[];
	backfill: BackfillStrategy;
}

/**
 * Above this many missing cards, one full pull beats N by-id lookups outright —
 * a full pull is a single request whose body is the same cards the lookups would
 * have fetched one at a time, minus the per-request overhead.
 */
export const RECONCILE_BACKFILL_MAX = 50;

/**
 * ...and the same holds proportionally: once this share of the library is
 * missing, the mirror is diverged rather than merely stale, and a full pull is
 * both cheaper and a cleaner re-anchoring than a scatter of lookups.
 */
export const RECONCILE_BACKFILL_FRACTION = 0.25;

/** ...but never for a handful of cards, however small the library. */
export const RECONCILE_BACKFILL_MIN = 5;

/** How many by-id fetches the `fetch` strategy runs at once. */
const BACKFILL_CONCURRENCY = 6;

/**
 * Decide which local cards no longer exist server-side and may be dropped, and
 * which server-side cards the mirror is missing and must fetch.
 *
 * Both directions matter. Pruning alone was the original bug: deltas are
 * additive and a client that has LOST documents (a sync cursor that skipped
 * them, a failed merge) could never recover them, because nothing in the pull
 * path ever revisits a row below the cursor. The reconcile would then report
 * success while the mirror stayed short — in production, by 160 of 164 cards.
 *
 * Ids under a queued mutation are excluded from BOTH sides. On the prune side
 * that protects an offline edit (see below); on the backfill side it prevents a
 * worse bug — a locally-deleted card whose `delete` mutation has not been pushed
 * is still in the server's manifest, and fetching it would resurrect the very
 * card the user just deleted, on every reconcile until the push lands.
 *
 * Returns `null` — meaning "reconcile nothing" — whenever the authoritative set
 * cannot be trusted. Deleting on the strength of an ABSENCE is only sound if the
 * set is known-complete, so a truncated response must abort rather than empty
 * the library. Completeness is proven by the server's own count matching the ids
 * actually received; a body cut short fails this even if it somehow parsed.
 *
 * Two classes of local card are protected from pruning:
 *
 *  - **Cards with queued mutations** (`pendingIds`). The outbox holds work the
 *    server has not seen. Deleting such a card would destroy the user's offline
 *    edit and, worse, the card would be gone locally while the mutation still
 *    referenced it. Note that a queued `delete` names its card too — but the
 *    optimistic apply has already removed that card locally, so it is not in
 *    `localIds` and there is nothing to protect.
 *  - **Cards created since the snapshot.** Handled by the caller passing a
 *    `localIds` snapshot taken before the fetch: a card saved while the manifest
 *    was in flight is legitimately absent from it, and would otherwise be
 *    deleted the instant it arrived. Diffing against the pre-fetch snapshot
 *    makes that race unrepresentable rather than merely unlikely.
 */
export function planReconcile(input: ReconcilePlanInput): ReconcilePlan | null {
	const { localIds, authoritative, pendingIds } = input;
	if (authoritative.ids.length !== authoritative.count) return null;
	const live = new Set(authoritative.ids);
	const local = new Set(localIds);
	const pending = new Set(pendingIds);
	const removeIds = localIds.filter((id) => !live.has(id) && !pending.has(id));
	const missingIds = authoritative.ids.filter((id) => !local.has(id) && !pending.has(id));
	return { removeIds, missingIds, backfill: backfillStrategy(missingIds.length, authoritative) };
}

function backfillStrategy(missing: number, authoritative: AuthoritativeSet): BackfillStrategy {
	if (missing === 0) return 'none';
	if (missing > RECONCILE_BACKFILL_MAX) return 'full';
	// The proportional rule only applies above a handful of cards: in a small
	// library any absence is a large fraction of it, and a whole-library pull
	// (which also re-anchors the cursor) is too blunt an answer to two missing
	// rows.
	if (
		missing > RECONCILE_BACKFILL_MIN &&
		missing > authoritative.count * RECONCILE_BACKFILL_FRACTION
	)
		return 'full';
	return 'fetch';
}

/**
 * Whether a reconcile is due. Unknown/unparseable markers count as due (a client
 * that has never reconciled is exactly the one most likely to have drifted); a
 * marker in the future is treated as due too, so a clock skew cannot wedge
 * reconciles off indefinitely.
 */
export function isReconcileDue(
	lastReconciledAt: string | undefined,
	now: number,
	intervalMs = RECONCILE_INTERVAL_MS
): boolean {
	if (!lastReconciledAt) return true;
	const last = Date.parse(lastReconciledAt);
	if (Number.isNaN(last)) return true;
	if (last > now) return true;
	return now - last >= intervalMs;
}

/** Exponential backoff (no jitter) so retries stay deterministic in tests. */
export function backoffDelay(attempt: number, base = 300, max = 30_000): number {
	return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

function defaultSleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

function isOnline(): boolean {
	return typeof navigator === 'undefined' ? true : navigator.onLine;
}

// ---- Engine -----------------------------------------------------------------

export class SyncEngine {
	private readonly db: LecternDB;
	private readonly client: SyncClient;
	private readonly maxRetries: number;
	private readonly backoff: (attempt: number) => number;
	private readonly sleep: (ms: number) => Promise<void>;
	private flushing = false;
	private failed = false;
	private started = false;
	private onlineHandler?: () => void;
	private activityListener?: (s: { flushing: boolean; failed: boolean }) => void;

	constructor(opts: SyncEngineOptions) {
		this.db = opts.db;
		this.client = opts.client;
		this.maxRetries = opts.maxRetries ?? 5;
		this.backoff = opts.backoff ?? backoffDelay;
		this.sleep = opts.sleep ?? defaultSleep;
	}

	/**
	 * Register an observer notified whenever flush activity changes. The engine
	 * stays rune-free; the rune store wires this from outside to avoid a cycle.
	 */
	setActivityListener(fn: (s: { flushing: boolean; failed: boolean }) => void): void {
		this.activityListener = fn;
	}

	/** The persisted sync cursor, or `undefined` before the first pull. */
	async getCursor(): Promise<string | undefined> {
		const row = await this.db.meta.get(CURSOR_KEY);
		return row?.value;
	}

	/** Pull deltas since the stored cursor and merge them into the local mirror. */
	async pull(): Promise<void> {
		await this.pullSince(await this.getCursor());
	}

	/**
	 * Pull and merge one delta. `since` undefined means the full live set — the
	 * single path `rebuild` and the reconcile's `full` backfill both take, so the
	 * two cannot drift apart. Re-anchoring the cursor from a full pull can move it
	 * backwards; that is safe (the server's cursor is now derived from delivered
	 * rows, and merges are idempotent by id) and re-delivery beats a gap.
	 */
	private async pullSince(since: string | undefined): Promise<void> {
		const res = await this.client.syncPull(since ? { since } : {});
		await this.db.transaction('rw', this.db.cards, this.db.meta, async () => {
			if (res.cards.length) await this.db.cards.bulkPut(res.cards);
			if (res.deletedIds.length) await this.db.cards.bulkDelete(res.deletedIds);
			await this.db.meta.put({ key: CURSOR_KEY, value: res.cursor });
		});
	}

	/**
	 * Fetch cards by id, a bounded batch at a time. Individual failures are
	 * tolerated rather than fatal: an id may legitimately have disappeared between
	 * the manifest and the fetch, and one dead lookup must not abandon the rest of
	 * the repair. Whatever fails stays missing locally, so the next reconcile sees
	 * it in the manifest again and retries — the loop is self-healing without
	 * needing to distinguish "gone" from "unreachable".
	 */
	private async fetchCards(ids: string[]): Promise<Card[]> {
		const cards: Card[] = [];
		for (let i = 0; i < ids.length; i += BACKFILL_CONCURRENCY) {
			const batch = ids.slice(i, i + BACKFILL_CONCURRENCY);
			const results = await Promise.allSettled(batch.map((id) => this.client.getDocument(id)));
			for (const r of results) if (r.status === 'fulfilled') cards.push(r.value);
		}
		return cards;
	}

	/** When the last successful reconcile finished, or `undefined` if never. */
	async getReconciledAt(): Promise<string | undefined> {
		const row = await this.db.meta.get(RECONCILED_KEY);
		return row?.value;
	}

	/**
	 * Converge the local mirror on the server's authoritative id set, in BOTH
	 * directions: drop local cards the server no longer has, and fetch server
	 * cards the mirror is missing. This is the only mechanism that can heal a
	 * diverged mirror: `pull` is purely additive and never revisits a row below
	 * the cursor, and a hard-deleted row is reported by no delta at all.
	 *
	 * Ordering matters and is deliberate:
	 *  1. snapshot the local ids and the outbox FIRST, so a card saved or edited
	 *     while the manifest is in flight can never be pruned by it;
	 *  2. fetch the manifest — if it throws, nothing is changed;
	 *  3. plan purely; a set that fails its completeness check aborts everything;
	 *  4. prune, THEN backfill. In that order a card the backfill delivers can
	 *     never be deleted by a prune decided from an older snapshot.
	 *
	 * Returns the number of cards removed, or `null` if the set was untrustworthy
	 * (in which case the marker is NOT advanced, so the next check retries).
	 */
	async reconcile(): Promise<number | null> {
		const [localIds, outbox] = await Promise.all([
			this.db.cards.toCollection().primaryKeys(),
			this.db.outbox.toArray()
		]);
		const manifest = await this.client.syncManifest();
		const plan = planReconcile({
			localIds,
			authoritative: manifest,
			pendingIds: outbox.map((e) => e.mutation.id)
		});
		if (!plan) return null;
		if (plan.removeIds.length) await this.db.cards.bulkDelete(plan.removeIds);
		if (plan.backfill === 'full') {
			await this.pullSince(undefined);
		} else if (plan.backfill === 'fetch') {
			const cards = await this.fetchCards(plan.missingIds);
			if (cards.length) await this.db.cards.bulkPut(cards);
		}
		await this.db.meta.put({ key: RECONCILED_KEY, value: new Date().toISOString() });
		return plan.removeIds.length;
	}

	/**
	 * Run a reconcile only if one is due. Called on app start and on a timer, so
	 * it must stay cheap when it decides to do nothing: the due check reads one
	 * meta row and makes no request.
	 */
	async maybeReconcile(now = Date.now()): Promise<number | null> {
		if (!isReconcileDue(await this.getReconciledAt(), now)) return null;
		return this.reconcile();
	}

	/**
	 * Drop the local mirror and re-pull it from scratch. The escape hatch for a
	 * mirror that has drifted in a way a reconcile cannot express (corrupt rows,
	 * a cursor from a since-rebuilt server).
	 *
	 * Refuses to run while the outbox holds unpushed work UNLESS that work can be
	 * flushed first: clearing `cards` alongside a queued mutation would leave the
	 * mutation referencing a card that no longer exists locally, and dropping the
	 * outbox would silently destroy offline edits. Draining first is the only
	 * option that loses nothing, and if the drain fails the rebuild aborts with
	 * the mirror untouched.
	 */
	async rebuild(): Promise<number> {
		if ((await this.db.outbox.count()) > 0) {
			// `flush` throws if it cannot push, and no-ops if one is already in
			// flight — so re-check rather than assume the queue drained.
			await this.flush();
			if ((await this.db.outbox.count()) > 0) {
				throw new Error('Unsynced changes are still queued. Try again once they have synced.');
			}
		}
		await this.db.transaction('rw', this.db.cards, this.db.meta, async () => {
			await this.db.cards.clear();
			await this.db.meta.delete(CURSOR_KEY);
			await this.db.meta.delete(RECONCILED_KEY);
		});
		// The full live set, re-anchoring the cursor — the same path the reconcile's
		// `full` backfill takes.
		await this.pullSince(undefined);
		// The mirror is freshly authoritative, so the reconcile clock starts now.
		await this.db.meta.put({ key: RECONCILED_KEY, value: new Date().toISOString() });
		return this.db.cards.count();
	}

	/** Queue a mutation and apply it optimistically to the local card. */
	async enqueue(mutation: Mutation): Promise<void> {
		await this.db.transaction('rw', this.db.cards, this.db.outbox, async () => {
			await this.db.outbox.add({ mutation, createdAt: new Date().toISOString() });
			const card = await this.db.cards.get(mutation.id);
			const next = applyMutation(card, mutation);
			if (next) await this.db.cards.put(next);
			else if (card) await this.db.cards.delete(mutation.id);
		});
	}

	/**
	 * Drain the outbox via a single push. On success the pushed entries are
	 * removed; on repeated failure the outbox is left intact (after exhausting
	 * retries) so a later flush can try again. Re-entrant calls are no-ops.
	 */
	async flush(): Promise<SyncPushResponse | null> {
		if (this.flushing) return null;
		this.flushing = true;
		this.activityListener?.({ flushing: this.flushing, failed: this.failed });
		try {
			const entries = await this.db.outbox.orderBy('id').toArray();
			if (entries.length === 0) return null;
			const mutations = entries.map((e) => e.mutation);
			let attempt = 0;
			for (;;) {
				try {
					const res = await this.client.syncPush({ mutations });
					await this.db.outbox.bulkDelete(entries.map((e) => e.id));
					this.failed = false;
					return res;
				} catch (err) {
					attempt += 1;
					if (attempt >= this.maxRetries) {
						this.failed = true;
						throw err;
					}
					await this.sleep(this.backoff(attempt));
				}
			}
		} finally {
			this.flushing = false;
			this.activityListener?.({ flushing: this.flushing, failed: this.failed });
		}
	}

	/** Begin listening for connectivity changes; flushes immediately if online. */
	start(): void {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.onlineHandler = () => void this.flush();
		window.addEventListener('online', this.onlineHandler);
		if (isOnline()) void this.flush();
	}

	stop(): void {
		if (this.onlineHandler && typeof window !== 'undefined') {
			window.removeEventListener('online', this.onlineHandler);
		}
		this.onlineHandler = undefined;
		this.started = false;
	}
}

let engine: SyncEngine | undefined;

/** App-wide engine bound to the Dexie singleton and the configured client. */
export function getSync(): SyncEngine {
	if (!engine) engine = new SyncEngine({ db, client: getClient() });
	return engine;
}
