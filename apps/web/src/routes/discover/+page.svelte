<script lang="ts">
	/**
	 * Discover: the list of articles a background worker found relevant to the
	 * user's interests. Candidates are NOT library documents, so they never touch
	 * Dexie/sync — we call the client directly and hold the result in local
	 * `$state`. Votes, saves and clears apply optimistically through the pure
	 * reducer in `$lib/discover`, rolling back if the server rejects them.
	 *
	 * The page wears the same chrome as a feed/library list (ListView): a header
	 * with title + count, a sort dropdown + asc/desc toggle, a text-search filter,
	 * a Filter popover (the Source facet maps to the fetcher), an overflow menu,
	 * and keyboard list navigation. The only per-row differences are the ▲/▼/Save
	 * actions and a per-row Clear; the overflow menu swaps the library's bulk
	 * actions for a single "Clear all".
	 */
	import type {
		DiscoveryCandidate,
		DiscoveryFetcher,
		FollowSuggestion,
		SortDir,
		VoteValue
	} from '@lectern/shared';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import {
		applyCandidateAction,
		candidateHost,
		candidateToCard,
		followSignalLabel
	} from '$lib/discover';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import CardList from '$lib/components/CardList.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let candidates = $state<DiscoveryCandidate[]>([]);
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	let triggering = $state(false);
	const busyIds = new SvelteSet<string>();
	// Hosts the user has muted, held so a mute can append without a read-back race.
	// Loaded alongside the candidates; kept in step optimistically when muting.
	let mutedDomains = $state<string[]>([]);

	// ---- Auto-follow suggestions ("Sources you keep saving") ----
	// Domains the user repeatedly saves/upvotes but doesn't yet follow. Rendered as
	// a subordinate hint strip above the candidate list; empty until loaded and any
	// time the backend has nothing to offer, so the strip simply disappears. Each
	// row's Follow/Dismiss mutation is optimistic (drop the row, roll back on
	// error), guarded per-domain against double-clicks like the candidate actions.
	let suggestions = $state<FollowSuggestion[]>([]);
	const busyDomains = new SvelteSet<string>();

	// Keyboard list selection, mirroring ListView. scrollNonce is bumped on every
	// keyboard-driven move so CardList scrolls the focused row into view.
	let selectedIndex = $state(0);
	let scrollNonce = $state(0);

	// ---- Sort (candidate-specific: "Relevance" ranks by the model's score) ----
	type DiscoverSort = 'relevance' | 'publishedAt' | 'title';
	const SORT_LABELS: Record<DiscoverSort, string> = {
		relevance: 'Relevance',
		publishedAt: 'Published',
		title: 'Title'
	};
	let sortBy = $state<DiscoverSort>('relevance');
	let sortDir = $state<SortDir>('desc');

	// Local sort over candidates: score isn't on Card, so we can't reuse sortCards
	// for "relevance". Stable tiebreak on id keeps equal keys deterministic.
	function sortCandidates(
		list: DiscoveryCandidate[],
		by: DiscoverSort,
		dir: SortDir
	): DiscoveryCandidate[] {
		const sign = dir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => {
			const cmp =
				by === 'relevance'
					? a.score - b.score
					: by === 'title'
						? (a.title ?? '').localeCompare(b.title ?? '')
						: (a.publishedAt ?? a.firstSeenAt).localeCompare(b.publishedAt ?? b.firstSeenAt);
			return cmp !== 0 ? cmp * sign : a.id.localeCompare(b.id) * sign;
		});
	}

	// ---- Text + Source(fetcher) facets ----
	type FetcherFilter = DiscoveryFetcher | 'all';
	const FETCHER_ORDER: readonly DiscoveryFetcher[] = ['searxng', 'brave', 'crawl'];
	const FETCHER_LABELS: Record<DiscoveryFetcher, string> = {
		searxng: 'SearXNG',
		brave: 'Brave',
		crawl: 'Crawler'
	};
	let textFilter = $state('');
	let fetcherFilter = $state<FetcherFilter>('all');

	// Compose the facets in a fixed pipeline (text → fetcher → sort). The fetcher
	// options derive from the text-filtered set so we only offer choices that match.
	const afterText = $derived.by(() => {
		const needle = textFilter.trim().toLowerCase();
		if (!needle) return candidates;
		return candidates.filter(
			(c) =>
				(c.title ?? '').toLowerCase().includes(needle) ||
				(c.siteName ?? '').toLowerCase().includes(needle) ||
				(c.author ?? '').toLowerCase().includes(needle)
		);
	});
	const fetchers = $derived(FETCHER_ORDER.filter((f) => afterText.some((c) => c.fetcher === f)));
	const afterFetcher = $derived(
		fetcherFilter === 'all' ? afterText : afterText.filter((c) => c.fetcher === fetcherFilter)
	);
	const sorted = $derived(sortCandidates(afterFetcher, sortBy, sortDir));

	// Render candidates with the app's real card treatment (CardList): map each to
	// a Card, and pass the candidate-only signals CardList can't read off a Card
	// (score, fetcher, vote, saved, busy) via a lookup map keyed by id.
	const cards = $derived(sorted.map(candidateToCard));
	const discoverMeta = $derived(
		new Map(
			sorted.map((c) => [
				c.id,
				{
					score: c.score,
					fetcher: c.fetcher,
					vote: c.vote,
					saved: c.status === 'saved',
					busy: busyIds.has(c.id),
					terms: c.matchedTerms ?? []
				}
			])
		)
	);

	// Filter popover / overflow menu bookkeeping, matching ListView.
	const facetCount = $derived(fetcherFilter !== 'all' ? 1 : 0);
	const hasFacets = $derived(fetchers.length > 1);
	const activeCount = $derived((textFilter.trim() ? 1 : 0) + facetCount);
	function clearFilters() {
		textFilter = '';
		fetcherFilter = 'all';
	}

	// Drop a stale fetcher selection once the text filter makes it impossible to
	// match (guarded on a non-empty set so a fresh load doesn't wipe it early).
	$effect(() => {
		if (afterText.length && fetcherFilter !== 'all' && !fetchers.includes(fetcherFilter)) {
			fetcherFilter = 'all';
		}
	});
	// Keep the selection inside the (reactively changing) list bounds.
	$effect(() => {
		if (selectedIndex >= cards.length) selectedIndex = Math.max(0, cards.length - 1);
	});

	// Header popovers: Filter panel and overflow menu, one open at a time, closed
	// by an outside click (the window handler; inner clicks stop propagation).
	let filtersOpen = $state(false);
	let menuOpen = $state(false);
	function closePopovers() {
		filtersOpen = false;
		menuOpen = false;
	}

	// ---- Keyboard list controller ----
	// Candidates live off-site, so "open" opens the original in a new tab and there
	// is no triage/mark-read; "refresh" re-fetches the batch.
	const controller: ListController = {
		move(delta) {
			if (cards.length === 0) return;
			selectedIndex = Math.min(cards.length - 1, Math.max(0, selectedIndex + delta));
			scrollNonce += 1;
		},
		open() {
			const card = cards[selectedIndex];
			if (card) window.open(card.url, '_blank', 'noopener,noreferrer');
		},
		triage() {
			// No-op: candidates have no library location to triage into.
		},
		refresh() {
			selectedIndex = 0;
			void load();
		}
	};

	onMount(() => {
		activeList.set(controller);
		void load();
		void loadMutedDomains();
		void loadSuggestions();
		return () => activeList.clear(controller);
	});

	// The muted-domains list lives in discovery settings; load it so a mute can
	// append to the current set rather than round-tripping a read first.
	async function loadMutedDomains() {
		try {
			const s = await getClient().getDiscoverySettings();
			mutedDomains = s.mutedDomains;
		} catch {
			/* offline or discovery not configured: leave empty, mute still works */
		}
	}

	async function load() {
		loading = true;
		error = undefined;
		try {
			const res = await getClient().listCandidates({ status: 'active' });
			candidates = res.candidates;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load discoveries.';
		} finally {
			loading = false;
		}
	}

	async function vote(id: string, value: VoteValue) {
		if (busyIds.has(id)) return;
		const snapshot = candidates;
		// Optimistic: upvote keeps the row (marked liked), downvote drops it.
		candidates = applyCandidateAction(candidates, {
			type: value === 'up' ? 'upvote' : 'downvote',
			id
		});
		busyIds.add(id);
		try {
			await getClient().voteCandidate(id, value);
		} catch {
			candidates = snapshot; // rollback
		} finally {
			busyIds.delete(id);
		}
	}

	async function save(id: string) {
		if (busyIds.has(id)) return;
		const snapshot = candidates;
		candidates = applyCandidateAction(candidates, { type: 'save', id });
		busyIds.add(id);
		try {
			await getClient().saveCandidate(id);
		} catch {
			candidates = snapshot; // rollback the "Saved" badge
		} finally {
			busyIds.delete(id);
		}
	}

	// Clear one candidate off the list without casting a vote (distinct from a
	// down-vote: no training signal). Optimistic drop, rolled back on failure.
	async function clearOne(id: string) {
		if (busyIds.has(id)) return;
		const snapshot = candidates;
		candidates = applyCandidateAction(candidates, { type: 'clear', id });
		busyIds.add(id);
		try {
			await getClient().clearCandidates([id]);
		} catch {
			candidates = snapshot; // rollback
		} finally {
			busyIds.delete(id);
		}
	}

	// ---- Bulk "Clear all" (overflow menu). Clears every active candidate without
	// voting. Optimistic empty with rollback; a brief toast confirms the count. ----
	let clearingAll = $state(false);
	let clearResult = $state<string | null>(null);
	let clearTimer: ReturnType<typeof setTimeout> | undefined;
	async function clearAll() {
		if (clearingAll || candidates.length === 0) return;
		menuOpen = false;
		const snapshot = candidates;
		const count = candidates.length;
		candidates = applyCandidateAction(candidates, { type: 'clearAll' });
		clearingAll = true;
		try {
			await getClient().clearCandidates();
			clearResult = `Cleared ${count} item${count === 1 ? '' : 's'}`;
			if (clearTimer) clearTimeout(clearTimer);
			clearTimer = setTimeout(() => (clearResult = null), 5000);
		} catch {
			candidates = snapshot; // rollback
			error = 'Could not clear the list.';
		} finally {
			clearingAll = false;
		}
	}

	// Mute a candidate's source: append its host to the settings' mutedDomains and
	// optimistically drop every currently-listed candidate from that host. Reuses
	// the Clear toast for confirmation; rolls back both list and muted set on error.
	let muting = $state(false);
	async function mute(id: string) {
		if (muting) return;
		const target = candidates.find((c) => c.id === id);
		if (!target) return;
		const host = candidateHost(target.url);
		if (!host) return;
		const snapshot = candidates;
		const snapshotMuted = mutedDomains;
		const count = candidates.filter((c) => candidateHost(c.url) === host).length;
		const nextMuted = mutedDomains.includes(host) ? mutedDomains : [...mutedDomains, host];
		candidates = applyCandidateAction(candidates, { type: 'muteHost', host });
		mutedDomains = nextMuted;
		muting = true;
		try {
			await getClient().updateDiscoverySettings({ mutedDomains: nextMuted });
			clearResult = `Muted ${host} · removed ${count} item${count === 1 ? '' : 's'}`;
			if (clearTimer) clearTimeout(clearTimer);
			clearTimer = setTimeout(() => (clearResult = null), 5000);
		} catch {
			candidates = snapshot; // rollback the optimistic drop
			mutedDomains = snapshotMuted;
			error = 'Could not mute this source.';
		} finally {
			muting = false;
		}
	}

	// Load the follow suggestions independently of the candidate batch: this is a
	// non-critical hint bar, so a failure leaves it empty rather than surfacing an
	// error (the candidate list owns the visible error slot).
	async function loadSuggestions() {
		try {
			const res = await getClient().getFollowSuggestions();
			suggestions = res.suggestions;
		} catch {
			/* offline or discovery not configured: leave the strip empty */
		}
	}

	// Follow a suggested domain: subscribe to its feed and drop the row. Optimistic
	// removal with rollback, reusing the Clear/Mute toast for confirmation; guarded
	// per-domain so a double-click can't fire the subscription twice.
	async function follow(domain: string) {
		if (busyDomains.has(domain)) return;
		const snapshot = suggestions;
		suggestions = suggestions.filter((s) => s.domain !== domain);
		busyDomains.add(domain);
		try {
			await getClient().followDomain(domain);
			clearResult = `Following ${domain}`;
			if (clearTimer) clearTimeout(clearTimer);
			clearTimer = setTimeout(() => (clearResult = null), 5000);
		} catch {
			suggestions = snapshot; // rollback the optimistic drop
			error = 'Could not follow this source.';
		} finally {
			busyDomains.delete(domain);
		}
	}

	// Dismiss a suggestion so it stops being offered. Optimistic drop, rolled back
	// on failure; no toast — a quiet removal is enough for a hint the user rejected.
	async function dismissSuggestion(domain: string) {
		if (busyDomains.has(domain)) return;
		const snapshot = suggestions;
		suggestions = suggestions.filter((s) => s.domain !== domain);
		busyDomains.add(domain);
		try {
			await getClient().dismissFollow(domain);
		} catch {
			suggestions = snapshot; // rollback
			error = 'Could not dismiss this suggestion.';
		} finally {
			busyDomains.delete(domain);
		}
	}

	async function discoverNow() {
		if (triggering) return;
		triggering = true;
		try {
			await getClient().triggerDiscoveryRun();
			await goto(resolve('/discover/activity'));
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not start a discovery run.';
			triggering = false;
		}
	}
