import { LecternApiError } from '@lectern/api-client';
import { db, type QueueItem } from './db';
import { getClient } from './config';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/**
 * The "Listen" player + queue. A single shared instance drives the bottom
 * mini-player and the queue manager. Hard rules honoured here:
 *  - Synthesis fires ONLY from an explicit play (listen / playIndex / autoplay
 *    of the next track once the current ends). `enqueue` never synthesizes.
 *  - Audio is cached in Dexie per document so re-listens and queue replays are
 *    instant + offline and never re-bill ElevenLabs.
 *  - The queue + playback position persist to Dexie across reloads.
 */
class TtsPlayer {
	queue = $state<QueueItem[]>([]);
	index = $state(-1);
	status = $state<PlayerStatus>('idle');
	error = $state<string | undefined>(undefined);
	currentTime = $state(0);
	duration = $state(0);

	private audio: HTMLAudioElement | null = null;
	private objectUrl: string | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private restored = false;
	/** Monotonic token so a slow load can't clobber a newer one. */
	private loadToken = 0;

	get current(): QueueItem | undefined {
		return this.queue[this.index];
	}
	get currentId(): string | undefined {
		return this.current?.id;
	}

	/** Restore the persisted queue (paused) and wire the audio element. Browser-only. */
	init(): void {
		if (this.restored || typeof window === 'undefined') return;
		this.restored = true;
		this.ensureAudio();
		void db.ttsState.get('state').then((s) => {
			if (!s) return;
			this.queue = s.queue;
			this.index = s.index < s.queue.length ? s.index : -1;
		});
	}

	private ensureAudio(): HTMLAudioElement {
		if (this.audio) return this.audio;
		const a = new Audio();
		a.addEventListener('timeupdate', () => {
			this.currentTime = a.currentTime;
			this.persistSoon();
		});
		a.addEventListener('loadedmetadata', () => {
			this.duration = Number.isFinite(a.duration) ? a.duration : 0;
		});
		a.addEventListener('play', () => {
			this.status = 'playing';
		});
		a.addEventListener('pause', () => {
			if (this.status === 'playing') this.status = 'paused';
		});
		a.addEventListener('ended', () => {
			void this.next();
		});
		a.addEventListener('error', () => {
			if (this.status === 'loading' || this.status === 'playing') {
				this.status = 'error';
				this.error = 'Playback failed.';
			}
		});
		this.audio = a;
		return a;
	}

	/** Play a document now: add it if absent, jump to it, synthesize + play. */
	async listen(item: QueueItem): Promise<void> {
		this.init();
		let i = this.queue.findIndex((q) => q.id === item.id);
		if (i < 0) {
			this.queue = [...this.queue, item];
			i = this.queue.length - 1;
		}
		await this.playIndex(i);
	}

	/** Add to the end of the queue WITHOUT synthesizing (no prefetch / warming). */
	enqueue(item: QueueItem): void {
		this.init();
		if (this.queue.some((q) => q.id === item.id)) return;
		this.queue = [...this.queue, item];
		if (this.index < 0) this.index = this.queue.length - 1;
		this.persistSoon();
	}

	async playIndex(i: number): Promise<void> {
		if (i < 0 || i >= this.queue.length) return;
		const item = this.queue[i]!;
		this.index = i;
		this.status = 'loading';
		this.error = undefined;
		this.currentTime = 0;
		this.duration = 0;
		const token = ++this.loadToken;
		try {
			const blob = await this.loadAudio(item.id);
			if (token !== this.loadToken) return; // superseded by a newer play
			const a = this.ensureAudio();
			if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = URL.createObjectURL(blob);
			a.src = this.objectUrl;
			await a.play();
			this.persistSoon();
		} catch (err) {
			if (token !== this.loadToken) return;
			this.status = 'error';
			this.error =
				err instanceof LecternApiError && err.status === 409
					? 'Add your ElevenLabs API key in Settings to listen.'
					: err instanceof Error
						? err.message
						: 'Could not load audio.';
		}
	}

	/** Audio bytes for a doc: Dexie cache first (instant/offline), else synth once. */
	private async loadAudio(id: string): Promise<Blob> {
		const cached = await db.audio.get(id);
		if (cached) return cached.blob;
		const { bytes, mime, contentHash } = await getClient().synthesizeAudio(id);
		const blob = new Blob([bytes], { type: mime });
		await db.audio.put({ id, contentHash, mime, blob, createdAt: new Date().toISOString() });
		return blob;
	}

	togglePlay(): void {
		const a = this.audio;
		if (this.status === 'playing') {
			a?.pause();
		} else if (a?.src) {
			void a.play();
		} else if (this.index >= 0) {
			void this.playIndex(this.index);
		}
	}

	async next(): Promise<void> {
		if (this.index + 1 < this.queue.length) await this.playIndex(this.index + 1);
		else this.status = this.queue.length ? 'paused' : 'idle';
	}

	async prev(): Promise<void> {
		// Restart the current track if we're more than a few seconds in.
		if (this.audio && this.audio.currentTime > 3) {
			this.seek(0);
			return;
		}
		if (this.index > 0) await this.playIndex(this.index - 1);
	}

	seek(t: number): void {
		if (this.audio) this.audio.currentTime = t;
		this.currentTime = t;
	}

	remove(i: number): void {
		if (i < 0 || i >= this.queue.length) return;
		const removingCurrent = i === this.index;
		const currentId = this.currentId;
		this.queue = this.queue.filter((_, idx) => idx !== i);
		if (removingCurrent) {
			this.stopAudio();
			this.status = 'idle';
			this.currentTime = 0;
			this.duration = 0;
			this.index = this.queue.length ? Math.min(i, this.queue.length - 1) : -1;
		} else {
			this.index = currentId ? this.queue.findIndex((q) => q.id === currentId) : -1;
		}
		this.persistSoon();
	}

	move(from: number, to: number): void {
		if (from === to || from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length)
			return;
		const currentId = this.currentId;
		const next = [...this.queue];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item!);
		this.queue = next;
		if (currentId) this.index = next.findIndex((q) => q.id === currentId);
		this.persistSoon();
	}

	clear(): void {
		this.stopAudio();
		this.queue = [];
		this.index = -1;
		this.status = 'idle';
		this.currentTime = 0;
		this.duration = 0;
		this.persistSoon();
	}

	private stopAudio(): void {
		if (this.audio) {
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
		}
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}

	private persistSoon(): void {
		if (typeof window === 'undefined') return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			void db.ttsState.put({
				id: 'state',
				queue: this.queue,
				index: this.index,
				position: this.currentTime
			});
		}, 500);
	}
}

export const ttsPlayer = new TtsPlayer();
