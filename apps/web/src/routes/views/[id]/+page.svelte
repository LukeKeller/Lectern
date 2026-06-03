<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { matchesQuery } from '$lib/lists';
	import { viewQueryString } from '$lib/views';
	import { viewsStore } from '$lib/views-store.svelte';
	import ListView from '$lib/components/ListView.svelte';

	const id = page.params.id;
	const view = $derived(id ? viewsStore.byId(id) : undefined);

	onMount(() => {
		if (!viewsStore.loaded) void viewsStore.load();
	});
</script>

{#if view}
	<p class="query">{viewQueryString(view.query)}</p>
	<ListView
		title={view.name}
		predicate={(card: Card) => matchesQuery(card, view.query)}
		sortBy={view.sortBy}
		sortDir={view.sortDir}
		empty="No cards match this view."
	/>
{:else if viewsStore.loaded}
	<h1>View not found</h1>
	<p class="muted">This saved view no longer exists.</p>
{:else}
	<p class="muted">Loading…</p>
{/if}

<style>
	.query {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		color: var(--text-muted);
		margin: 0 0 0.5rem;
	}
	.muted {
		color: var(--text-muted);
	}
</style>
