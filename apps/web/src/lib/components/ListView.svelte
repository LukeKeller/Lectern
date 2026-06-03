<script lang="ts">
	import type { Card, Location, QueryNode, SortDir, ViewSortBy } from '@lectern/shared';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import { collectTags, filterByTag, filterByReadState, sortCards } from '$lib/lists';
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
		/** When set, show a "hide read" toggle (persisted per key, on by default). */
		hideReadKey?: string;
		/** The query AST this list represents, enabling "save as view". */
		baseQuery?: QueryNode;
		sortBy?: ViewSortBy;
		sortDir?: SortDir;
	} = $props();

	const all = liveCards(() => db.cards.toArray());

	let tagFilter = $state<string | null>(null);
	let selectedIndex = $state(0);

	// Optional read-state filter (the RSS feed enables it). Persisted per key and
	// defaulting to 'unread' so the feed shows unread items first.
	type ReadFilter = 'unread' | 'read' | 'all';
	const READ_FILTERS: { value: ReadFilter; label: string }[] = [
		{ value: 'unread', label: 'Unread' },
		{ value: 'read', label: 'Read' },
		{ value: 'all', label: 'All' }
	];
	const readFilterStorage = $derived(hideReadKey ? `lectern.readFilter.${hideReadKey}` : null);
	let readFilter = $state<ReadFilter>(
		untrack(() => {
			if (!hideReadKey || typeof localStorage === 'undefined') return 'unread';
			const stored = localStorage.getItem(`lectern.readFilter.${hideReadKey}`);
			return stored === 'read' || stored === 'all' ? stored : 'unread';
		})
	);
	$effect(() => {
		if (readFilterStorage && typeof localStorage !== 'undefined') {
			localStorage.setItem(readFilterStorage, readFilter);
		}
	});

	const matched = $derived((all.value ?? []).filter(predicate));
	// Apply the read-state filter only when this list opts in via hideReadKey.
	const afterRead = $derived(hideReadKey ? filterByReadState(matched, readFilter) : matched);
	const tags = $derived(collectTags(afterRead));
	const cards = $derived(sortCards(filterByTag(afterRead, tagFilter), sortBy, sortDir));

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
			void sync.enqueue({
				type: 'setReadingProgress',
				id: card.id,
				readingProgress: 1,
				readAnchor: null
			});
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
			{#if hideReadKey}
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
			{/if}
			{#if tags.length}
				<div class="select">
					<select bind:value={tagFilter} aria-label="Filter by tag">
						<option value={null}>All tags</option>
						{#each tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
					</select>
				</div>
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
