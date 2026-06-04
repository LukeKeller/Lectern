<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { PREDEFINED_VIEWS, parseViewQuery, viewQueryString } from '$lib/views';
	import { viewsStore } from '$lib/views-store.svelte';
	import { matchesQuery } from '$lib/lists';
	import { liveCards } from '$lib/live.svelte';
	import { db } from '$lib/db';
	import Icon from '$lib/components/Icon.svelte';
	import type { Card } from '@lectern/shared';

	let name = $state('');
	let queryText = $state('location:later');
	let pinned = $state(true);
	let formError = $state<string | undefined>(undefined);
	let icon = $state('');
	const allCards = liveCards(() => db.cards.toArray());

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
			icon: icon.trim() || null,
			position: 0,
			sortBy: 'savedAt',
			sortDir: 'desc'
		});
		if (view) {
			name = '';
			icon = '';
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
				{#each viewsStore.sorted as v, i (v.id)}
					{@const n = ((allCards.value ?? []) as Card[]).filter((c) =>
						matchesQuery(c, v.query)
					).length}
					<li>
						<input
							class="emoji-input"
							value={v.icon ?? ''}
							maxlength="2"
							placeholder="📑"
							aria-label={`Icon for ${v.name}`}
							onchange={(e) =>
								viewsStore.update(v.id, { icon: e.currentTarget.value.trim() || null })}
						/>
						<a class="vname" href={resolve('/views/[id]', { id: v.id })}>{v.name}</a>
						{#if n > 0}<span class="count">{n}</span>{/if}
						<code>{viewQueryString(v.query)}</code>
						<div class="row-actions">
							<button
								type="button"
								class="ic"
								title="Move up"
								aria-label="Move up"
								disabled={i === 0}
								onclick={() => viewsStore.move(v.id, 'up')}>↑</button
							>
							<button
								type="button"
								class="ic"
								title="Move down"
								aria-label="Move down"
								disabled={i === viewsStore.sorted.length - 1}
								onclick={() => viewsStore.move(v.id, 'down')}>↓</button
							>
							<button
								type="button"
								class="ic"
								class:on={v.pinned}
								title={v.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
								aria-pressed={v.pinned}
								onclick={() => viewsStore.update(v.id, { pinned: !v.pinned })}
							>
								<Icon name="bookmark" size={14} />
							</button>
							<button
								type="button"
								class="ic danger"
								title="Delete view"
								aria-label="Delete view"
								onclick={() => viewsStore.remove(v.id)}
							>
								<Icon name="close" size={14} />
							</button>
						</div>
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
				<span>Icon (emoji, optional)</span>
				<input bind:value={icon} type="text" maxlength="2" placeholder="📚" autocomplete="off" />
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
	.emoji-input {
		width: 2.2rem;
		flex-shrink: 0;
		text-align: center;
		padding: 0.3rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: 1rem;
	}
	.count {
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.row-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	.ic {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-size: var(--text-sm);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.ic:hover:not(:disabled) {
		background: var(--surface);
		color: var(--text);
	}
	.ic:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.ic.on {
		color: var(--accent);
	}
	.ic.danger:hover {
		color: var(--error);
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
