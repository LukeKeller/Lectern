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

<header>
	<h1>{title}</h1>
	<div class="controls">
		<label>
			Sort
			<select bind:value={sortBy}>
				{#each Object.entries(SORT_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		<button
			type="button"
			class="dir"
			onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')}
			aria-label="Toggle sort direction"
		>
			{sortDir === 'asc' ? '↑' : '↓'}
		</button>
		{#if tags.length}
			<label>
				Tag
				<select bind:value={tagFilter}>
					<option value={null}>All</option>
					{#each tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
				</select>
			</label>
		{/if}
		{#if baseQuery}
			{#if saving}
				<form class="save" onsubmit={saveView}>
					<input bind:value={viewName} type="text" placeholder="View name" autocomplete="off" />
					<button type="submit">Save</button>
					<button type="button" onclick={() => (saving = false)}>Cancel</button>
				</form>
			{:else}
				<button type="button" class="dir" onclick={() => (saving = true)}>Save view</button>
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

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h1 {
		margin: 0;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	select {
		font-size: 0.82rem;
		padding: 0.15rem 0.3rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
	}
	.dir {
		padding: 0.1rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface-alt);
		color: var(--text);
		cursor: pointer;
	}
	.save {
		display: flex;
		gap: 0.3rem;
	}
	.save input {
		font-size: 0.82rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
	}
	.save button {
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface-alt);
		color: var(--text);
		cursor: pointer;
		font-size: 0.82rem;
		padding: 0.1rem 0.4rem;
	}
	.error {
		color: var(--error);
		font-size: 0.85rem;
	}
</style>
