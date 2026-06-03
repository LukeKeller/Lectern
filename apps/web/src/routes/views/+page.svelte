<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { PREDEFINED_VIEWS, parseViewQuery, viewQueryString } from '$lib/views';
	import { viewsStore } from '$lib/views-store.svelte';

	let name = $state('');
	let queryText = $state('location:later');
	let pinned = $state(true);
	let formError = $state<string | undefined>(undefined);

	onMount(() => {
		if (!viewsStore.loaded) void viewsStore.load();
	});

	async function create(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			formError = 'Name is required';
			return;
		}
		let query;
		try {
			query = parseViewQuery(queryText);
		} catch (err) {
			formError = err instanceof Error ? err.message : 'Invalid query';
			return;
		}
		const view = await viewsStore.create({
			name: trimmed,
			query,
			pinned,
			sortBy: 'savedAt',
			sortDir: 'desc'
		});
		if (view) {
			name = '';
			formError = undefined;
		} else {
			formError = viewsStore.error ?? 'Could not save view';
		}
	}
</script>

<h1>Views</h1>

<h2>Built-in</h2>
<ul class="views">
	{#each PREDEFINED_VIEWS as v (v.id)}
		<li><a href={resolve(v.path)}>{v.name}</a> <code>{viewQueryString(v.query)}</code></li>
	{/each}
</ul>

<h2>Saved</h2>
{#if viewsStore.views.length === 0}
	<p class="muted">No saved views yet.</p>
{:else}
	<ul class="views">
		{#each viewsStore.views as v (v.id)}
			<li>
				<a href={resolve('/views/[id]', { id: v.id })}>{v.name}</a>
				{#if v.pinned}<span class="pin">pinned</span>{/if}
				<code>{viewQueryString(v.query)}</code>
			</li>
		{/each}
	</ul>
{/if}

<h2>New view</h2>
<form onsubmit={create}>
	<label>
		Name
		<input bind:value={name} type="text" placeholder="e.g. Long reads" autocomplete="off" />
	</label>
	<label>
		Query
		<input bind:value={queryText} type="text" placeholder="words:>2000 AND location:later" />
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={pinned} /> Pin to nav
	</label>
	<button type="submit">Create view</button>
	{#if formError}<span class="error">{formError}</span>{/if}
</form>

<style>
	h2 {
		font-size: 1rem;
		color: var(--text-muted);
		margin-bottom: 0.3rem;
	}
	.views {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
	}
	.views li {
		padding: 0.3rem 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.views a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	code {
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.pin {
		font-size: 0.72rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 460px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}
	input {
		padding: 0.4rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 1rem;
		background: var(--surface);
		color: var(--text);
	}
	.check input {
		width: auto;
	}
	button {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-alt);
		color: var(--text);
		cursor: pointer;
	}
	.error {
		color: var(--error);
		font-size: 0.85rem;
	}
</style>
