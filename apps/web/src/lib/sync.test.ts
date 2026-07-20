import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Card, type Mutation, type SyncPushRequest, type SyncPushResponse } from '@lectern/shared';
import { LecternDB } from './db';
import {
	applyMutation,
	isReconcileDue,
	planReconcile,
	RECONCILE_INTERVAL_MS,
	SyncEngine,
	type SyncClient
} from './sync';

function makeCard(overrides: Partial<Card> = {}): Card {
	return Card.parse({
		id: 'c1',
		source: 'readeck',
		sourceId: 's1',
		category: 'article',
		location: 'inbox',
		title: 'Title',
		url: 'https://example.com/a',
		savedAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	});
}

/** A scriptable stand-in for LecternClient exposing only the sync methods. */
class FakeClient implements SyncClient {
	pull: { cards: Card[]; deletedIds: string[]; cursor: string } = {
		cards: [],
		deletedIds: [],
		cursor: '0'
	};
	lastSince: string | undefined;
	pushCalls = 0;
	pushedMutations: Mutation[][] = [];
	failPushes = 0;
	manifest: { ids: string[]; count: number } = { ids: [], count: 0 };
	manifestCalls = 0;
	failManifest = false;
	pullCalls = 0;
	/** Server-side cards addressable by id, for the reconcile backfill. */
	documents = new Map<string, Card>();
	getDocumentCalls: string[] = [];

	async syncPull(query?: { since?: string }) {
		this.pullCalls += 1;
		this.lastSince = query?.since;
		return this.pull;
	}

	async getDocument(id: string): Promise<Card> {
		this.getDocumentCalls.push(id);
		const card = this.documents.get(id);
		if (!card) throw new Error(`no such document: ${id}`);
		return card;
	}

	async syncManifest() {
		this.manifestCalls += 1;
		if (this.failManifest) throw new Error('manifest unreachable');
		return this.manifest;
	}

	async syncPush(body: SyncPushRequest): Promise<SyncPushResponse> {
		this.pushCalls += 1;
		this.pushedMutations.push(body.mutations);
		if (this.failPushes > 0) {
			this.failPushes -= 1;
			throw new Error('network down');
		}
		return { applied: body.mutations.length, conflicts: [] };
	}
}

let db: LecternDB;
let client: FakeClient;
let engine: SyncEngine;
let dbName = 0;

beforeEach(() => {
	db = new LecternDB(`test-${dbName++}`);
	client = new FakeClient();
	engine = new SyncEngine({ db, client, maxRetries: 4, backoff: () => 0, sleep: async () => {} });
});

afterEach(async () => {
	await db.delete();
});

describe('applyMutation (pure)', () => {
	it('returns undefined for a delete', () => {
		expect(applyMutation(makeCard(), { type: 'delete', id: 'c1' })).toBeUndefined();
	});

	it('returns undefined when the card is absent', () => {
		expect(
			applyMutation(undefined, { type: 'setLocation', id: 'c1', location: 'later' })
		).toBeUndefined();
	});

	it('sets a new location without mutating the input', () => {
		const card = makeCard();
		const next = applyMutation(card, { type: 'setLocation', id: 'c1', location: 'archive' });
		expect(next?.location).toBe('archive');
		expect(card.location).toBe('inbox');
	});

	it('bumps highlightCount on addHighlight', () => {
		const card = makeCard({ highlightCount: 2 });
		const next = applyMutation(card, {
			type: 'addHighlight',
			id: 'c1',
			text: 't',
			color: 'yellow',
			note: null,
			startSelector: 'a',
			startOffset: 0,
			endSelector: 'b',
			endOffset: 1
		});
		expect(next?.highlightCount).toBe(3);
	});
});

