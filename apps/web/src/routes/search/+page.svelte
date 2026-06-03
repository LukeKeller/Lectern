<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';
	import { buildIndex, searchIndex } from '$lib/search';
	import CardList from '$lib/components/CardList.svelte';

	let query = $state('');

	const all = liveCards(() => db.cards.toArray());

	// Rebuild the index whenever the cached library changes; runs fully offline.
	const index = $derived(buildIndex(all.value ?? []));
	const byId = $derived(new Map((all.value ?? []).map((c) => [c.id, c])));

	const results = $derived.by<Card[]>(() => {
		if (!query.trim()) return [];
		return searchIndex(index, query)
			.map((id) => byId.get(id))
			.filter((c): c is Card => c != null);
	});
</script>

<h1>Search</h1>
<input type="search" placeholder="Search your library…" bind:value={query} autocomplete="off" />

{#if query.trim()}
	<p class="muted">{results.length} result{results.length === 1 ? '' : 's'}</p>
	<CardList cards={results} empty="No matches." />
{:else}
	<p class="muted">Search titles, authors, sites, and tags across your whole library.</p>
{/if}

<style>
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 1rem;
		background: var(--surface);
		color: var(--text);
	}
	.muted {
		color: var(--text-muted);
	}
</style>
