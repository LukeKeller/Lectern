import { liveQuery } from 'dexie';
import { db } from '$lib/db';
import { getSync } from '$lib/sync';

/**
 * Ambient sync state for the sidebar foot. A singleton rune store, wired to the
 * rune-free {@link SyncEngine} via `setActivityListener` so the engine never
 * imports a `.svelte.ts` module (keeping its node tests rune-free).
 */
class SyncStatus {
	online = $state(true);
	pending = $state(0);
	flushing = $state(false);
	failed = $state(false);
	private started = false;

	/** Idempotent, SSR-safe wiring of engine activity, outbox count, connectivity. */
	start(): void {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;

		getSync().setActivityListener((s) => {
			this.flushing = s.flushing;
			this.failed = s.failed;
		});

		liveQuery(() => db.outbox.count()).subscribe((n) => (this.pending = n));

		this.online = navigator.onLine;
		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
	}
}

export const syncStatus = new SyncStatus();