describe('enqueue', () => {
	it('appends to the outbox and applies optimistically', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });

		expect(await db.outbox.count()).toBe(1);
		const queued = await db.outbox.toArray();
		expect(queued[0]!.mutation).toEqual({ type: 'setLocation', id: 'c1', location: 'later' });
		expect((await db.cards.get('c1'))!.location).toBe('later');
	});

	it('queues a delete and removes the local card', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'delete', id: 'c1' });

		expect(await db.cards.get('c1')).toBeUndefined();
		expect(await db.outbox.count()).toBe(1);
	});
});

describe('flush', () => {
	it('pushes queued mutations and clears the outbox on success', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });

		const res = await engine.flush();

		expect(res?.applied).toBe(1);
		expect(client.pushCalls).toBe(1);
		expect(client.pushedMutations[0]).toEqual([
			{ type: 'setLocation', id: 'c1', location: 'later' }
		]);
		expect(await db.outbox.count()).toBe(0);
	});

	it('is a no-op with an empty outbox', async () => {
		const res = await engine.flush();
		expect(res).toBeNull();
		expect(client.pushCalls).toBe(0);
	});

	it('retries on failure then succeeds, clearing the outbox', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });
		client.failPushes = 2;

		const res = await engine.flush();

		expect(res?.applied).toBe(1);
		expect(client.pushCalls).toBe(3);
		expect(await db.outbox.count()).toBe(0);
	});

	it('leaves the outbox intact when retries are exhausted', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });
		client.failPushes = 99;

		await expect(engine.flush()).rejects.toThrow('network down');
		expect(client.pushCalls).toBe(4);
		expect(await db.outbox.count()).toBe(1);
	});
});

describe('activity reporting', () => {
	it('emits flushing transitions around a successful push', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });
		const events: { flushing: boolean; failed: boolean }[] = [];
		engine.setActivityListener((s) => events.push({ ...s }));

		await engine.flush();

		expect(events[0]).toEqual({ flushing: true, failed: false });
		expect(events.at(-1)).toEqual({ flushing: false, failed: false });
	});

	it('reports failed when retries are exhausted, then clears it on a later success', async () => {
		await db.cards.put(makeCard());
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });
		client.failPushes = 99;
		const events: { flushing: boolean; failed: boolean }[] = [];
		engine.setActivityListener((s) => events.push({ ...s }));

		await expect(engine.flush()).rejects.toThrow('network down');
		expect(events.at(-1)).toEqual({ flushing: false, failed: true });

		// The outbox is left intact; a later flush that connects clears the failure.
		client.failPushes = 0;
		events.length = 0;
		await engine.flush();
		expect(events.at(-1)).toEqual({ flushing: false, failed: false });
		expect(await db.outbox.count()).toBe(0);
	});
});

