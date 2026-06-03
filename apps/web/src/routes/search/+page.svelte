<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';
	import { buildIndex, searchIndex } from '$lib/search';
	import CardList from '$lib/components/CardList.svelte';
	import Icon from '$lib/components/Icon.svelte';

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

<div class="page">
	<h1>Search</h1>
	<div class="searchbox">
		<Icon name="search" size={18} />
		<input type="search" placeholder="Search your library…" bind:value={query} autocomplete="off" />
	</div>

	{#if query.trim()}
		<p class="muted">{results.length} result{results.length === 1 ? '' : 's'}</p>
		<CardList cards={results} empty="No matches." emptyIcon="search" />
	{:else}
		<p class="muted">Search titles, authors, sites, and tags across your whole library.</p>
	{/if}
</div>

<style>
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 1.1rem;
	}
	.searchbox {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-muted);
		transition: border-color var(--dur-fast) var(--ease);
	}
	.searchbox:focus-within {
		border-color: var(--accent);
		color: var(--accent);
	}
	input {
		flex: 1;
		padding: 0.65rem 0;
		border: 0;
		font-size: var(--text-md);
		background: transparent;
		color: var(--text);
		outline: none;
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--text-sm);
		margin: 1rem 0;
	}
</style>
