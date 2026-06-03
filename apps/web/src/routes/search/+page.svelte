<script lang="ts">
	import type { Card, SearchResult } from '@lectern/shared';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getClient } from '$lib/config';
	import { liveCards } from '$lib/live.svelte';
	import { buildIndex, searchIndex } from '$lib/search';
	import CardList from '$lib/components/CardList.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let query = $state('');

	const all = liveCards(() => db.cards.toArray());

	// Rebuild the index whenever the cached library changes; runs fully offline.
	const index = $derived(buildIndex(all.value ?? []));
	const byId = $derived(new Map((all.value ?? []).map((c) => [c.id, c])));

	// Offline-first: instant metadata matches (title/author/site/tags) from the
	// local MiniSearch index.
	const metaResults = $derived.by<Card[]>(() => {
		if (!query.trim()) return [];
		return searchIndex(index, query)
			.map((id) => byId.get(id))
			.filter((c): c is Card => c != null);
	});

	// Online add-on: full-text matches inside article bodies from the server,
	// debounced. Failures (offline / unsupported) fall back to metadata only.
	let bodyHits = $state<SearchResult[]>([]);
	$effect(() => {
		const q = query.trim();
		if (!q) {
			bodyHits = [];
			return;
		}
		let cancelled = false;
		const t = setTimeout(async () => {
			try {
				const res = await getClient().search(q, 20);
				if (!cancelled) bodyHits = res.results;
			} catch {
				if (!cancelled) bodyHits = [];
			}
		}, 200);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	});

	// Body matches not already surfaced by the metadata search, with their snippet.
	const bodyOnly = $derived.by(() => {
		const seen = new Set(metaResults.map((c) => c.id));
		return bodyHits
			.filter((h) => !seen.has(h.id) && byId.has(h.id))
			.map((h) => ({ card: byId.get(h.id) as Card, snippet: h.snippet }));
	});
</script>

<div class="page">
	<h1>Search</h1>
	<div class="searchbox">
		<Icon name="search" size={18} />
		<input type="search" placeholder="Search your library…" bind:value={query} autocomplete="off" />
	</div>

	{#if query.trim()}
		<p class="muted">
			{metaResults.length} match{metaResults.length === 1 ? '' : 'es'} in titles & tags
		</p>
		<CardList cards={metaResults} empty="No title or tag matches." emptyIcon="search" />

		{#if bodyOnly.length}
			<h2 class="section">In article text</h2>
			<ul class="body-hits">
				{#each bodyOnly as hit (hit.card.id)}
					<li>
						<a href={resolve('/read/[id]', { id: hit.card.id })}>
							<span class="bh-title">{hit.card.title || hit.card.url}</span>
							<span class="bh-snippet">{hit.snippet}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<p class="muted">
			Search titles, authors, sites, and tags instantly — plus the full text of articles you've
			opened or saved.
		</p>
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
	.section {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 1.6rem 0 0.6rem;
	}
	.body-hits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.body-hits a {
		display: block;
		padding: 0.7rem 0.85rem;
		border-radius: var(--radius-lg);
		transition: background var(--dur-fast) var(--ease);
	}
	.body-hits a:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
	}
	.bh-title {
		display: block;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 0.2rem;
	}
	.bh-snippet {
		display: block;
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.45;
	}
</style>
