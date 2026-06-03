import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Card, type Mutation, type SyncPushRequest, type SyncPushResponse } from '@lectern/shared';
import { LecternDB } from './db';
import { applyMutation, SyncEngine, type SyncClient } from './sync';

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

	async syncPull(query?: { since?: string }) {
		this.lastSince = query?.since;
		return this.pull;
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
