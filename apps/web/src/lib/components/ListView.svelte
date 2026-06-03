<script lang="ts">
	import type { Card, Location, QueryNode, SortDir, ViewSortBy } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import { collectTags, filterByTag, sortCards } from '$lib/lists';
	import { andQueries, tagQuery } from '$lib/views';
	import { viewsStore } from '$lib/views-store.svelte';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import CardList from './CardList.svelte';
	import Icon from './Icon.svelte';

	interface TriageAction {
		label: string;
		location: Location;
	}

	let {
		title,
		predicate,
		actions = [],
		empty = 'Nothing here.',
		baseQuery,
		sortBy = $bindable<ViewSortBy>('updatedAt'),
		sortDir = $bindable<SortDir>('desc')
	}: {
		title: string;
		predicate: (card: Card) => boolean;
		actions?: TriageAction[];
		empty?: string;
		/** The query AST this list represents, enabling "save as view". */
		baseQuery?: QueryNode;
		sortBy?: ViewSortBy;
		sortDir?: SortDir;
	} = $props();

	const all = liveCards(() => db.cards.toArray());

	let tagFilter = $state<string | null>(null);
	let selectedIndex = $state(0);

	const matched = $derived((all.value ?? []).filter(predicate));
	const tags = $derived(collectTags(matched));
	const cards = $derived(sortCards(filterByTag(matched, tagFilter), sortBy, sortDir));

	// Keep the selection inside the (reactively changing) list bounds.
	$effect(() => {
		if (selectedIndex >= cards.length) selectedIndex = Math.max(0, cards.length - 1);
	});

	function triageById(id: string, location: Location) {
		const sync = getSync();
		void sync.enqueue({ type: 'setLocation', id, location }).then(() => sync.flush());
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
			{#if tags.length}
				<div class="select">
					<select bind:value={tagFilter} aria-label="Filter by tag">
						<option value={null}>All tags</option>
						{#each tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
					</select>
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
