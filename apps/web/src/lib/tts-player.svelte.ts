import type { TtsVoice } from '@lectern/shared';
import { LecternApiError } from '@lectern/api-client';
import { db, type QueueItem } from './db';
import { getClient } from './config';
import { voiceOptions } from './tts-voices';

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
	/** Current ElevenLabs voice + model (mirrors the server settings). */
	voiceId = $state('');
	modelId = $state('eleven_flash_v2_5');
	accountVoices = $state<TtsVoice[]>([]);
	/** Playback speed multiplier (0.75–2). */
	rate = $state(1);
	/** Voice id currently being previewed (drives the preview spinner), if any. */
	previewVoiceId = $state<string | undefined>(undefined);

	private audio: HTMLAudioElement | null = null;
	private objectUrl: string | null = null;
	private previewEl: HTMLAudioElement | null = null;
	private previewUrl: string | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private serverTimer: ReturnType<typeof setTimeout> | undefined;
	private restored = false;
	/** Position (s) to resume the restored track at, applied on its first play. */
	private resumeAt = 0;
	private restoreIndex = -1;
	/** Monotonic token so a slow load can't clobber a newer one. */
	private loadToken = 0;

	get current(): QueueItem | undefined {
		return this.queue[this.index];
	}
	get currentId(): string | undefined {
		return this.current?.id;
	}
	get hasQueue(): boolean {
		return this.queue.length > 0;
	}
	/** Built-in voices merged with any account voices, current always present. */
	get voices(): TtsVoice[] {
		return voiceOptions(this.accountVoices, this.voiceId);
	}

	init(): void {
		if (this.restored || typeof window === 'undefined') return;
		this.restored = true;
		this.ensureAudio();
		void this.restore();
		void this.loadSettings();
	}

	/**
	 * Restore the queue + position (paused). Server state wins when it has a queue
	 * (so you can pause on one device and resume on another); otherwise fall back
	 * to the local Dexie copy (offline + instant). Never auto-plays.
	 */
	private async restore(): Promise<void> {
		const local = await db.ttsState.get('state').catch(() => undefined);
		let state = local
			? { queue: local.queue, index: local.index, position: local.position, rate: local.rate ?? 1 }
			: null;
		try {
			const server = await getClient().getPlayerState();
			if (server.queue.length > 0) state = server;
		} catch {
			/* offline: keep the local copy */
		}
		if (!state) return;
		this.queue = state.queue;
		this.index = state.index >= 0 && state.index < state.queue.length ? state.index : -1;
		if (state.rate) this.rate = state.rate;
		this.resumeAt = state.position ?? 0;
		this.restoreIndex = this.index;
		this.currentTime = this.resumeAt;
	}

	/** Pull the configured voice + model so the player's selector reflects them. */
	async loadSettings(): Promise<void> {
		try {
			const s = await getClient().getTtsSettings();
			this.voiceId = s.voiceId;
			this.modelId = s.modelId;
		} catch {
			/* offline: keep defaults; the selector still shows built-in voices */
		}
		try {
			// Best-effort: surfaces the user's own voices when the key can list them.
			this.accountVoices = (await getClient().listTtsVoices()).voices;
		} catch {
			/* key lacks the Voices permission — built-in voices remain available */
		}
	}

	/** Change the voice for future synthesis (persisted server-side). */
	async setVoice(voiceId: string): Promise<void> {
		if (voiceId === this.voiceId) return;
		this.voiceId = voiceId;
		try {
			await getClient().updateTtsSettings({ voiceId });
		} catch {
			/* offline: the change applies on the next successful sync */
		}
	}

	/** Set playback speed; applies live and persists. */
	setRate(rate: number): void {
		this.rate = rate;
		if (this.audio) this.audio.playbackRate = rate;
		this.persistSoon();
	}

	/**
	 * Play a short spoken sample of a voice so the user can audition it. Uses a
	 * separate audio element (the main queue stays put, just paused) and the
	 * server's cached preview snippet, so repeat auditions don't re-bill.
	 */
	async previewVoice(voiceId: string): Promise<void> {
		if (typeof window === 'undefined') return;
		this.audio?.pause();
		if (!this.previewEl) {
			this.previewEl = new Audio();
			const done = () => {
				this.previewVoiceId = undefined;
			};
			this.previewEl.addEventListener('ended', done);
			this.previewEl.addEventListener('error', done);
		}
		this.previewVoiceId = voiceId;
		try {
			const { bytes, mime } = await getClient().previewVoiceAudio(voiceId);
			if (this.previewVoiceId !== voiceId) return; // superseded by another preview
			if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
			this.previewUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
			this.previewEl.src = this.previewUrl;
			this.previewEl.playbackRate = 1;
			await this.previewEl.play();
		} catch {
			this.previewVoiceId = undefined;
		}
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
			// Persist promptly so another device can pick up where this one paused.
			void this.saveServer();
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

	/** Replace the queue with a list (e.g. a whole magazine issue) and play it
	 * from the top. Each item is synthesized individually as it becomes current. */
	async playAll(items: QueueItem[]): Promise<void> {
		this.init();
		if (items.length === 0) return;
		this.queue = [...items];
		await this.playIndex(0);
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
		// One-shot resume: only the restored track at the restored position seeks.
		const resume = i === this.restoreIndex && this.resumeAt > 0 ? this.resumeAt : 0;
		this.resumeAt = 0;
		this.index = i;
		this.status = 'loading';
		this.error = undefined;
		this.currentTime = 0;
		this.duration = 0;
		const token = ++this.loadToken;
		try {
			const blob = await this.loadAudio(item);
			if (token !== this.loadToken) return; // superseded by a newer play
			const a = this.ensureAudio();
			if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = URL.createObjectURL(blob);
			a.src = this.objectUrl;
			a.playbackRate = this.rate;
			await a.play();
			if (resume > 0) {
				try {
					a.currentTime = resume;
					this.currentTime = resume;
				} catch {
					/* seek may fail before metadata; harmless */
				}
			}
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

	/**
	 * Audio bytes for a doc: Dexie cache first (instant/offline), else synthesize
	 * once. A cache entry is only reused when it was produced with the current
	 * voice + model, so changing the voice re-synthesizes (the server still
	 * content-hash-caches, so this never re-bills for a voice used before).
	 */
	private async loadAudio(item: QueueItem): Promise<Blob> {
		const cached = await db.audio.get(item.id);
		const fresh =
			cached &&
			(!this.voiceId || cached.voiceId === this.voiceId) &&
			(cached.modelId ?? this.modelId) === this.modelId;
		if (cached && fresh) return cached.blob;
		// Pass the title so the article announces itself; the server bakes it into
		// the cached per-article audio (reused from the card/reader too).
		const { bytes, mime, contentHash } = await getClient().synthesizeAudio(item.id, item.title);
		const blob = new Blob([bytes], { type: mime });
		await db.audio.put({
			id: item.id,
			contentHash,
			mime,
			blob,
			voiceId: this.voiceId,
			modelId: this.modelId,
			createdAt: new Date().toISOString()
		});
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
		void this.saveServer();
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
				position: this.currentTime,
				rate: this.rate
			});
		}, 500);
		// Sync to the server on a longer debounce so other devices/refreshes can
		// resume; pause/stop flush immediately via saveServer().
		if (this.serverTimer) clearTimeout(this.serverTimer);
		this.serverTimer = setTimeout(() => void this.saveServer(), 3000);
	}

	/** Push the current state to the server now (cross-device resume). */
	private async saveServer(): Promise<void> {
		if (typeof window === 'undefined') return;
		if (this.serverTimer) {
			clearTimeout(this.serverTimer);
			this.serverTimer = undefined;
		}
		try {
			await getClient().savePlayerState({
				queue: this.queue,
				index: this.index,
				position: this.currentTime,
				rate: this.rate,
				updatedAt: null
			});
		} catch {
			/* offline: local Dexie copy still holds the state */
		}
	}
}

export const ttsPlayer = new TtsPlayer();
