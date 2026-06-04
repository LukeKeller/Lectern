import Dexie, { type EntityTable } from 'dexie';
import type { Card, Mutation } from '@lectern/shared';

/** A queued mutation awaiting push to the BFF. */
export interface OutboxEntry {
	id: number;
	mutation: Mutation;
	createdAt: string;
}

/** Key/value row, used for the sync cursor. */
export interface MetaEntry {
	key: string;
	value: string;
}

/** A cached synthesized audio blob, keyed by document id (offline re-listens). */
export interface AudioEntry {
	id: string;
	contentHash: string;
	mime: string;
	blob: Blob;
	createdAt: string;
}

/** One queued "Listen" item (id + title kept for the queue UI without a lookup). */
export interface QueueItem {
	id: string;
	title: string;
}

/** Persisted Listen-player state (singleton row, id === 'state'). */
export interface PlayerStateEntry {
	id: 'state';
	queue: QueueItem[];
	index: number;
	position: number;
}

/**
 * Local mirror of the user's library. `cards` mirrors the unified `Card` shape;
 * `meta` holds the sync cursor; `outbox` queues mutations made while offline;
 * `audio` caches synthesized read-aloud blobs; `ttsState` persists the Listen
 * queue + playback position so it survives reloads and works offline.
 */
export class LecternDB extends Dexie {
	cards!: EntityTable<Card, 'id'>;
	meta!: EntityTable<MetaEntry, 'key'>;
	outbox!: EntityTable<OutboxEntry, 'id'>;
	audio!: EntityTable<AudioEntry, 'id'>;
	ttsState!: EntityTable<PlayerStateEntry, 'id'>;

	constructor(name = 'lectern') {
		super(name);
		this.version(1).stores({
			cards: 'id, location, updatedAt',
			meta: 'key',
			outbox: '++id'
		});
		this.version(2).stores({
			cards: 'id, location, updatedAt',
			meta: 'key',
			outbox: '++id',
			audio: 'id',
			ttsState: 'id'
		});
	}
}

export const db = new LecternDB();