describe('planReconcile (pure)', () => {
	const complete = (ids: string[]) => ({ ids, count: ids.length });

	it('removes local ids absent from the authoritative set', () => {
		const plan = planReconcile({
			localIds: ['a', 'b', 'gone'],
			authoritative: complete(['a', 'b']),
			pendingIds: []
		});
		expect(plan).toEqual({ removeIds: ['gone'], missingIds: [], backfill: 'none' });
	});

	it('protects a card with a pending outbox mutation', () => {
		const plan = planReconcile({
			localIds: ['a', 'pending'],
			authoritative: complete(['a']),
			pendingIds: ['pending']
		});
		expect(plan).toEqual({ removeIds: [], missingIds: [], backfill: 'none' });
	});

	it('removes nothing when the authoritative set is truncated', () => {
		// Server said 500 ids, we only received 2 — the absences prove nothing.
		expect(
			planReconcile({
				localIds: ['a', 'b', 'c'],
				authoritative: { ids: ['a', 'b'], count: 500 },
				pendingIds: []
			})
		).toBeNull();
	});

	it('removes nothing local when the server set is a superset, and backfills the rest', () => {
		const plan = planReconcile({
			localIds: ['a'],
			authoritative: complete(['a', 'b', 'c']),
			pendingIds: []
		});
		expect(plan).toEqual({ removeIds: [], missingIds: ['b', 'c'], backfill: 'fetch' });
	});

	it('empties the mirror only when the server genuinely reports an empty library', () => {
		const plan = planReconcile({
			localIds: ['a', 'b'],
			authoritative: complete([]),
			pendingIds: []
		});
		expect(plan).toEqual({ removeIds: ['a', 'b'], missingIds: [], backfill: 'none' });
	});

	it('fetches by id when only a small share of the library is missing', () => {
		const ids = Array.from({ length: 100 }, (_, i) => `c${i}`);
		const plan = planReconcile({
			localIds: ids.slice(0, 98),
			authoritative: complete(ids),
			pendingIds: []
		});
		expect(plan?.backfill).toBe('fetch');
		expect(plan?.missingIds).toEqual(['c98', 'c99']);
	});

	it('falls back to a full pull once too large a share is missing', () => {
		const ids = Array.from({ length: 100 }, (_, i) => `c${i}`);
		const plan = planReconcile({
			localIds: ids.slice(0, 70),
			authoritative: complete(ids),
			pendingIds: []
		});
		expect(plan?.backfill).toBe('full');
		expect(plan?.missingIds).toHaveLength(30);
	});

	it('falls back to a full pull past the absolute batch cap, however large the library', () => {
		const ids = Array.from({ length: 10_000 }, (_, i) => `c${i}`);
		const plan = planReconcile({
			// 51 missing is a rounding error against 10k, but still too many to fetch
			// one request at a time.
			localIds: ids.slice(0, ids.length - 51),
			authoritative: complete(ids),
			pendingIds: []
		});
		expect(plan?.backfill).toBe('full');
	});

	it('never backfills a card whose delete is still queued in the outbox', () => {
		// The card is gone locally (optimistic delete) but the server has not seen
		// the mutation yet, so it is still in the manifest. Fetching it would undo
		// the user's delete on every reconcile until the push lands.
		const plan = planReconcile({
			localIds: ['a'],
			authoritative: complete(['a', 'deleted-offline']),
			pendingIds: ['deleted-offline']
		});
		expect(plan).toEqual({ removeIds: [], missingIds: [], backfill: 'none' });
	});
});

describe('isReconcileDue (pure)', () => {
	const now = Date.parse('2026-07-19T12:00:00Z');

	it('is due when no reconcile has ever run', () => {
		expect(isReconcileDue(undefined, now)).toBe(true);
	});

	it('is not due inside the interval', () => {
		const recent = new Date(now - RECONCILE_INTERVAL_MS + 60_000).toISOString();
		expect(isReconcileDue(recent, now)).toBe(false);
	});

	it('is due once the interval has elapsed', () => {
		const old = new Date(now - RECONCILE_INTERVAL_MS).toISOString();
		expect(isReconcileDue(old, now)).toBe(true);
	});

	it('is due for an unparseable or future marker rather than wedging', () => {
		expect(isReconcileDue('not-a-date', now)).toBe(true);
		expect(isReconcileDue(new Date(now + 86_400_000).toISOString(), now)).toBe(true);
	});
});

