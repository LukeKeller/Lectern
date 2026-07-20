<script lang="ts">
	import type {
		EmailSender,
		ImportReadwiseResponse,
		SourceThemeSummary,
		TtsProvider,
		TtsUsage,
		TtsVoice,
		UpdateDiscoverySettingsRequest
	} from '@lectern/shared';
	import { onMount } from 'svelte';
	import { getApiUrl, getClient, getToken, setToken } from '$lib/config';
	import { getSync } from '$lib/sync';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { appSettings, LANDING_VIEWS } from '$lib/app-settings.svelte';
	import {
		FONT_LABELS,
		FONT_STACKS,
		THEME_SWATCHES,
		WIDTH_PRESETS,
		type FontFamily,
		type ReaderTheme,
		type ThemeMode
	} from '$lib/typography';
	import { buildBookmarklet } from '$lib/bookmarklet';
	import { APP_VERSION } from '$lib/version';
	import { resolve } from '$app/paths';
	import { DEFAULT_VOICE, voiceOptions } from '$lib/tts-voices';
	import { ttsPlayer } from '$lib/tts-player.svelte';
	import { disablePush, enablePush, getPermission, isPushSupported, isSubscribed } from '$lib/push';
	import { browser } from '$app/environment';

	let token = $state('');
	let saved = $state(false);
	let copied = $state(false);
	const apiUrl = getApiUrl();

	// Built for the deployed app's own origin so it opens Lectern's authenticated
	// share-target tab. Guarded for SSR, where `location` is unavailable.
	const bookmarklet = $derived(buildBookmarklet(browser ? location.origin : ''));

	let importing = $state(false);
	let importResult = $state<ImportReadwiseResponse | undefined>(undefined);
	let importError = $state<string | undefined>(undefined);

	// ---- Sync (force reconcile) ----
	let syncing = $state(false);
	let syncResult = $state<string | undefined>(undefined);
	let syncError = $state<string | undefined>(undefined);

	// ---- Clean up (delete all read feed + newsletter items) ----
	let cleaning = $state(false);
	let cleanResult = $state<string | undefined>(undefined);
	let cleanError = $state<string | undefined>(undefined);

	// Delete every read item — finished feed articles and finished newsletter
	// issues — at the source (so the poll can't re-add them), then pull the
	// tombstones so this device drops them too. Irreversible, hence the confirm.
	async function deleteAllRead() {
		if (cleaning) return;
		if (
			!confirm(
				'Delete all read items? Every finished feed article and newsletter issue is removed from its source. This cannot be undone.'
			)
		) {
			return;
		}
		cleaning = true;
		cleanResult = undefined;
		cleanError = undefined;
		try {
			const { deleted } = await getClient().bulkDelete('read-all');
			cleanResult = `Deleted ${deleted} item${deleted === 1 ? '' : 's'}`;
			if (deleted > 0) await getSync().pull();
		} catch (err) {
			cleanError = err instanceof Error ? err.message : 'Delete failed.';
		} finally {
			cleaning = false;
		}
	}

	// Force a server-side reconcile, then pull the resulting deltas so this device
	// reflects the indexed/removed items.
	async function forceSync() {
		if (syncing) return;
		syncing = true;
		syncResult = undefined;
		syncError = undefined;
		try {
			const res = await getClient().forceSync();
			const indexed = res.miniflux + res.readeck + res.email;
			syncResult = `Indexed ${indexed} new, removed ${res.tombstoned}`;
			await getSync().pull();
		} catch (err) {
			syncError = err instanceof Error ? err.message : 'Sync failed.';
		} finally {
			syncing = false;
		}
	}

	// ---- Sync (rebuild the local mirror) ----
	let rebuilding = $state(false);
	let rebuildResult = $state<string | undefined>(undefined);
	let rebuildError = $state<string | undefined>(undefined);

	// Drop this device's local copy of the library and re-download it. The fix for
	// a mirror that has drifted from the server: pulls are additive, so a stale
	// local card can otherwise linger indefinitely. Nothing server-side is touched,
	// so this is safe — but it re-downloads everything, hence the confirm.
	async function rebuildLibrary() {
		if (rebuilding) return;
		if (
			!confirm(
				'Rebuild this device’s local library? Your saved items, tags and highlights are not affected — this only clears the offline copy on this device and downloads it again. It may take a moment.'
			)
		) {
			return;
		}
		rebuilding = true;
		rebuildResult = undefined;
		rebuildError = undefined;
		try {
			const count = await getSync().rebuild();
			rebuildResult = `Rebuilt — ${count} item${count === 1 ? '' : 's'}`;
		} catch (err) {
			rebuildError = err instanceof Error ? err.message : 'Rebuild failed.';
		} finally {
			rebuilding = false;
		}
	}

	async function copyBookmarklet() {
		await navigator.clipboard.writeText(bookmarklet);
		copied = true;
	}

	const THEMES = (Object.keys(THEME_SWATCHES) as ThemeMode[]).map((value) => ({
		value,
		...THEME_SWATCHES[value]
	}));
	const FONTS = (Object.keys(FONT_LABELS) as FontFamily[]).map((value) => ({
		value,
		...FONT_LABELS[value],
		stack: FONT_STACKS[value]
	}));
	const READER_THEMES: { value: ReaderTheme; label: string }[] = [
		{ value: 'match', label: 'Match app' },
		{ value: 'light', label: 'Paper' },
		{ value: 'sepia', label: 'Sepia' },
		{ value: 'newsprint', label: 'Newsprint' },
		{ value: 'eink', label: 'E-ink' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'black', label: 'Black' },
		{ value: 'contrast', label: 'Contrast' }
	];

	// ---- Listen (text-to-speech) ----
	const TTS_PROVIDERS: { value: TtsProvider; label: string }[] = [
		{ value: 'elevenlabs', label: 'ElevenLabs — hosted, needs an API key' },
		{ value: 'kokoro', label: 'Kokoro — free, self-hosted on your server' },
		{ value: 'piper', label: 'Piper — free, self-hosted, lightweight' }
	];
	const TTS_MODELS = [
		{ value: 'eleven_flash_v2_5', label: 'Flash v2.5 — fast, affordable (default)' },
		{ value: 'eleven_multilingual_v2', label: 'Multilingual v2 — highest quality' }
	];
	let ttsProvider = $state<TtsProvider>('elevenlabs');
	let ttsConfigured = $state(false);
	let ttsModel = $state('eleven_flash_v2_5');
	let ttsVoiceId = $state('');
	let ttsKey = $state('');
	let accountVoices = $state<TtsVoice[]>([]);
	let ttsVoicesNote = $state<string | undefined>(undefined);
	const voiceList = $derived(voiceOptions(accountVoices, ttsVoiceId, ttsProvider));
	let ttsBusy = $state(false);
	let ttsMsg = $state<string | undefined>(undefined);
	let ttsError = $state<string | undefined>(undefined);
	let ttsUsage = $state<TtsUsage | undefined>(undefined);
	const usagePct = $derived(
		ttsUsage && ttsUsage.characterLimit > 0
			? Math.min(100, Math.round((ttsUsage.characterCount / ttsUsage.characterLimit) * 100))
			: 0
	);
	const usageRemaining = $derived(
		ttsUsage ? Math.max(0, ttsUsage.characterLimit - ttsUsage.characterCount) : 0
	);

	// ---- Podcast feed ----
	let podcastFeedUrl = $state('');
	let podcastEpisodeCount = $state(0);
	let podcastBusy = $state(false);
	let podcastCopied = $state(false);
	let podcastError = $state<string | undefined>(undefined);

	// ---- Discover (content discovery) ----
	// Candidates and runs are worker/BFF state, not library documents, so this
	// talks to the client directly. Fields are held locally and saved as one patch;
	// the Brave key is write-only (we only learn whether one is configured).
	let discEnabled = $state(false);
	let discTopics = $state('');
	let discSeedUrls = $state('');
	let discSearxng = $state(true);
	let discBrave = $state(false);
	let discCrawl = $state(false);
	let discSearxngUrl = $state('');
	let discBraveConfigured = $state(false);
	let discBraveKey = $state('');
	let discCrawlDepth = $state(1);
	let discCrawlTimeMs = $state(30000);
	let discSchedule = $state('0 */6 * * *');
	let discRocchioA = $state(1);
	let discRocchioB = $state(0.75);
	let discRocchioC = $state(0.25);
	let discTarget = $state(5);
	let discFreshness = $state(14);
	let discFullText = $state(true);
	let discFullTextCandidates = $state(12);
	let discMutedDomains = $state<string[]>([]);
	let discMutedInput = $state('');
	let discBusy = $state(false);
	let discMsg = $state<string | undefined>(undefined);
	let discError = $state<string | undefined>(undefined);
	let reseedBusy = $state(false);
	let reseedMsg = $state<string | undefined>(undefined);
	let reseedError = $state<string | undefined>(undefined);

	async function loadDiscovery() {
		try {
			const s = await getClient().getDiscoverySettings();
			discEnabled = s.enabled;
			discTopics = s.topics.join(', ');
			discSeedUrls = s.seedUrls.join('\n');
			discSearxng = s.fetchers.searxng;
			discBrave = s.fetchers.brave;
			discCrawl = s.fetchers.crawl;
			discSearxngUrl = s.searxngUrl;
			discBraveConfigured = s.braveConfigured;
			discCrawlDepth = s.crawlDepth;
			discCrawlTimeMs = s.crawlTimeMs;
			discSchedule = s.schedule;
			discRocchioA = s.rocchio.a;
			discRocchioB = s.rocchio.b;
			discRocchioC = s.rocchio.c;
			discTarget = s.targetCount;
			discFreshness = s.freshnessHalfLifeDays;
			discFullText = s.fullText;
			discFullTextCandidates = s.fullTextCandidates;
			discMutedDomains = s.mutedDomains;
		} catch {
			/* offline or discovery not configured: leave defaults */
		}
	}

	async function saveDiscovery(event: SubmitEvent) {
		event.preventDefault();
		if (discBusy) return;
		discBusy = true;
		discMsg = undefined;
		discError = undefined;
		const patch: UpdateDiscoverySettingsRequest = {
			enabled: discEnabled,
			topics: discTopics
				.split(/[\n,]/)
				.map((t) => t.trim())
				.filter(Boolean),
			seedUrls: discSeedUrls
				.split('\n')
				.map((u) => u.trim())
				.filter(Boolean),
			fetchers: { searxng: discSearxng, brave: discBrave, crawl: discCrawl },
			schedule: discSchedule.trim(),
			searxngUrl: discSearxngUrl.trim(),
			crawlDepth: discCrawlDepth,
			crawlTimeMs: discCrawlTimeMs,
			rocchio: { a: discRocchioA, b: discRocchioB, c: discRocchioC },
			targetCount: discTarget,
			freshnessHalfLifeDays: discFreshness,
			fullText: discFullText,
			fullTextCandidates: discFullTextCandidates,
			mutedDomains: discMutedDomains
		};
		// Only send the Brave key when the user typed one; empty = leave unchanged.
		if (discBraveKey.trim()) patch.braveApiKey = discBraveKey.trim();
		try {
			const s = await getClient().updateDiscoverySettings(patch);
			discBraveConfigured = s.braveConfigured;
			discBraveKey = '';
			discMsg = 'Discovery settings saved.';
		} catch (err) {
			discError = err instanceof Error ? err.message : 'Could not save discovery settings.';
		} finally {
			discBusy = false;
		}
	}

	// Muted-domain chips are edited locally and saved with the rest of the form.
	// Normalize the input to a bare host (drop scheme, `www.`, and any path).
	function addMutedDomain() {
		const host = discMutedInput
			.trim()
			.replace(/^https?:\/\//i, '')
			.replace(/^www\./i, '')
			.replace(/\/.*$/, '')
			.toLowerCase();
		if (!host) return;
		if (!discMutedDomains.some((d) => d.toLowerCase() === host)) {
			discMutedDomains = [...discMutedDomains, host];
		}
		discMutedInput = '';
	}
	function removeMutedDomain(host: string) {
		discMutedDomains = discMutedDomains.filter((d) => d !== host);
	}

	async function reseedProfile() {
		if (reseedBusy) return;
		if (
			!confirm(
				'Rebuild the interest profile from your current library? This replaces the model the next run scores against.'
			)
		) {
			return;
		}
		reseedBusy = true;
		reseedMsg = undefined;
		reseedError = undefined;
		try {
			await getClient().reseedDiscoveryProfile();
			reseedMsg = 'Profile rebuilt from your library.';
		} catch (err) {
			reseedError = err instanceof Error ? err.message : 'Could not rebuild the profile.';
		} finally {
			reseedBusy = false;
		}
	}

	// ---- Newsletter ignore list ----
	let emailIgnore = $state<string[]>([]);
	let emailKnown = $state<EmailSender[]>([]);
	let emailInput = $state('');
	let emailBusy = $state(false);
	let emailMsg = $state<string | undefined>(undefined);
	let emailError = $state<string | undefined>(undefined);
	// Senders in the library that aren't already ignored — the one-tap add list.
	const emailKnownAvailable = $derived(
		emailKnown.filter((k) => !emailIgnore.some((s) => s.toLowerCase() === k.name.toLowerCase()))
	);

	async function loadEmailIgnore() {
		try {
			const s = await getClient().getEmailIgnore();
			emailIgnore = s.senders;
			emailKnown = s.known;
		} catch {
			/* offline or newsletter ingestion not configured: leave the section empty */
		}
	}

	async function addEmailIgnore(sender: string) {
		const name = sender.trim();
		if (!name || emailBusy) return;
		emailBusy = true;
		emailError = undefined;
		emailMsg = undefined;
		try {
			const s = await getClient().addEmailIgnore(name);
			emailIgnore = s.senders;
			emailKnown = s.known;
			emailInput = '';
			emailMsg =
				s.removed > 0
					? `Ignoring “${name}”. Removed ${s.removed} saved email${s.removed === 1 ? '' : 's'}.`
					: `Ignoring “${name}”.`;
			// Existing emails were deleted server-side; pull so they leave this device too.
			if (s.removed > 0) await getSync().pull();
		} catch (err) {
			emailError = err instanceof Error ? err.message : 'Could not update the ignore list.';
		} finally {
			emailBusy = false;
		}
	}

	async function removeEmailIgnore(sender: string) {
		if (emailBusy) return;
		emailBusy = true;
		emailError = undefined;
		emailMsg = undefined;
		try {
			const s = await getClient().removeEmailIgnore(sender);
			emailIgnore = s.senders;
			emailKnown = s.known;
		} catch (err) {
			emailError = err instanceof Error ? err.message : 'Could not update the ignore list.';
		} finally {
			emailBusy = false;
		}
	}

	// ---- Cached source themes ("dress") ----
	// What Lectern has parsed and saved per publication (one per host). Loaded on
	// first expand; "Clear cache" drops them all so any host that cached a failed
	// or empty result gets re-fetched on the next open.
	let sourcesOpen = $state(false);
	let sourceThemes = $state<SourceThemeSummary[]>([]);
	let sourcesLoaded = $state(false);
	let sourcesBusy = $state(false);
	let sourcesError = $state<string | undefined>(undefined);

	async function loadSourceThemes() {
		sourcesBusy = true;
		sourcesError = undefined;
		try {
			sourceThemes = (await getClient().listSourceThemes()).themes;
			sourcesLoaded = true;
		} catch {
			sourcesError = 'Could not load cached sources.';
		} finally {
			sourcesBusy = false;
		}
	}

	function toggleSources() {
		sourcesOpen = !sourcesOpen;
		if (sourcesOpen && !sourcesLoaded) void loadSourceThemes();
	}

	async function clearSourceThemes() {
		if (sourcesBusy) return;
		sourcesBusy = true;
		sourcesError = undefined;
		try {
			await getClient().clearSourceThemes();
			sourceThemes = [];
			await loadSourceThemes();
		} catch {
			sourcesError = 'Could not clear the cache.';
		} finally {
			sourcesBusy = false;
		}
	}

	// Compact "fetched N ago" label for the cached-sources rows.
	function relativeTime(iso: string): string {
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return '';
		const secs = Math.round((Date.now() - then) / 1000);
		if (secs < 60) return 'just now';
		const mins = Math.round(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.round(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.round(hrs / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.round(days / 30);
		if (months < 12) return `${months}mo ago`;
		return `${Math.round(months / 12)}y ago`;
	}

	// ---- Notifications (Web Push) ----
	const pushSupported = isPushSupported();
	let pushOn = $state(false);
	let pushBusy = $state(false);
	let pushError = $state<string | undefined>(undefined);
	let pushDenied = $state(false);

	onMount(() => {
		token = getToken() ?? '';
		void loadTts();
		void loadPodcast();
		void loadPush();
		void loadEmailIgnore();
		void loadDiscovery();
	});

	async function loadPush() {
		if (!pushSupported) return;
		pushDenied = getPermission() === 'denied';
		try {
			pushOn = await isSubscribed();
		} catch {
			/* registration not ready (e.g. dev): treat as off */
		}
	}

	async function togglePush() {
		if (pushBusy) return;
		pushBusy = true;
		pushError = undefined;
		try {
			if (pushOn) {
				await disablePush();
				pushOn = false;
			} else {
				const ok = await enablePush();
				pushOn = ok;
				if (!ok) {
					pushDenied = getPermission() === 'denied';
					pushError = pushDenied
						? 'Notifications are blocked. Enable them for this site in your browser settings.'
						: 'Push isn’t available — the server may not have notifications configured.';
				}
			}
		} catch (err) {
			pushError = err instanceof Error ? err.message : 'Could not change notification settings.';
		} finally {
			pushBusy = false;
		}
	}

	async function loadPodcast() {
		try {
			const s = await getClient().getPodcastSettings();
			podcastFeedUrl = s.feedUrl;
			podcastEpisodeCount = s.episodeCount;
		} catch {
			/* offline or not configured: leave the feed section empty */
		}
	}

	async function copyPodcastUrl() {
		try {
			await navigator.clipboard.writeText(podcastFeedUrl);
			podcastCopied = true;
			setTimeout(() => (podcastCopied = false), 2000);
		} catch {
			podcastError = 'Could not copy — select and copy the URL manually.';
		}
	}

	async function regeneratePodcast() {
		if (podcastBusy) return;
		if (
			!confirm(
				'Generate a new feed URL? Podcast apps subscribed to the current URL will stop updating.'
			)
		)
			return;
		podcastBusy = true;
		podcastError = undefined;
		try {
			const s = await getClient().regeneratePodcastFeed();
			podcastFeedUrl = s.feedUrl;
			podcastEpisodeCount = s.episodeCount;
		} catch (err) {
			podcastError = err instanceof Error ? err.message : 'Failed to regenerate the feed URL.';
		} finally {
			podcastBusy = false;
		}
	}

	async function loadTts() {
		try {
			const s = await getClient().getTtsSettings();
			ttsProvider = s.provider;
			ttsConfigured = s.configured;
			ttsModel = s.modelId;
			ttsVoiceId = s.voiceId;
		} catch {
			/* offline: keep defaults */
		}
		try {
			// Surface the provider's voices (ElevenLabs account voices, or the Kokoro
			// service's voice list) when reachable.
			accountVoices = (await getClient().listTtsVoices()).voices;
		} catch {
			/* unavailable — built-in voices remain available */
		}
		await loadTtsUsage();
	}

	/** Switch provider: persist it, reset the voice to that provider's default
	 * when the current one belongs to the other provider, then reload voices/usage. */
	async function saveTtsProvider(provider: TtsProvider) {
		if (provider === ttsProvider) return;
		ttsProvider = provider;
		ttsError = undefined;
		ttsMsg = undefined;
		accountVoices = [];
		// Swap to the provider's default voice when the current id doesn't belong to
		// the new provider's built-in set. (Can't sniff by shape — e.g. both Kokoro
		// and Piper ids contain underscores — so check membership instead.)
		const patch: { provider: TtsProvider; voiceId?: string } = { provider };
		const belongsToNewProvider = voiceOptions([], '', provider).some((v) => v.id === ttsVoiceId);
		if (ttsVoiceId && !belongsToNewProvider) patch.voiceId = DEFAULT_VOICE[provider];
		try {
			const s = await getClient().updateTtsSettings(patch);
			ttsConfigured = s.configured;
			ttsVoiceId = s.voiceId;
		} catch (err) {
			ttsError = err instanceof Error ? err.message : 'Failed to switch provider.';
		}
		await loadTts();
	}

	async function loadTtsUsage() {
		// Usage/quota is an ElevenLabs concept; Kokoro and Piper are self-hosted with none.
		if (ttsProvider !== 'elevenlabs' || !ttsConfigured) {
			ttsUsage = undefined;
			return;
		}
		try {
			ttsUsage = await getClient().getTtsUsage();
		} catch {
			/* offline, or the key lacks the user-read permission: hide the panel */
			ttsUsage = undefined;
		}
	}

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	function formatResetDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	async function saveTtsKey(event: SubmitEvent) {
		event.preventDefault();
		ttsBusy = true;
		ttsError = undefined;
		ttsMsg = undefined;
		try {
			const s = await getClient().updateTtsSettings({ apiKey: ttsKey.trim() || null });
			ttsConfigured = s.configured;
			ttsKey = '';
			ttsMsg = s.configured ? 'API key saved.' : 'API key cleared.';
			await loadTtsUsage();
		} catch (err) {
			ttsError = err instanceof Error ? err.message : 'Failed to save the key.';
		} finally {
			ttsBusy = false;
		}
	}

	async function saveTtsModel(modelId: string) {
		ttsModel = modelId;
		try {
			await getClient().updateTtsSettings({ modelId });
		} catch (err) {
			ttsError = err instanceof Error ? err.message : 'Failed to save the model.';
		}
	}

	async function saveTtsVoice(voiceId: string) {
		ttsVoiceId = voiceId;
		try {
			await getClient().updateTtsSettings({ voiceId });
		} catch (err) {
			ttsError = err instanceof Error ? err.message : 'Failed to save the voice.';
		}
	}

	async function loadVoices() {
		ttsBusy = true;
		ttsError = undefined;
		ttsVoicesNote = undefined;
		// Kokoro and Piper are self-hosted services; ElevenLabs lists account voices.
		const selfHostedName =
			ttsProvider === 'kokoro' ? 'Kokoro' : ttsProvider === 'piper' ? 'Piper' : undefined;
		try {
			accountVoices = (await getClient().listTtsVoices()).voices;
			ttsVoicesNote = accountVoices.length
				? undefined
				: selfHostedName
					? `No voices returned — check that the ${selfHostedName} server is running and reachable. Built-in voices are available below.`
					: 'No account voices returned — your key may lack the Voices permission. Built-in voices are available below.';
		} catch (err) {
			ttsError =
				err instanceof Error
					? err.message
					: selfHostedName
						? `Could not load voices (is the ${selfHostedName} server running?).`
						: 'Could not load voices (check the key).';
		} finally {
			ttsBusy = false;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		setToken(token.trim());
		saved = true;
	}

	// Read a Readwise Reader CSV export and import it, then refresh the mirror so
	// the imported documents appear in the lists immediately.
	async function importReadwise(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		importError = undefined;
		importResult = undefined;
		try {
			const csv = await file.text();
			importResult = await getClient().importReadwise({ csv });
			await getSync().pull();
		} catch (err) {
			importError = err instanceof Error ? err.message : 'Import failed.';
		} finally {
			importing = false;
			input.value = '';
		}
	}
</script>

<div class="page">
	<h1>Settings</h1>

	<section>
		<h2>Account</h2>
		<form class="stack" onsubmit={save}>
			<label>
				<span>API URL</span>
				<input type="text" value={apiUrl} readonly />
			</label>
			<label>
				<span>Bearer token</span>
				<input type="password" bind:value={token} placeholder="paste token" autocomplete="off" />
			</label>
			<div class="row">
				<button type="submit" class="btn">Save token</button>
				{#if saved}<span class="ok">Saved.</span>{/if}
			</div>
		</form>
	</section>

	<section>
		<h2>Import library</h2>
		<p class="hint">
			Import a Readwise Reader CSV export. Your documents, locations, and tags are added to your
			library.
		</p>
		<div class="row">
			<label class="file-btn" class:busy={importing}>
				{importing ? 'Importing…' : 'Choose CSV file'}
				<input type="file" accept=".csv,text/csv" onchange={importReadwise} disabled={importing} />
			</label>
		</div>
		{#if importResult}
			<dl class="summary">
				<div>
					<dt>Total</dt>
					<dd>{importResult.total}</dd>
				</div>
				<div>
					<dt>Imported</dt>
					<dd class="ok">{importResult.imported}</dd>
				</div>
				<div>
					<dt>Failed</dt>
					<dd class:err={importResult.failed > 0}>{importResult.failed}</dd>
				</div>
			</dl>
		{/if}
		{#if importError}<p class="err">{importError}</p>{/if}
	</section>

	<section>
		<h2>Save bookmarklet</h2>
		<p class="hint">
			Drag this link to your bookmarks bar to save the current page to Lectern. Clicking it opens a
			Lectern tab that saves the page using your existing session — no token is embedded, so it's
			safe to keep on your bookmarks bar or share.
		</p>
		<div class="row">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="bm-link" href={bookmarklet} draggable="true" onclick={(e) => e.preventDefault()}>
				Save to Lectern
			</a>
			<button type="button" class="btn" onclick={copyBookmarklet}>Copy</button>
			{#if copied}<span class="ok">Copied.</span>{/if}
		</div>
	</section>

	<section>
		<h2>Navigation</h2>
		<div class="field">
			<span class="flabel">Default view</span>
			<select
				class="picker"
				value={appSettings.current.defaultView}
				onchange={(e) => appSettings.update({ defaultView: e.currentTarget.value })}
			>
				{#each LANDING_VIEWS as v (v.id)}
					<option value={v.id}>{v.label}</option>
				{/each}
			</select>
			<span class="fhint">The screen Lectern opens to when you launch it.</span>
		</div>
	</section>

	<section>
		<h2>Reading</h2>
		<div class="stack">
			<div class="field">
				<span class="flabel">Theme</span>
				<div class="swatches">
					{#each THEMES as t (t.value)}
						<button
							type="button"
							class="swatch"
							class:active={readerSettings.current.theme === t.value}
							style={`--sw-bg:${t.bg};--sw-fg:${t.fg}`}
							onclick={() => readerSettings.update({ theme: t.value })}
							aria-pressed={readerSettings.current.theme === t.value}
						>
							<span class="chip" aria-hidden="true">Aa</span>
							<span class="sw-label">{t.label}</span>
						</button>
					{/each}
				</div>
			</div>
			<div class="field">
				<span class="flabel">Reader theme</span>
				<select
					class="picker"
					value={readerSettings.current.readerTheme}
					onchange={(e) =>
						readerSettings.update({ readerTheme: e.currentTarget.value as ReaderTheme })}
				>
					{#each READER_THEMES as r (r.value)}
						<option value={r.value}>{r.label}</option>
					{/each}
				</select>
				<span class="fhint">Theme the article view independently of the app chrome.</span>
			</div>
			<div class="field">
				<span class="flabel">Typeface</span>
				<div class="fonts">
					{#each FONTS as f (f.value)}
						<button
							type="button"
							class="fontcard"
							class:active={readerSettings.current.fontFamily === f.value}
							onclick={() => readerSettings.update({ fontFamily: f.value })}
							aria-pressed={readerSettings.current.fontFamily === f.value}
						>
							<span class="fontsample" style={`font-family:${f.stack}`}>Ag</span>
							<span class="fontmeta">
								<span class="fontname">{f.label}</span>
								<span class="fontnote">{f.note}</span>
							</span>
						</button>
					{/each}
				</div>
			</div>
			<label class="slider">
				<span>Text size <em>{readerSettings.current.fontSize}px</em></span>
				<input
					type="range"
					min="12"
					max="28"
					value={readerSettings.current.fontSize}
					oninput={(e) => readerSettings.update({ fontSize: Number(e.currentTarget.value) })}
				/>
			</label>
			<label class="slider">
				<span>Line height <em>{readerSettings.current.lineHeight}</em></span>
				<input
					type="range"
					min="1.2"
					max="2.2"
					step="0.1"
					value={readerSettings.current.lineHeight}
					oninput={(e) => readerSettings.update({ lineHeight: Number(e.currentTarget.value) })}
				/>
			</label>
			<div class="field">
				<span class="flabel"
					>Width <em class="flabel-val">{readerSettings.current.maxWidth}px</em></span
				>
				<div class="seg">
					{#each WIDTH_PRESETS as p (p.value)}
						<button
							type="button"
							class:active={readerSettings.current.maxWidth === p.value}
							onclick={() => readerSettings.update({ maxWidth: p.value })}
						>
							{p.label}
						</button>
					{/each}
				</div>
				<input
					type="range"
					min="480"
					max="760"
					step="20"
					value={readerSettings.current.maxWidth}
					oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
				/>
			</div>
			<label class="slider">
				<span>Letter spacing <em>{readerSettings.current.letterSpacing.toFixed(2)}em</em></span>
				<input
					type="range"
					min="-0.05"
					max="0.15"
					step="0.01"
					value={readerSettings.current.letterSpacing}
					oninput={(e) => readerSettings.update({ letterSpacing: Number(e.currentTarget.value) })}
				/>
			</label>
			<label class="slider">
				<span>Word spacing <em>{readerSettings.current.wordSpacing.toFixed(2)}em</em></span>
				<input
					type="range"
					min="0"
					max="0.5"
					step="0.02"
					value={readerSettings.current.wordSpacing}
					oninput={(e) => readerSettings.update({ wordSpacing: Number(e.currentTarget.value) })}
				/>
			</label>
			<label class="slider">
				<span
					>Paragraph spacing <em>{readerSettings.current.paragraphSpacing.toFixed(1)}em</em></span
				>
				<input
					type="range"
					min="0.4"
					max="2.4"
					step="0.1"
					value={readerSettings.current.paragraphSpacing}
					oninput={(e) =>
						readerSettings.update({ paragraphSpacing: Number(e.currentTarget.value) })}
				/>
			</label>
			<div class="field">
				<span class="flabel">Paragraph style</span>
				<div class="seg">
					<button
						type="button"
						class:active={readerSettings.current.paragraphStyle === 'spaced'}
						onclick={() => readerSettings.update({ paragraphStyle: 'spaced' })}
					>
						Spaced
					</button>
					<button
						type="button"
						class:active={readerSettings.current.paragraphStyle === 'indented'}
						onclick={() => readerSettings.update({ paragraphStyle: 'indented' })}
					>
						Indented
					</button>
				</div>
				<span class="fhint"
					>Spaced paragraphs (web convention) or first-line indents (book convention).</span
				>
			</div>
			<label class="toggle">
				<input
					type="checkbox"
					checked={readerSettings.current.adaptiveAccent}
					onchange={(e) => readerSettings.update({ adaptiveAccent: e.currentTarget.checked })}
				/>
				<span>
					Adaptive accent
					<em>Tint each article’s links and accents with a colour drawn from its cover image.</em>
				</span>
			</label>
			<div class="field">
				<span class="flabel">Source dress</span>
				<div class="seg">
					<button
						type="button"
						class:active={readerSettings.current.sourceTheme === 'off'}
						onclick={() => readerSettings.update({ sourceTheme: 'off' })}
					>
						Off
					</button>
					<button
						type="button"
						class:active={readerSettings.current.sourceTheme === 'accent'}
						onclick={() => readerSettings.update({ sourceTheme: 'accent' })}
					>
						Accent
					</button>
					<button
						type="button"
						class:active={readerSettings.current.sourceTheme === 'full'}
						onclick={() => readerSettings.update({ sourceTheme: 'full' })}
					>
						Full
					</button>
				</div>
				<span class="fhint"
					><strong>Accent</strong> wears each publication’s brand colour and a favicon masthead —
					chrome only. <strong>Full</strong> re-skins the whole reading view after the publication: its
					background, body font, headings, and links, all kept inside Lectern’s readability guardrails.
					Your reading column’s width and text size stay yours either way. Takes priority over Adaptive
					accent.</span
				>
			</div>
			<div class="field">
				<button type="button" class="disclose" aria-expanded={sourcesOpen} onclick={toggleSources}>
					<span class="flabel">Cached sources</span>
					<span class="disclose-icon" class:open={sourcesOpen} aria-hidden="true">▸</span>
				</button>
				<span class="fhint"
					>What Lectern has parsed and saved per publication. Clear to force a re-fetch of any host
					that cached a failed or empty result.</span
				>
				{#if sourcesOpen}
					{#if sourcesError}
						<p class="err">{sourcesError}</p>
					{:else if sourcesBusy && !sourceThemes.length}
						<p class="fhint">Loading…</p>
					{:else if !sourceThemes.length}
						<p class="fhint">
							No sources cached yet. Open an article with Source dress on to fill this in.
						</p>
					{:else}
						<ul class="sources">
							{#each sourceThemes as s (s.host)}
								<li class="source-row">
									<div class="source-head">
										{#if s.faviconUrl}
											<img
												class="source-favicon"
												src={s.faviconUrl}
												alt=""
												aria-hidden="true"
												referrerpolicy="no-referrer"
												onerror={(e) =>
													((e.currentTarget as HTMLImageElement).style.display = 'none')}
											/>
										{:else}
											<span class="source-favicon source-favicon-empty" aria-hidden="true"></span>
										{/if}
										<span class="source-name">{s.siteName ?? s.host}</span>
										{#if s.derivation}
											<span
												class="source-deriv"
												data-deriv={s.derivation}
												title={s.derivation === 'literal'
													? 'Palette read from the source’s own CSS'
													: 'Palette derived from the brand colour'}>{s.derivation}</span
											>
										{/if}
										<span class="source-time">{relativeTime(s.fetchedAt)}</span>
									</div>
									<div class="source-meta">
										<span class="source-swatches" aria-hidden="true">
											{#if s.background}
												<span
													class="source-swatch"
													style={`background:${s.background}`}
													title={`Light background ${s.background}`}
												></span>
											{/if}
											{#if s.backgroundDark && s.backgroundDark !== s.background}
												<span
													class="source-swatch"
													style={`background:${s.backgroundDark}`}
													title={`Dark background ${s.backgroundDark}`}
												></span>
											{/if}
											{#if s.accent}
												<span
													class="source-swatch source-swatch-accent"
													style={`background:${s.accent}`}
													title={`Light accent ${s.accent}`}
												></span>
											{/if}
											{#if s.accentDark && s.accentDark !== s.accent}
												<span
													class="source-swatch source-swatch-accent"
													style={`background:${s.accentDark}`}
													title={`Dark accent ${s.accentDark}`}
												></span>
											{/if}
										</span>
										<span class="source-fonts">
											<span class="source-font" class:muted={!s.bodyFont}>{s.bodyFont ?? '—'}</span>
											{#if s.displayFont && s.displayFont !== s.bodyFont}
												<span class="source-font source-font-display" title="Display font"
													>{s.displayFont}</span
												>
											{/if}
										</span>
									</div>
								</li>
							{/each}
						</ul>
						<div class="row">
							<button
								type="button"
								class="btn ghost"
								disabled={sourcesBusy}
								onclick={clearSourceThemes}
							>
								{sourcesBusy ? 'Clearing…' : 'Clear cache'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
			<label class="toggle">
				<input
					type="checkbox"
					checked={readerSettings.current.autoAdvance}
					onchange={(e) => readerSettings.update({ autoAdvance: e.currentTarget.checked })}
				/>
				<span>
					Auto-advance after triage
					<em>Open the next document in the list when you archive or move the current one.</em>
				</span>
			</label>
		</div>
		<button type="button" class="btn ghost reset" onclick={() => readerSettings.reset()}>
			Reset to defaults
		</button>
	</section>

	<section>
		<h2>Listen (text-to-speech)</h2>
		<p class="hint">
			Read articles aloud. Audio is synthesized only when you press Listen and cached so replays are
			free. Choose a provider: <span class="mono">ElevenLabs</span> (hosted, highest quality, needs
			an API key), <span class="mono">Kokoro</span> (free, runs on your own server), or
			<span class="mono">Piper</span> (free, lightweight, also self-hosted).
		</p>
		<label class="field">
			<span class="flabel">Provider</span>
			<select
				value={ttsProvider}
				onchange={(e) => saveTtsProvider(e.currentTarget.value as TtsProvider)}
			>
				{#each TTS_PROVIDERS as p (p.value)}
					<option value={p.value}>{p.label}</option>
				{/each}
			</select>
		</label>

		{#if ttsProvider === 'elevenlabs'}
			<p class="hint">
				Your API key is stored on the server and never sent to the browser. Get a key at
				<span class="mono">elevenlabs.io</span> → Profile → API Keys.
			</p>
			<form class="row" onsubmit={saveTtsKey}>
				<input
					type="password"
					bind:value={ttsKey}
					placeholder={ttsConfigured ? '•••••••• (key saved)' : 'ElevenLabs API key'}
					autocomplete="off"
				/>
				<button type="submit" class="btn" disabled={ttsBusy}>Save</button>
				{#if ttsConfigured}
					<button
						type="button"
						class="btn ghost"
						disabled={ttsBusy}
						onclick={() => {
							ttsKey = '';
							void getClient()
								.updateTtsSettings({ apiKey: null })
								.then((s) => {
									ttsConfigured = s.configured;
									ttsMsg = 'API key cleared.';
									ttsUsage = undefined;
								});
						}}
					>
						Clear
					</button>
				{/if}
			</form>
		{:else if ttsProvider === 'kokoro'}
			<p class="hint">
				Kokoro runs as a separate service on your server (Lectern talks to it over HTTP). Set its
				URL in the YunoHost admin → Lectern → Config panel (<span class="mono">KOKORO_BASE_URL</span
				>, default <span class="mono">http://127.0.0.1:8880</span>). No API key or quota — synthesis
				is free.
			</p>
		{:else}
			<p class="hint">
				Piper runs as a separate <span class="mono">piper.http_server</span> on your server (Lectern
				talks to it over HTTP). Set its URL in the YunoHost admin → Lectern → Config panel (<span
					class="mono">PIPER_BASE_URL</span
				>). No API key or quota — synthesis is free. See
				<span class="mono">docs/piper-tts.md</span> for setup and installing more voices.
			</p>
		{/if}
		{#if ttsMsg}<p class="ok">{ttsMsg}</p>{/if}
		{#if ttsError}<p class="err">{ttsError}</p>{/if}

		{#if ttsUsage}
			<div class="usage">
				<div class="usage-head">
					<span class="flabel">Usage this period</span>
					<span class="usage-tier">{ttsUsage.tier}</span>
				</div>
				{#if ttsUsage.characterLimit > 0}
					<div
						class="meter"
						class:meter-warn={usagePct >= 80}
						class:meter-full={usagePct >= 100}
						role="progressbar"
						aria-valuenow={usagePct}
						aria-valuemin="0"
						aria-valuemax="100"
					>
						<div class="meter-fill" style="width: {usagePct}%"></div>
					</div>
					<dl class="usage-stats">
						<div>
							<dt>Used</dt>
							<dd>
								{formatNumber(ttsUsage.characterCount)} / {formatNumber(ttsUsage.characterLimit)}
							</dd>
						</div>
						<div>
							<dt>Remaining</dt>
							<dd>{formatNumber(usageRemaining)} chars</dd>
						</div>
						{#if ttsUsage.nextResetAt}
							<div>
								<dt>Resets</dt>
								<dd>{formatResetDate(ttsUsage.nextResetAt)}</dd>
							</div>
						{/if}
					</dl>
				{:else}
					<p class="hint">
						{formatNumber(ttsUsage.characterCount)} characters used (this plan reports no limit).
					</p>
				{/if}
			</div>
		{/if}

		<div class="stack">
			{#if ttsProvider === 'elevenlabs'}
				<label class="field">
					<span class="flabel">Model</span>
					<select value={ttsModel} onchange={(e) => saveTtsModel(e.currentTarget.value)}>
						{#each TTS_MODELS as m (m.value)}
							<option value={m.value}>{m.label}</option>
						{/each}
					</select>
				</label>
			{/if}
			<label class="field">
				<span class="flabel">Voice</span>
				<div class="row">
					<select value={ttsVoiceId} onchange={(e) => saveTtsVoice(e.currentTarget.value)}>
						{#each voiceList as v (v.id)}
							<option value={v.id}>{v.name}</option>
						{/each}
					</select>
					<button
						type="button"
						class="btn ghost"
						title="Preview voice"
						aria-label="Preview voice"
						onclick={() => ttsPlayer.previewVoice(ttsVoiceId)}
					>
						{ttsPlayer.previewVoiceId === ttsVoiceId ? 'Playing…' : 'Preview'}
					</button>
					<button type="button" class="btn ghost" disabled={ttsBusy} onclick={loadVoices}>
						{ttsProvider === 'elevenlabs' ? 'Load my voices' : 'Load voices'}
					</button>
				</div>
				<div class="row">
					<input
						type="text"
						placeholder={ttsProvider === 'kokoro'
							? '…or type a Kokoro voice id (e.g. af_heart, or af_bella+af_sky)'
							: ttsProvider === 'piper'
								? '…or type a Piper voice id (e.g. en_US-lessac-medium)'
								: '…or paste an ElevenLabs voice ID'}
						value=""
						onchange={(e) => {
							const v = e.currentTarget.value.trim();
							if (v) saveTtsVoice(v);
							e.currentTarget.value = '';
						}}
					/>
				</div>
				{#if ttsVoicesNote}<p class="hint">{ttsVoicesNote}</p>{/if}
			</label>
		</div>
	</section>

	<section>
		<h2>Discover</h2>
		<p class="hint">
			Lectern can find new web articles that match what you read and save, and surface them under
			<a class="link" href={resolve('/discover')}>Discover</a>. Scoring runs on your server with
			classic information retrieval — no LLM. Vote to train it; saving pulls an article into your
			library.
		</p>
		<form class="stack disc-form" onsubmit={saveDiscovery}>
			<label class="toggle">
				<input type="checkbox" bind:checked={discEnabled} />
				<span>
					Enable discovery
					<em>Let the scheduled worker fetch and score candidates for you.</em>
				</span>
			</label>

			<label>
				<span>Topics</span>
				<textarea
					rows="2"
					bind:value={discTopics}
					placeholder="e.g. distributed systems, typography, cycling"
				></textarea>
				<span class="fhint">Comma- or newline-separated interests that steer the search.</span>
			</label>

			<label>
				<span>Seed URLs</span>
				<textarea rows="3" bind:value={discSeedUrls} placeholder="https://example.com/blog"
				></textarea>
				<span class="fhint">One per line. Sites to crawl for candidates.</span>
			</label>

			<div class="field">
				<span class="flabel">Fetchers</span>
				<label class="toggle">
					<input type="checkbox" bind:checked={discSearxng} />
					<span>SearXNG <em>Meta-search via your SearXNG instance.</em></span>
				</label>
				<label class="toggle">
					<input type="checkbox" bind:checked={discBrave} />
					<span>Brave <em>Brave Search API (needs a key below).</em></span>
				</label>
				<label class="toggle">
					<input type="checkbox" bind:checked={discCrawl} />
					<span>Crawl <em>Follow links from your seed URLs.</em></span>
				</label>
			</div>

			<label>
				<span>SearXNG URL</span>
				<input type="text" bind:value={discSearxngUrl} placeholder="https://searxng.example.com" />
			</label>

			<label>
				<span>Brave API key</span>
				<input
					type="password"
					bind:value={discBraveKey}
					placeholder={discBraveConfigured ? '•••••••• (key configured)' : 'Brave Search API key'}
					autocomplete="off"
				/>
				<span class="fhint">
					{discBraveConfigured
						? 'A key is configured. Type a new one to replace it; leave blank to keep it.'
						: 'Write-only — stored on the server and never shown again.'}
				</span>
			</label>

			<div class="disc-grid">
				<label>
					<span>Crawl depth</span>
					<input type="number" min="0" max="3" bind:value={discCrawlDepth} />
				</label>
				<label>
					<span>Time budget (ms)</span>
					<input type="number" min="1" step="1000" bind:value={discCrawlTimeMs} />
				</label>
				<label>
					<span>Target count</span>
					<input type="number" min="1" max="20" bind:value={discTarget} />
				</label>
			</div>

			<label>
				<span>Schedule (cron)</span>
				<input type="text" bind:value={discSchedule} placeholder="0 */6 * * *" />
				<span class="fhint">How often the run fires. Default: every 6 hours.</span>
			</label>

			<div class="field">
				<span class="flabel">Rocchio weights</span>
				<span class="fhint">
					profile′ = a·profile + b·mean(liked) − c·mean(disliked). Higher b/c react faster to votes.
				</span>
				<div class="disc-grid">
					<label>
						<span>a (profile)</span>
						<input type="number" step="0.05" bind:value={discRocchioA} />
					</label>
					<label>
						<span>b (liked)</span>
						<input type="number" step="0.05" bind:value={discRocchioB} />
					</label>
					<label>
						<span>c (disliked)</span>
						<input type="number" step="0.05" bind:value={discRocchioC} />
					</label>
				</div>
			</div>

			<div class="disc-grid">
				<label>
					<span>Freshness half-life (days)</span>
					<input type="number" min="1" bind:value={discFreshness} />
					<span class="fhint">Lower = prefer newer articles.</span>
				</label>
				<label class:dim={!discFullText}>
					<span>Full-text candidates</span>
					<input
						type="number"
						min="1"
						max="50"
						bind:value={discFullTextCandidates}
						disabled={!discFullText}
					/>
					<span class="fhint">Top candidates to fetch full text for.</span>
				</label>
			</div>

			<label class="toggle">
				<input type="checkbox" bind:checked={discFullText} />
				<span>
					Read full article text
					<em>Fetches each candidate's full text for sharper ranking. Slower runs.</em>
				</span>
			</label>

			<div class="field">
				<span class="flabel">Muted domains</span>
				<span class="fhint">Sources to never surface candidates from.</span>
				<div class="row">
					<input
						type="text"
						bind:value={discMutedInput}
						placeholder="example.com"
						autocomplete="off"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addMutedDomain();
							}
						}}
					/>
					<button
						type="button"
						class="btn"
						disabled={!discMutedInput.trim()}
						onclick={addMutedDomain}
					>
						Add
					</button>
				</div>
				{#if discMutedDomains.length}
					<ul class="chips">
						{#each discMutedDomains as d (d)}
							<li class="chip chip-tag">
								<span>{d}</span>
								<button
									type="button"
									aria-label={`Unmute ${d}`}
									onclick={() => removeMutedDomain(d)}>×</button
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="row">
				<button type="submit" class="btn" disabled={discBusy}>
					{discBusy ? 'Saving…' : 'Save discovery settings'}
				</button>
				{#if discMsg}<span class="ok">{discMsg}</span>{/if}
			</div>
			{#if discError}<p class="err">{discError}</p>{/if}
		</form>

		<div class="field reseed">
			<span class="flabel">Rebuild profile</span>
			<span class="fhint">
				Re-derive the interest model from your current library (shortlist, highlights, read items,
				tags). Do this after a big change to what you've saved.
			</span>
			<div class="row">
				<button type="button" class="btn ghost" disabled={reseedBusy} onclick={reseedProfile}>
					{reseedBusy ? 'Rebuilding…' : 'Rebuild profile'}
				</button>
				{#if reseedMsg}<span class="ok">{reseedMsg}</span>{/if}
			</div>
			{#if reseedError}<p class="err">{reseedError}</p>{/if}
		</div>
	</section>

	<section>
		<h2>Newsletter senders</h2>
		<p class="hint">
			Ignore a sender to skip its future emails when Lectern checks your newsletter mailbox. Adding
			one also removes its already-saved emails from your library. Match by sender name or email
			address.
		</p>
		<form
			class="row"
			onsubmit={(e) => {
				e.preventDefault();
				void addEmailIgnore(emailInput);
			}}
		>
			<input
				type="text"
				bind:value={emailInput}
				placeholder="Sender name or email address"
				autocomplete="off"
			/>
			<button type="submit" class="btn" disabled={emailBusy || !emailInput.trim()}>Ignore</button>
		</form>
		{#if emailMsg}<p class="ok">{emailMsg}</p>{/if}
		{#if emailError}<p class="err">{emailError}</p>{/if}

		{#if emailIgnore.length}
			<div class="field">
				<span class="flabel">Ignored</span>
				<ul class="chips">
					{#each emailIgnore as s (s)}
						<li class="chip chip-tag">
							<span>{s}</span>
							<button
								type="button"
								aria-label={`Stop ignoring ${s}`}
								disabled={emailBusy}
								onclick={() => removeEmailIgnore(s)}>×</button
							>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if emailKnownAvailable.length}
			<div class="field">
				<span class="flabel">Senders in your library</span>
				<ul class="chips">
					{#each emailKnownAvailable as k (k.name)}
						<li>
							<button
								type="button"
								class="chip chip-add"
								disabled={emailBusy}
								title={`Ignore ${k.name} and remove ${k.count} email${k.count === 1 ? '' : 's'}`}
								onclick={() => addEmailIgnore(k.name)}
							>
								<span>{k.name}</span>
								<span class="chip-count">{k.count}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>

	<section>
		<h2>Notifications</h2>
		{#if !pushSupported}
			<p class="hint">
				Push notifications aren’t supported on this browser. Install Lectern to your home screen and
				open it as an app (Android Chrome) to enable them.
			</p>
		{:else}
			<p class="hint">
				Get a notification on this device when feeds you’ve subscribed to publish something new.
				Choose which feeds notify you on the <a class="link" href={resolve('/feeds')}>Feeds page</a
				>.
			</p>
			<div class="row">
				<button type="button" class="btn" disabled={pushBusy} onclick={togglePush}>
					{pushBusy ? 'Working…' : pushOn ? 'Disable on this device' : 'Enable push on this device'}
				</button>
				{#if pushOn}<span class="ok">Enabled on this device.</span>{/if}
			</div>
			{#if pushDenied && !pushOn}
				<p class="hint">
					Notifications are currently blocked for this site — re-enable them in your browser’s site
					settings, then try again.
				</p>
			{/if}
			{#if pushError}<p class="err">{pushError}</p>{/if}
		{/if}
	</section>

	<section>
		<h2>Podcast feed</h2>
		<p class="hint">
			Subscribe any podcast app to listen to articles you publish. On an article, tap the
			<span class="mono">RSS</span> button to render its audio and add it as an episode. The feed URL
			is private — anyone with it can hear your episodes, so treat it like a password.
		</p>
		<label class="field">
			<span class="flabel"
				>Feed URL ({podcastEpisodeCount} episode{podcastEpisodeCount === 1 ? '' : 's'})</span
			>
			<div class="row">
				<input
					type="text"
					readonly
					value={podcastFeedUrl}
					placeholder="Add an episode to mint your feed URL"
				/>
				<button type="button" class="btn ghost" disabled={!podcastFeedUrl} onclick={copyPodcastUrl}>
					{podcastCopied ? 'Copied' : 'Copy'}
				</button>
				<button type="button" class="btn ghost" disabled={podcastBusy} onclick={regeneratePodcast}>
					Regenerate
				</button>
			</div>
		</label>
		{#if podcastError}<p class="err">{podcastError}</p>{/if}
	</section>

	<section>
		<h2>Clean up</h2>
		<p class="hint">
			Delete everything you’ve finished reading — read feed articles and read newsletter issues — in
			one sweep. Items are removed at the source so they won’t come back on the next poll. This
			can’t be undone.
		</p>
		<div class="row">
			<button type="button" class="btn danger" disabled={cleaning} onclick={deleteAllRead}>
				{cleaning ? 'Deleting…' : 'Delete all read items'}
			</button>
			{#if cleanResult}<span class="ok">{cleanResult}</span>{/if}
		</div>
		{#if cleanError}<p class="err">{cleanError}</p>{/if}
	</section>

	<section>
		<h2>Sync</h2>
		<p class="hint">
			Force a full sync with your sources now. Re-indexes new items from MiniFlux and Readeck and
			prunes anything deleted upstream, then refreshes this device.
		</p>
		<div class="row">
			<button type="button" class="btn" disabled={syncing} onclick={forceSync}>
				{syncing ? 'Syncing…' : 'Sync now'}
			</button>
			{#if syncResult}<span class="ok">{syncResult}</span>{/if}
		</div>
		{#if syncError}<p class="err">{syncError}</p>{/if}

		<p class="hint spaced">
			If this device is showing items that no longer exist — or is missing ones that do — rebuild
			its offline copy. This clears the library stored on this device and downloads it again from
			the server. Your saved items, tags, notes and highlights are stored on the server and are not
			affected. Anything still waiting to sync is sent first; if it can’t be sent, the rebuild is
			cancelled rather than losing it.
		</p>
		<div class="row">
			<button type="button" class="btn" disabled={rebuilding} onclick={rebuildLibrary}>
				{rebuilding ? 'Rebuilding…' : 'Rebuild local library'}
			</button>
			{#if rebuildResult}<span class="ok">{rebuildResult}</span>{/if}
		</div>
		{#if rebuildError}<p class="err">{rebuildError}</p>{/if}
	</section>

	<section class="about">
		<h2>About</h2>
		<dl class="meta-list">
			<div>
				<dt>Deployed version</dt>
				<dd><code>{APP_VERSION}</code></dd>
			</div>
			<div>
				<dt>Release notes</dt>
				<dd><a class="link" href={resolve('/changelog')}>What’s new →</a></dd>
			</div>
		</dl>
	</section>
</div>

<style>
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 1.6rem;
	}
	section {
		margin-bottom: 2.4rem;
	}
	h2 {
		font-size: var(--text-md);
		margin-bottom: 0.6rem;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 26rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	label span,
	.flabel {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	input[type='text'],
	input[type='password'],
	input[type='number'],
	textarea {
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-base);
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		transition: border-color var(--dur-fast) var(--ease);
	}
	textarea {
		resize: vertical;
		line-height: 1.4;
	}
	input[type='text']:focus,
	input[type='password']:focus,
	input[type='number']:focus,
	textarea:focus {
		border-color: var(--accent);
		outline: none;
	}
	input[readonly] {
		color: var(--text-muted);
	}
	select {
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		max-width: 24rem;
	}
	.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.7rem;
	}
	.btn {
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.btn:hover {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.btn.danger {
		color: var(--error);
	}
	.btn.danger:hover:not(:disabled) {
		border-color: var(--error);
		background: color-mix(in srgb, var(--error) 8%, transparent);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.ghost {
		background: transparent;
	}
	.reset {
		margin-top: 1rem;
		color: var(--text-muted);
	}

	.file-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.95rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.file-btn:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.file-btn.busy {
		opacity: 0.6;
		cursor: default;
	}
	.file-btn input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.summary {
		display: flex;
		gap: 2rem;
		margin: 1rem 0 0;
	}
	.summary div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.summary dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.summary dd {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.seg {
		display: flex;
		gap: 0.25rem;
		padding: 0.2rem;
		background: var(--surface-alt);
		border-radius: var(--radius);
		max-width: 18rem;
	}
	.seg button {
		flex: 1;
		padding: 0.36rem 0.4rem;
		border: 0;
		border-radius: calc(var(--radius) - 3px);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.seg button:hover {
		color: var(--text);
	}
	.seg button.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.flabel-val {
		font-style: normal;
		font-weight: 500;
		color: var(--text-muted);
	}
	.fhint {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	/* Dim a control that isn't meaningful in the current state (e.g. full-text
	   candidates while full-text extraction is off). */
	.dim {
		opacity: 0.5;
	}
	.picker {
		max-width: 18rem;
	}

	/* Cached-sources disclosure: a flat "label + chevron" toggle that reads as part
	   of the surrounding fields, plus a bordered list of one row per parsed host. */
	.disclose {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		max-width: 18rem;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		text-align: left;
	}
	.disclose .flabel {
		cursor: pointer;
	}
	.disclose-icon {
		color: var(--text-muted);
		font-size: var(--text-sm);
		transition: transform var(--dur-fast) var(--ease);
	}
	.disclose-icon.open {
		transform: rotate(90deg);
	}
	.sources {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		max-width: 30rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.source-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem 0.6rem;
	}
	.source-row + .source-row {
		border-top: 1px solid var(--border);
	}
	.source-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.source-favicon {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: var(--radius-sm);
		object-fit: contain;
		flex: none;
	}
	.source-favicon-empty {
		background: var(--surface-alt);
		border: 1px solid var(--border);
	}
	.source-name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Derivation badge: how the palette was obtained. `literal` (parsed from the
	   source's own CSS) reads as a confident accent pill; `derived` (synthesized
	   from the brand colour) is quieter, so the difference is legible at a glance. */
	.source-deriv {
		flex: none;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: capitalize;
		border: 1px solid var(--border);
		color: var(--text-muted);
		background: var(--surface-alt);
	}
	.source-deriv[data-deriv='literal'] {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		background: var(--accent-soft);
	}
	.source-time {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	/* Second line: the palette swatches + the font names the re-skin would wear. */
	.source-meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding-left: 1.6rem;
	}
	.source-swatches {
		display: inline-flex;
		gap: 0.2rem;
		flex: none;
	}
	.source-swatch {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
	}
	/* Accent swatches read as circles so they're distinct from the square grounds. */
	.source-swatch-accent {
		border-radius: var(--radius-full);
	}
	.source-fonts {
		display: flex;
		flex: 1;
		min-width: 0;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.source-font {
		max-width: 8rem;
		font-size: var(--text-xs);
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.source-font.muted {
		color: var(--text-muted);
	}
	.source-font-display {
		color: var(--text-muted);
		font-style: italic;
	}

	/* Theme swatches: a small palette tile per theme, each rendered in its own
	   colours so the choice is visible at a glance. */
	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
		gap: 0.5rem;
		max-width: 26rem;
	}
	.swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.55rem 0.4rem;
		border: 1.5px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			transform var(--dur-fast) var(--ease);
	}
	.swatch:hover {
		transform: translateY(-1px);
	}
	.swatch.active {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.swatch .chip {
		display: grid;
		place-items: center;
		width: 100%;
		height: 2.2rem;
		border-radius: calc(var(--radius) - 3px);
		background: var(--sw-bg);
		color: var(--sw-fg);
		font-family: var(--font-serif);
		font-size: 1rem;
		border: 1px solid var(--border);
	}
	.sw-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.swatch.active .sw-label {
		color: var(--text);
		font-weight: 600;
	}

	/* Font cards: a large glyph rendered in the actual face + name and rationale. */
	.fonts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: 0.5rem;
		max-width: 30rem;
	}
	.fontcard {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.6rem;
		border: 1.5px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
		text-align: left;
		transition: border-color var(--dur-fast) var(--ease);
	}
	.fontcard:hover {
		border-color: var(--border-strong);
	}
	.fontcard.active {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.fontsample {
		flex-shrink: 0;
		width: 2.3rem;
		text-align: center;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--text);
	}
	.fontmeta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.fontname {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text);
	}
	.fontnote {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.slider {
		gap: 0.45rem;
	}
	.slider span {
		display: flex;
		justify-content: space-between;
	}
	.slider em {
		font-style: normal;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.slider input {
		width: 100%;
		accent-color: var(--accent);
	}
	.toggle {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 0.6rem;
		cursor: pointer;
	}
	.toggle input {
		margin-top: 0.2rem;
		width: 1.05rem;
		height: 1.05rem;
		flex-shrink: 0;
		accent-color: var(--accent);
	}
	.toggle span {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.toggle em {
		font-style: normal;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
		max-width: 34rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.28rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		line-height: 1.2;
	}
	.chip-tag button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-md);
		line-height: 1;
		cursor: pointer;
	}
	.chip-tag button:hover:not(:disabled) {
		color: var(--error);
	}
	.chip-add {
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.chip-add:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.chip-add:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.chip-count {
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.ok {
		color: var(--ok);
		font-size: var(--text-sm);
	}
	.err {
		color: var(--error);
		font-size: var(--text-sm);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--text-muted);
		max-width: 30rem;
		margin: 0 0 0.7rem;
	}
	/* A second hint within one section, separated from the control above it. */
	.hint.spaced {
		margin-top: 1.4rem;
	}
	.bm-link {
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
		cursor: grab;
	}
	.meta-list {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.meta-list > div {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}
	.meta-list dt {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.meta-list dd {
		margin: 0;
	}
	.about code {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: var(--surface-alt);
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-sm);
	}
	.about .link {
		color: var(--accent);
		font-size: var(--text-sm);
	}
	.about .link:hover {
		text-decoration: underline;
	}
	/* Discover: the form is wider than the default stack to fit the cron/URL fields,
	   and the tuning numbers sit in a compact responsive grid. */
	.disc-form {
		max-width: 32rem;
	}
	.disc-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: 0.7rem;
	}
	.reseed {
		margin-top: 1.4rem;
		padding-top: 1.2rem;
		border-top: 1px solid var(--border);
		max-width: 32rem;
	}
	.link {
		color: var(--accent);
	}
	.link:hover {
		text-decoration: underline;
	}

	.usage {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		margin: 0 0 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-alt);
	}
	.usage-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}
	.usage-tier {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
		color: var(--accent);
	}
	.meter {
		height: 0.5rem;
		border-radius: 999px;
		background: var(--border);
		overflow: hidden;
	}
	.meter-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--dur-fast) var(--ease);
	}
	.meter-warn .meter-fill {
		background: var(--warning, #d98324);
	}
	.meter-full .meter-fill {
		background: var(--error);
	}
	.usage-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.6rem;
		margin: 0;
	}
	.usage-stats > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.usage-stats dt {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.usage-stats dd {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
</style>
