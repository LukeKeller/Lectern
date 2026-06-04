<script lang="ts">
	import type {
		Card,
		Category,
		Location,
		QueryNode,
		SortDir,
		Source,
		ViewSortBy
	} from '@lectern/shared';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import {
		collectCategories,
		collectSources,
		collectTags,
		filterByCategory,
		filterByReadState,
		filterBySource,
		filterByTag,
		filterByText,
		sortCards
	} from '$lib/lists';
	import { andQueries, tagQuery } from '$lib/views';
	import { viewsStore } from '$lib/views-store.svelte';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import CardList from './CardList.svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface TriageAction {
		label: string;
		location: Location;
	}

	let {
		title,
		predicate,
		actions = [],
		empty = 'Nothing here.',
		emptyIcon = 'inbox',
		hideReadKey = undefined,
		baseQuery,
		sortBy = $bindable<ViewSortBy>('updatedAt'),
		sortDir = $bindable<SortDir>('desc')
	}: {
		title: string;
		predicate: (card: Card) => boolean;
		actions?: TriageAction[];
		empty?: string;
		emptyIcon?: IconName;
		/**
		 * Opts this list into a default of showing only unread items. The read-state
		 * control is present on every list regardless; when set, this also names the
		 * persistence key (otherwise the list title is used).
		 */
		hideReadKey?: string;
		/** The query AST this list represents, enabling "save as view". */
		baseQuery?: QueryNode;
		sortBy?: ViewSortBy;
		sortDir?: SortDir;
	} = $props();

	const all = liveCards(() => db.cards.toArray());

	let selectedIndex = $state(0);

	// Per-list filter facets. The storage key derives from hideReadKey (so the
	// feed keeps its existing key) and otherwise falls back to the list title.
	const listKey = $derived(hideReadKey ?? title);

	type ReadFilter = 'unread' | 'read' | 'all';
	type SourceFilter = Source | 'all';
	type CategoryFilter = Category | 'all';

	const READ_FILTERS: { value: ReadFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'unread', label: 'Unread' },
		{ value: 'read', label: 'Read' }
	];
	const SOURCE_LABELS: Record<Source, string> = { miniflux: 'RSS', readeck: 'Saved' };
	const CATEGORY_LABELS: Record<Category, string> = {
		article: 'Article',
		rss: 'RSS',
		email: 'Email',
		pdf: 'PDF'
	};

	// Read-state defaults to 'unread' only on lists that opt in via hideReadKey
	// (the feed), preserving the prior default; every other list defaults to 'all'
	// but still gets the always-present control.
	const defaultRead: ReadFilter = untrack(() => (hideReadKey ? 'unread' : 'all'));
	const readFilterStorage = $derived(`lectern.readFilter.${listKey}`);
	let readFilter = $state<ReadFilter>(
		untrack(() => {
			if (typeof localStorage === 'undefined') return defaultRead;
			const stored = localStorage.getItem(`lectern.readFilter.${hideReadKey ?? title}`);
			return stored === 'read' || stored === 'all' || stored === 'unread' ? stored : defaultRead;
		})
	);
	$effect(() => {
		if (typeof localStorage !== 'undefined') localStorage.setItem(readFilterStorage, readFilter);
	});

	// The remaining facets persist together as one JSON blob, SSR-guarded.
	interface StoredFilters {
		source?: SourceFilter;
		category?: CategoryFilter;
		tag?: string | null;
		text?: string;
	}
	const filterStorage = $derived(`lectern.filters.${listKey}`);
	const storedFilters: StoredFilters = untrack(() => {
		if (typeof localStorage === 'undefined') return {};
		try {
			const raw = localStorage.getItem(`lectern.filters.${hideReadKey ?? title}`);
			return raw ? (JSON.parse(raw) as StoredFilters) : {};
		} catch {
			return {};
		}
	});
	let sourceFilter = $state<SourceFilter>(storedFilters.source ?? 'all');
	let categoryFilter = $state<CategoryFilter>(storedFilters.category ?? 'all');
	let tagFilter = $state<string | null>(storedFilters.tag ?? null);
	let textFilter = $state(storedFilters.text ?? '');
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const payload: StoredFilters = {
			source: sourceFilter,
			category: categoryFilter,
			tag: tagFilter,
			text: textFilter
		};
		localStorage.setItem(filterStorage, JSON.stringify(payload));
	});

	// Compose the facets in a fixed pipeline. The option lists for the dependent
	// facets are derived from the set produced by the earlier facets, so they only
	// ever offer choices that can still match.
	const matched = $derived((all.value ?? []).filter(predicate));
	const afterRead = $derived(filterByReadState(matched, readFilter));
	const afterSource = $derived(filterBySource(afterRead, sourceFilter));
	const afterCategory = $derived(filterByCategory(afterSource, categoryFilter));
	const afterTag = $derived(filterByTag(afterCategory, tagFilter));
	const sources = $derived(collectSources(afterRead));
	const categories = $derived(collectCategories(afterSource));
	const tags = $derived(collectTags(afterCategory));
	const cards = $derived(sortCards(filterByText(afterTag, textFilter), sortBy, sortDir));

	const activeCount = $derived(
		(readFilter !== defaultRead ? 1 : 0) +
			(sourceFilter !== 'all' ? 1 : 0) +
			(categoryFilter !== 'all' ? 1 : 0) +
			(tagFilter ? 1 : 0) +
			(textFilter.trim() ? 1 : 0)
	);
	function clearFilters() {
		readFilter = defaultRead;
		sourceFilter = 'all';
		categoryFilter = 'all';
		tagFilter = null;
		textFilter = '';
	}

	// Drop a facet selection once an upstream facet makes it impossible to match,
	// so a stale dropdown never points at a value with no option. Guarded on a
	// non-empty upstream set so a persisted facet is not wiped before the cards
	// have loaded (the upstream set is briefly empty during hydration). None of
	// these reads feed back into their own option list, so there is no loop.
	$effect(() => {
		if (afterRead.length && sourceFilter !== 'all' && !sources.includes(sourceFilter)) {
			sourceFilter = 'all';
		}
	});
	$effect(() => {
		if (afterSource.length && categoryFilter !== 'all' && !categories.includes(categoryFilter)) {
			categoryFilter = 'all';
		}
	});
	$effect(() => {
		if (afterCategory.length && tagFilter && !tags.includes(tagFilter)) tagFilter = null;
	});

	// Keep the selection inside the (reactively changing) list bounds.
	$effect(() => {
		if (selectedIndex >= cards.length) selectedIndex = Math.max(0, cards.length - 1);
	});

	function triageById(id: string, location: Location) {
		const sync = getSync();
		void sync.enqueue({ type: 'setLocation', id, location }).then(() => sync.flush());
	}

	// Bulk actions over the currently-visible cards, routed through the sync outbox.
	function markAllRead() {
		const sync = getSync();
		let queued = false;
		for (const card of cards) {
			if (card.readState === 'finished') continue;
			// RSS items need their MiniFlux read flag flipped (markRead); saved
			// articles have no read flag, so fall back to completing progress.
			if (card.source === 'miniflux') {
				void sync.enqueue({ type: 'markRead', id: card.id, read: true });
			} else {
				void sync.enqueue({
					type: 'setReadingProgress',
					id: card.id,
					readingProgress: 1,
					readAnchor: null
				});
			}
			queued = true;
		}
		if (queued) void sync.flush();
	}
	function archiveAll() {
		const sync = getSync();
		let queued = false;
		for (const card of cards) {
			if (card.location === 'archive') continue;
			void sync.enqueue({ type: 'setLocation', id: card.id, location: 'archive' });
			queued = true;
		}
		if (queued) void sync.flush();
	}

	function openCard(card: Card | undefined) {
		if (card) void goto(resolve('/read/[id]', { id: card.id }));
	}

	const controller: ListController = {
		move(delta) {
			if (cards.length === 0) return;
			selectedIndex = Math.min(cards.length - 1, Math.max(0, selectedIndex + delta));
		},
		open() {
			openCard(cards[selectedIndex]);
		},
		triage(location) {
			const card = cards[selectedIndex];
			// Selection index stays put so the next card slides into focus.
			if (card) triageById(card.id, location);
		}
	};

	onMount(() => {
		activeList.set(controller);
		void getSync().pull();
		return () => activeList.clear(controller);
	});

	const SORT_LABELS: Record<ViewSortBy, string> = {
		savedAt: 'Saved',
		updatedAt: 'Updated',
		title: 'Title',
		wordCount: 'Length',
		readingProgress: 'Progress'
	};

	let saving = $state(false);
	let viewName = $state('');
	let saveError = $state<string | undefined>(undefined);

	async function saveView(event: SubmitEvent) {
		event.preventDefault();
		if (!baseQuery) return;
		const name = viewName.trim();
		if (!name) return;
		// Fold the active tag filter into the saved query so the view reproduces it.
		const query = tagFilter ? andQueries(baseQuery, tagQuery(tagFilter)) : baseQuery;
		const view = await viewsStore.create({ name, query, pinned: true, sortBy, sortDir });
		if (view) {
			saving = false;
			viewName = '';
			saveError = undefined;
		} else {
			saveError = viewsStore.error ?? 'Could not save view';
		}
	}