describe('reconcile', () => {
	it('drops local cards the server no longer has', async () => {
		await db.cards.bulkPut([makeCard({ id: 'keep' }), makeCard({ id: 'hard-deleted' })]);
		client.manifest = { ids: ['keep'], count: 1 };

		const removed = await engine.reconcile();

		expect(removed).toBe(1);
		expect(await db.cards.get('hard-deleted')).toBeUndefined();
		expect(await db.cards.get('keep')).toBeDefined();
	});

	it('keeps a card whose mutation is still queued in the outbox', async () => {
		await db.cards.bulkPut([makeCard({ id: 'keep' }), makeCard({ id: 'unsynced' })]);
		await engine.enqueue({ type: 'setLocation', id: 'unsynced', location: 'later' });
		// The server has not seen the mutation, so it is absent from the manifest.
		client.manifest = { ids: ['keep'], count: 1 };

		const removed = await engine.reconcile();

		expect(removed).toBe(0);
		expect(await db.cards.get('unsynced')).toBeDefined();
	});

	it('removes nothing and stays due when the fetch fails', async () => {
		await db.cards.bulkPut([makeCard({ id: 'a' }), makeCard({ id: 'b' })]);
		client.failManifest = true;

		await expect(engine.reconcile()).rejects.toThrow('manifest unreachable');

		expect(await db.cards.count()).toBe(2);
		expect(await engine.getReconciledAt()).toBeUndefined();
	});

	it('removes nothing and stays due on a truncated response', async () => {
		await db.cards.bulkPut([makeCard({ id: 'a' }), makeCard({ id: 'b' })]);
		client.manifest = { ids: ['a'], count: 900 };

		expect(await engine.reconcile()).toBeNull();
		expect(await db.cards.count()).toBe(2);
		expect(await engine.getReconciledAt()).toBeUndefined();
	});

	// The other half of the production incident: the client had lost 160 of 164
	// cards to a bad sync cursor, and a prune-only reconcile reported success
	// forever while the mirror stayed short.
	it('fetches ids present in the manifest but missing locally', async () => {
		await db.cards.put(makeCard({ id: 'have' }));
		client.manifest = { ids: ['have', 'lost1', 'lost2'], count: 3 };
		client.documents.set('lost1', makeCard({ id: 'lost1' }));
		client.documents.set('lost2', makeCard({ id: 'lost2' }));

		await engine.reconcile();

		expect(await db.cards.get('lost1')).toBeDefined();
		expect(await db.cards.get('lost2')).toBeDefined();
		expect(await db.cards.get('have')).toBeDefined();
	});

	it('re-pulls the whole set instead of N lookups when most of the mirror is gone', async () => {
		const ids = Array.from({ length: 164 }, (_, i) => `n${i}`);
		await db.cards.bulkPut(ids.slice(0, 4).map((id) => makeCard({ id })));
		client.manifest = { ids, count: ids.length };
		client.pull = { cards: ids.map((id) => makeCard({ id })), deletedIds: [], cursor: 'fresh' };

		await engine.reconcile();

		// One cursor-less pull, not 160 by-id requests.
		expect(client.getDocumentCalls).toEqual([]);
		expect(client.pullCalls).toBe(1);
		expect(client.lastSince).toBeUndefined();
		expect(await db.cards.count()).toBe(164);
		expect(await engine.getCursor()).toBe('fresh');
	});

	it('prunes and backfills in the same run', async () => {
		await db.cards.bulkPut([makeCard({ id: 'keep' }), makeCard({ id: 'hard-deleted' })]);
		client.manifest = { ids: ['keep', 'lost'], count: 2 };
		client.documents.set('lost', makeCard({ id: 'lost' }));

		const removed = await engine.reconcile();

		expect(removed).toBe(1);
		expect(await db.cards.get('hard-deleted')).toBeUndefined();
		expect(await db.cards.get('lost')).toBeDefined();
	});

	it('keeps the rest of the backfill when one lookup fails', async () => {
		client.manifest = { ids: ['ok', 'vanished'], count: 2 };
		client.documents.set('ok', makeCard({ id: 'ok' }));
		// `vanished` is in the manifest but 404s — deleted between the two requests.

		await engine.reconcile();

		expect(await db.cards.get('ok')).toBeDefined();
		expect(await db.cards.get('vanished')).toBeUndefined();
	});

	it('does not resurrect a card whose delete is still queued', async () => {
		await db.cards.put(makeCard({ id: 'doomed' }));
		await engine.enqueue({ type: 'delete', id: 'doomed' });
		// The server has not applied the delete yet, so it is still in the manifest.
		client.manifest = { ids: ['doomed'], count: 1 };
		client.documents.set('doomed', makeCard({ id: 'doomed' }));

		await engine.reconcile();

		expect(client.getDocumentCalls).toEqual([]);
		expect(await db.cards.get('doomed')).toBeUndefined();
	});

	it('records the run so the next check is not due', async () => {
		client.manifest = { ids: [], count: 0 };
		await engine.reconcile();
		expect(await engine.getReconciledAt()).toBeTypeOf('string');
	});
});