</script>

<svelte:window onclick={closePopovers} />

<section class="list page">
	<header class="head">
		<h1>
			Discover
			{#if cards.length}<span class="count">{cards.length}</span>{/if}
		</h1>
		<div class="tools">
			{#if candidates.length}
				<div class="select">
					<select bind:value={sortBy} aria-label="Sort by">
						{#each Object.entries(SORT_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>
				<button
					type="button"
					class="icon"
					onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')}
					aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
				>
					{sortDir === 'asc' ? '↑' : '↓'}
				</button>
				<div class="search">
					<Icon name="search" size={14} />
					<input
						bind:value={textFilter}
						type="search"
						placeholder="Filter…"
						autocomplete="off"
						aria-label="Filter by title, site or author"
					/>
				</div>

				{#if hasFacets || facetCount}
					<div class="pop-wrap">
						<button
							type="button"
							class="icon"
							class:on={facetCount > 0}
							aria-label="Filters"
							aria-expanded={filtersOpen}
							title="Filters"
							onclick={(e) => {
								e.stopPropagation();
								menuOpen = false;
								filtersOpen = !filtersOpen;
							}}
						>
							<Icon name="sliders" size={16} />
							{#if facetCount}<span class="badge">{facetCount}</span>{/if}
						</button>
						{#if filtersOpen}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div class="popover" onclick={(e) => e.stopPropagation()}>
								{#if fetchers.length > 1}
									<label class="field">
										<span>Source</span>
										<div class="select block">
											<select bind:value={fetcherFilter} aria-label="Filter by source">
												<option value="all">All sources</option>
												{#each fetchers as f (f)}
													<option value={f}>{FETCHER_LABELS[f]}</option>
												{/each}
											</select>
										</div>
									</label>
								{/if}
								{#if activeCount}
									<button type="button" class="clear-filters" onclick={clearFilters}>
										<Icon name="close" size={14} /> Clear all filters
										<span class="badge">{activeCount}</span>
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<div class="pop-wrap">
					<button
						type="button"
						class="icon"
						aria-label="List actions"
						aria-expanded={menuOpen}
						title="List actions"
						onclick={(e) => {
							e.stopPropagation();
							filtersOpen = false;
							menuOpen = !menuOpen;
						}}
					>
						<Icon name="more" size={18} />
					</button>
					{#if menuOpen}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
							<button
								type="button"
								role="menuitem"
								class="danger"
								disabled={clearingAll}
								onclick={clearAll}
							>
								<Icon name="trash" size={15} />
								{clearingAll ? 'Clearing…' : 'Clear all'}
							</button>
						</div>
					{/if}
				</div>
			{/if}

			<a class="btn ghost" href={resolve('/discover/activity')}>
				<Icon name="refresh" size={16} /> Activity
			</a>
			<button type="button" class="btn" disabled={triggering} onclick={discoverNow}>
				<Icon name="compass" size={16} />
				{triggering ? 'Starting…' : 'Discover now'}
			</button>
		</div>
	</header>

	<p class="lede">
		Articles from around the web that match what you read and save. Vote
		<span class="glyph">▲</span> for more like it, <span class="glyph">▼</span> to dismiss, save one to
		your library, or clear items you're done with.
	</p>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if suggestions.length}
		<section class="follow-strip" aria-labelledby="follow-strip-title">
			<h2 id="follow-strip-title" class="follow-strip-title">
				<Icon name="rss" size={13} /> Sources you keep saving
			</h2>
			<ul class="follow-list">
				{#each suggestions as s (s.domain)}
					<li class="follow-item">
						<div class="follow-meta">
							<span class="follow-domain">{s.domain}</span>
							<span class="follow-count">{followSignalLabel(s.signalCount)}</span>
							{#if s.sampleTitles[0]}
								<span class="follow-sample" title={s.sampleTitles[0]}>“{s.sampleTitles[0]}”</span>
							{/if}
						</div>
						<div class="follow-actions">
							<button
								type="button"
								class="follow-btn"
								disabled={busyDomains.has(s.domain)}
								onclick={() => follow(s.domain)}
								aria-label={`Follow ${s.domain}`}
								title={`Follow ${s.domain}`}
							>
								<Icon name="plus" size={14} /> Follow
							</button>
							<button
								type="button"
								class="follow-btn ghost"
								disabled={busyDomains.has(s.domain)}
								onclick={() => dismissSuggestion(s.domain)}
								aria-label={`Dismiss the suggestion to follow ${s.domain}`}
								title="Dismiss"
							>
								<Icon name="close" size={14} />
							</button>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if loading}
		<CardList cards={undefined} loading />
	{:else if candidates.length === 0}
		<div class="empty">
			<span class="empty-mark"><Icon name="compass" size={24} /></span>
			<p class="empty-title">Nothing to discover yet</p>
			<p class="empty-hint">
				The model is still learning what you like. Run <strong>Discover now</strong> to fetch a
				fresh batch, or add topics and seed sites under
				<a class="link" href={resolve('/settings')}>Settings → Discover</a>. As you vote and save,
				later runs get sharper.
			</p>
		</div>
	{:else}
		<CardList
			{cards}
			{selectedIndex}
			{scrollNonce}
			empty="No matches"
			emptyHint="No discoveries match your current filters. Try clearing the search or source filter."
			emptyIcon="search"
			onselect={(i) => (selectedIndex = i)}
			discover={{ meta: discoverMeta, onvote: vote, onsave: save, onclear: clearOne, onmute: mute }}
		/>
	{/if}

	{#if clearResult}
		<div class="undo-toast" role="status">
			<span>{clearResult}</span>
		</div>
	{/if}
</section>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.6rem;
	}
	h1 {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		font-size: var(--text-2xl);
	}
	.count {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0;
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.select::after {
		content: '';
		position: absolute;
		right: 0.6rem;
		width: 0.4rem;
		height: 0.4rem;
		border-right: 1.5px solid var(--text-muted);
		border-bottom: 1.5px solid var(--text-muted);
		transform: translateY(-2px) rotate(45deg);
		pointer-events: none;
	}
	select {
		appearance: none;
		font-size: var(--text-sm);
		padding: 0.32rem 1.6rem 0.32rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.search {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 2rem;
		padding: 0 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-muted);
		transition: border-color var(--dur-fast) var(--ease);
	}
	.search:focus-within {
		border-color: var(--border-strong);
	}
	.search input {
		width: 7.5rem;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: var(--text-sm);
		color: var(--text);
	}
	.icon {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.icon:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.icon.on {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.pop-wrap {
		position: relative;
		display: inline-flex;
	}
	.popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 40;
		min-width: 13rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.7rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-md);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.select.block,
	.select.block select {
		width: 100%;
	}
	.select.block {
		display: flex;
	}
	.clear-filters {
		display: inline-flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.3rem;
		height: 2rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}
	.clear-filters:hover {
		background: var(--accent-soft);
	}

	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 40;
		min-width: 12rem;
		padding: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-md);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.45rem 0.55rem;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
	}
	.menu button:hover {
		background: var(--surface-alt);
	}
	.menu button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.menu button.danger {
		color: var(--error);
	}
	.menu button.danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.28rem;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	.icon .badge {
		position: absolute;
		top: -0.4rem;
		right: -0.4rem;
		border: 1.5px solid var(--bg);
	}

	.lede {
		color: var(--text-muted);
		font-size: var(--text-sm);
		max-width: 40rem;
		margin: 0 0 1.4rem;
	}
	.glyph {
		font-size: 0.7rem;
		color: var(--accent);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.btn:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.ghost {
		background: transparent;
		color: var(--text-muted);
	}
	.err {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0 0 1rem;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 4rem 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.empty-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.empty-title {
		margin: 0.2rem 0 0;
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text);
	}
	.empty-hint {
		margin: 0;
		max-width: 26rem;
		font-size: var(--text-base);
		line-height: 1.5;
	}
	.link {
		color: var(--accent);
	}
	.link:hover {
		text-decoration: underline;
	}

	/* "Sources you keep saving": a calm, subordinate hint strip above the list.
	   Quieter than a card — a soft-tinted panel that reads as an aside, not content. */
	.follow-strip {
		margin: 0 0 1.4rem;
		padding: 0.75rem 0.9rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-alt);
	}
	.follow-strip-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.6rem;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.follow-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.follow-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 0.75rem;
	}
	.follow-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.55rem;
		min-width: 0;
	}
	.follow-domain {
		font-weight: 600;
		color: var(--text);
		font-size: var(--text-sm);
	}
	.follow-count {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.follow-sample {
		max-width: 22rem;
		overflow: hidden;
		font-size: var(--text-xs);
		font-style: italic;
		color: var(--text-muted);
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.follow-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}
	.follow-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 1.9rem;
		padding: 0 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.follow-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.follow-btn.ghost {
		padding: 0 0.5rem;
		color: var(--text-muted);
	}
	.follow-btn.ghost:hover:not(:disabled) {
		border-color: var(--border-strong);
		color: var(--text);
		background: transparent;
	}
	.follow-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.undo-toast {
		position: fixed;
		left: 50%;
		bottom: 5.5rem;
		transform: translateX(-50%);
		z-index: 70;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 0.75rem 0.6rem 1rem;
		background: var(--text);
		color: var(--bg);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-md);
		font-size: var(--text-sm);
	}

	/* Mobile: the overflow menu becomes a bottom sheet so its items are always
	   reachable, matching ListView / CardList. */
	@media (max-width: 640px) {
		.menu {
			position: fixed;
			top: auto;
			right: 0;
			left: 0;
			bottom: 0;
			z-index: 41;
			min-width: 0;
			max-height: 70vh;
			overflow-y: auto;
			padding: 0.4rem 0.4rem calc(0.4rem + env(safe-area-inset-bottom));
			border-width: 1px 0 0;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			gap: 2px;
		}
		.menu button {
			padding: 0.7rem 0.65rem;
			font-size: var(--text-md);
		}
	}
</style>
