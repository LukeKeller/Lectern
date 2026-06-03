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

<div class="page">
	<h1>Views</h1>

	<section>
		<h2>Built-in</h2>
		<ul class="views">
			{#each PREDEFINED_VIEWS as v (v.id)}
				<li>
					<a href={resolve(v.path)}>{v.name}</a>
					<code>{viewQueryString(v.query)}</code>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>Saved</h2>
		{#if viewsStore.views.length === 0}
			<p class="muted">No saved views yet. Create one below or save a filtered list as a view.</p>
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
	</section>

	<section>
		<h2>New view</h2>
		<form onsubmit={create}>
			<label>
				<span>Name</span>
				<input bind:value={name} type="text" placeholder="e.g. Long reads" autocomplete="off" />
			</label>
			<label>
				<span>Query</span>
				<input bind:value={queryText} type="text" placeholder="words:>2000 AND location:later" />
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={pinned} /> Pin to sidebar
			</label>
			<div class="actions">
				<button type="submit" class="btn">Create view</button>
				{#if formError}<span class="error">{formError}</span>{/if}
			</div>
		</form>
	</section>
</div>

<style>
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 1.6rem;
	}
	section {
		margin-bottom: 2rem;
	}
	h2 {
		font-size: var(--text-md);
		margin-bottom: 0.6rem;
	}
	.views {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.views li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.6rem;
		border-radius: var(--radius);
		transition: background var(--dur-fast) var(--ease);
	}
	.views li:hover {
		background: var(--surface-alt);
	}
	.views a {
		color: var(--text);
		font-weight: 600;
	}
	.views a:hover {
		color: var(--accent);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-muted);
		background: var(--surface-alt);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
	}
	.pin {
		font-size: var(--text-2xs);
		letter-spacing: 0.02em;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		max-width: 28rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	label span {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	input[type='text'] {
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-base);
		background: var(--surface);
		color: var(--text);
		transition: border-color var(--dur-fast) var(--ease);
	}
	input[type='text']:focus {
		border-color: var(--accent);
		outline: none;
	}
	.check input {
		width: auto;
		accent-color: var(--accent);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.btn {
		align-self: flex-start;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.btn:hover {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.error {
		color: var(--error);
		font-size: var(--text-sm);
	}
</style>