describe('maybeReconcile', () => {
	it('runs when never reconciled, then not again inside the interval', async () => {
		await db.cards.put(makeCard({ id: 'stale' }));
		client.manifest = { ids: [], count: 0 };

		expect(await engine.maybeReconcile()).toBe(1);
		expect(client.manifestCalls).toBe(1);

		// A second call moments later must not hit the network again.
		expect(await engine.maybeReconcile()).toBeNull();
		expect(client.manifestCalls).toBe(1);
	});

	it('runs again once the interval has elapsed', async () => {
		client.manifest = { ids: [], count: 0 };
		await engine.maybeReconcile();
		expect(client.manifestCalls).toBe(1);

		await engine.maybeReconcile(Date.now() + RECONCILE_INTERVAL_MS + 1000);
		expect(client.manifestCalls).toBe(2);
	});
});

describe('rebuild', () => {
	it('clears the mirror and cursor, then repopulates from a full pull', async () => {
		await db.cards.bulkPut([makeCard({ id: 'stale1' }), makeCard({ id: 'stale2' })]);
		await db.meta.put({ key: 'cursor', value: 'old-cursor' });
		client.pull = {
			cards: [makeCard({ id: 'fresh1' }), makeCard({ id: 'fresh2' })],
			deletedIds: [],
			cursor: 'new-cursor'
		};

		const count = await engine.rebuild();

		expect(count).toBe(2);
		// The stale local rows are gone even though no tombstone ever named them.
		expect(await db.cards.get('stale1')).toBeUndefined();
		expect(await db.cards.get('fresh1')).toBeDefined();
		// The pull ran from scratch, not from the stale cursor.
		expect(client.lastSince).toBeUndefined();
		expect(await engine.getCursor()).toBe('new-cursor');
	});

	it('pushes queued work before clearing anything', async () => {
		await db.cards.put(makeCard({ id: 'c1' }));
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });
		client.pull = { cards: [makeCard({ id: 'c1' })], deletedIds: [], cursor: '1' };

		await engine.rebuild();

		expect(client.pushCalls).toBe(1);
		expect(await db.outbox.count()).toBe(0);
	});

	it('aborts without touching the mirror when queued work cannot be pushed', async () => {
		await db.cards.put(makeCard({ id: 'c1' }));
		await engine.enqueue({ type: 'setLocation', id: 'c1', location: 'later' });
		client.failPushes = 99;

		await expect(engine.rebuild()).rejects.toThrow('network down');

		// Nothing was dropped: the card, the queued mutation and the cursor survive.
		expect(await db.cards.get('c1')).toBeDefined();
		expect(await db.outbox.count()).toBe(1);
	});
});

describe('pull', () => {
	it('upserts cards, deletes ids, and advances the cursor', async () => {
		await db.cards.put(makeCard({ id: 'old', location: 'inbox' }));
		client.pull = {
			cards: [makeCard({ id: 'c1', location: 'feed' }), makeCard({ id: 'c2', location: 'inbox' })],
			deletedIds: ['old'],
			cursor: '42'
		};

		await engine.pull();

		expect(await db.cards.get('old')).toBeUndefined();
		expect((await db.cards.get('c1'))!.location).toBe('feed');
		expect(await db.cards.count()).toBe(2);
		expect(await engine.getCursor()).toBe('42');
	});

	it('sends the stored cursor as `since` on the next pull', async () => {
		client.pull = { cards: [], deletedIds: [], cursor: '7' };
		await engine.pull();
		expect(client.lastSince).toBeUndefined();

		await engine.pull();
		expect(client.lastSince).toBe('7');
	});
});
