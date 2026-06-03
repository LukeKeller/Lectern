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

/**
 * Local mirror of the user's library. `cards` mirrors the unified `Card` shape;
 * `meta` holds the sync cursor; `outbox` queues mutations made while offline.
 */
export class LecternDB extends Dexie {
	cards!: EntityTable<Card, 'id'>;
	meta!: EntityTable<MetaEntry, 'key'>;
	outbox!: EntityTable<OutboxEntry, 'id'>;

	constructor(name = 'lectern') {
		super(name);
		this.version(1).stores({
			cards: 'id, location, updatedAt',
			meta: 'key',
			outbox: '++id'
		});
	}
}

export const db = new LecternDB();