</script>

<section class="list page">
	<header class="head">
		<h1>
			{title}
			{#if cards.length}<span class="count">{cards.length}</span>{/if}
		</h1>
		<div class="tools">
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
			{#if sources.length > 1}
				<div class="select">
					<select bind:value={sourceFilter} aria-label="Filter by source">
						<option value="all">All sources</option>
						{#each sources as src (src)}<option value={src}>{SOURCE_LABELS[src]}</option>{/each}
					</select>
				</div>
			{/if}
			{#if categories.length > 1}
				<div class="select">
					<select bind:value={categoryFilter} aria-label="Filter by category">
						<option value="all">All types</option>
						{#each categories as cat (cat)}
							<option value={cat}>{CATEGORY_LABELS[cat]}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="seg" role="group" aria-label="Filter by read state">
				{#each READ_FILTERS as opt (opt.value)}
					<button
						type="button"
						class:active={readFilter === opt.value}
						aria-pressed={readFilter === opt.value}
						onclick={() => (readFilter = opt.value)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
			{#if tags.length}
				<div class="select">
					<select bind:value={tagFilter} aria-label="Filter by tag">
						<option value={null}>All tags</option>
						{#each tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
					</select>
				</div>
			{/if}
			{#if activeCount}
				<button type="button" class="ghost clear" onclick={clearFilters} title="Clear all filters">
					<Icon name="close" size={14} />
					Clear
					<span class="badge">{activeCount}</span>
				</button>
			{/if}
			{#if cards.length}
				<div class="bulk" role="group" aria-label="Bulk actions">
					<button
						type="button"
						class="ghost"
						onclick={markAllRead}
						title="Mark all visible items read"
					>
						<Icon name="check" size={15} />
						Mark all read
					</button>
					<button
						type="button"
						class="ghost"
						onclick={archiveAll}
						title="Archive all visible items"
					>
						<Icon name="archive" size={15} />
						Archive all
					</button>
				</div>
			{/if}
			{#if baseQuery}
				{#if saving}
					<form class="save" onsubmit={saveView}>
						<input bind:value={viewName} type="text" placeholder="View name" autocomplete="off" />
						<button type="submit" class="text">Save</button>
						<button type="button" class="text" onclick={() => (saving = false)}>Cancel</button>
					</form>
				{:else}
					<button
						type="button"
						class="icon save-btn"
						onclick={() => (saving = true)}
						title="Save as view"
					>
						<Icon name="bookmark" size={16} />
					</button>
				{/if}
			{/if}
		</div>
	</header>

	{#if saveError}<p class="error">{saveError}</p>{/if}

	<CardList
		{cards}
		{actions}
		{empty}
		{emptyIcon}
		{selectedIndex}
		ontriage={triageById}
		onselect={(i) => (selectedIndex = i)}
	/>
</section>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1.1rem;
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
	.seg {
		display: flex;
		gap: 0.2rem;
		padding: 0.2rem;
		background: var(--surface-alt);
		border-radius: var(--radius);
	}
	.seg button {
		padding: 0.3rem 0.6rem;
		border: 0;
		border-radius: calc(var(--radius) - 3px);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
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
	.bulk {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 2rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.ghost:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.clear {
		color: var(--accent);
	}
	.clear:hover {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.3rem;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	.save {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.save input {
		font-size: var(--text-sm);
		padding: 0.32rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}
	.text {
		border: 0;
		background: transparent;
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		padding: 0.32rem 0.4rem;
		cursor: pointer;
	}
	.error {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0 0 0.75rem;
	}
</style>
