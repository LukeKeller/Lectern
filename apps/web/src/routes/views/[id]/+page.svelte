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
	<ListView
		title={view.name}
		predicate={(card: Card) => matchesQuery(card, view.query)}
		sortBy={view.sortBy}
		sortDir={view.sortDir}
		empty="No cards match this view."
	/>
	<p class="query page">{viewQueryString(view.query)}</p>
{:else if viewsStore.loaded}
	<div class="page">
		<h1>View not found</h1>
		<p class="muted">This saved view no longer exists.</p>
	</div>
{:else}
	<p class="muted page">Loading…</p>
{/if}

<style>
	.query {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: 1.5rem auto 0;
	}
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 0.5rem;
	}
	.muted {
		color: var(--text-muted);
	}
</style>
