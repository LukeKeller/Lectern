import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Card, type SyncPushRequest, type SyncPushResponse } from '@lectern/shared';
import { LecternDB } from './db';
import { SyncEngine, type SyncClient } from './sync';
import { childSelector, computePercent, nearestAnchor } from './progress';

/**
 * Integration of the reader's persistence loop over the real Dexie mirror: the
 * reader computes a percent + anchor (pure math, tested in progress.test.ts),
 * enqueues a `setReadingProgress` mutation, and on reopen reads the card back.
 * This verifies that the captured position survives a round-trip through the DB
 * exactly as the reader would restore it — no DOM or network involved.
 */

class StubClient implements SyncClient {
	async syncPull() {
		return { cards: [], deletedIds: [], cursor: '0' };
	}
	async syncPush(body: SyncPushRequest): Promise<SyncPushResponse> {
		return { applied: body.mutations.length, conflicts: [] };
	}
	async syncManifest() {
		return { ids: [], count: 0 };
	}
	async getDocument(id: string): Promise<Card> {
		throw new Error(`unexpected fetch of ${id}`);
	}
}

function makeCard(): Card {
	return Card.parse({
		id: 'article_1',
		source: 'readeck',
		sourceId: 'r1',
		category: 'article',
		location: 'later',
		title: 'A long read',
		url: 'https://example.com/long',
		savedAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z'
	});
}

let db: LecternDB;
let engine: SyncEngine;
let dbName = 0;

beforeEach(async () => {
	db = new LecternDB(`reader-test-${dbName++}`);
	engine = new SyncEngine({ db, client: new StubClient() });
	await db.cards.put(makeCard());
});

afterEach(async () => {
	await db.delete();
});

describe('reading-progress capture + restore', () => {
	it('persists the computed percent and anchor to the card', async () => {
		// Simulate a scroll roughly two-thirds down a 3000px article in a 1000px window.
		const anchors = [
			{ selector: childSelector(0), top: 0 },
			{ selector: childSelector(1), top: 800 },
			{ selector: childSelector(2), top: 1600 }
		];
		const scrollTop = 1200;
		const percent = computePercent(scrollTop, 3000, 1000);
		const anchor = nearestAnchor(anchors, scrollTop);

		await engine.enqueue({
			type: 'setReadingProgress',
			id: 'article_1',
			readingProgress: percent,
			readAnchor: anchor
		});

		// What the reader reads on reopen:
		const restored = await db.cards.get('article_1');
		expect(restored?.readingProgress).toBeCloseTo(0.6, 5);
		expect(restored?.readAnchor).toBe(childSelector(1));
	});

	it('marks the card finished when scrolled to the end', async () => {
		const percent = computePercent(2000, 3000, 1000);
		await engine.enqueue({
			type: 'setReadingProgress',
			id: 'article_1',
			readingProgress: percent,
			readAnchor: childSelector(2)
		});
		const restored = await db.cards.get('article_1');
		expect(restored?.readingProgress).toBe(1);
	});

	it('queues the mutation in the outbox for sync', async () => {
		await engine.enqueue({
			type: 'setReadingProgress',
			id: 'article_1',
			readingProgress: 0.5,
			readAnchor: null
		});
		const queued = await db.outbox.toArray();
		expect(queued).toHaveLength(1);
		expect(queued[0]!.mutation.type).toBe('setReadingProgress');
	});
});
