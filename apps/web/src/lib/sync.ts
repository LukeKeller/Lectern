import type {
	Card,
	Mutation,
	SyncPullResponse,
	SyncPushRequest,
	SyncPushResponse
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

/** Minimal surface of the API client the engine depends on. */
export interface SyncClient {
	syncPull(query?: { since?: string; pageSize?: number }): Promise<SyncPullResponse>;
	syncPush(body: SyncPushRequest): Promise<SyncPushResponse>;
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
		case 'setReadingProgress':
			return {
				...card,
				readingProgress: mutation.readingProgress,
				readAnchor: mutation.readAnchor,
				updatedAt
			};
		case 'setTags':
			return { ...card, tags: mutation.tags, updatedAt };
		case 'setNote':
			return { ...card, note: mutation.note, updatedAt };
		case 'addHighlight':
			return { ...card, highlightCount: card.highlightCount + 1, updatedAt };
		case 'removeHighlight':
			return { ...card, highlightCount: Math.max(0, card.highlightCount - 1), updatedAt };
		case 'delete':
			return undefined;
	}
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
	private started = false;
	private onlineHandler?: () => void;

	constructor(opts: SyncEngineOptions) {
		this.db = opts.db;
		this.client = opts.client;
		this.maxRetries = opts.maxRetries ?? 5;
		this.backoff = opts.backoff ?? backoffDelay;
		this.sleep = opts.sleep ?? defaultSleep;
	}

	/** The persisted sync cursor, or `undefined` before the first pull. */
	async getCursor(): Promise<string | undefined> {
		const row = await this.db.meta.get(CURSOR_KEY);
		return row?.value;
	}

	/** Pull deltas since the stored cursor and merge them into the local mirror. */
	async pull(): Promise<void> {
		const since = await this.getCursor();
		const res = await this.client.syncPull(since ? { since } : {});
		await this.db.transaction('rw', this.db.cards, this.db.meta, async () => {
			if (res.cards.length) await this.db.cards.bulkPut(res.cards);
			if (res.deletedIds.length) await this.db.cards.bulkDelete(res.deletedIds);
			await this.db.meta.put({ key: CURSOR_KEY, value: res.cursor });
		});
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
		try {
			const entries = await this.db.outbox.orderBy('id').toArray();
			if (entries.length === 0) return null;
			const mutations = entries.map((e) => e.mutation);
			let attempt = 0;
			for (;;) {
				try {
					const res = await this.client.syncPush({ mutations });
					await this.db.outbox.bulkDelete(entries.map((e) => e.id));
					return res;
				} catch (err) {
					attempt += 1;
					if (attempt >= this.maxRetries) throw err;
					await this.sleep(this.backoff(attempt));
				}
			}
		} finally {
			this.flushing = false;
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
