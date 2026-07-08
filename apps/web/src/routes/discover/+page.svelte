<script lang="ts">
	/**
	 * Discover: the list of articles a background worker found relevant to the
	 * user's interests. Candidates are NOT library documents, so they never touch
	 * Dexie/sync — we call the client directly and hold the result in local
	 * `$state`. Votes and saves apply optimistically through the pure reducer in
	 * `$lib/discover`, rolling back if the server rejects them.
	 */
	import type { DiscoveryCandidate, VoteValue } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import { applyCandidateAction } from '$lib/discover';
	import { SvelteSet } from 'svelte/reactivity';
	import DiscoverList from '$lib/components/DiscoverList.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let candidates = $state<DiscoveryCandidate[]>([]);
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	let triggering = $state(false);
	const busyIds = new SvelteSet<string>();

	onMount(load);

	async function load() {
		loading = true;
		error = undefined;
		try {
			const res = await getClient().listCandidates({ status: 'active' });
			candidates = res.candidates;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load discoveries.';
		} finally {
			loading = false;
		}
	}

	async function vote(id: string, value: VoteValue) {
		if (busyIds.has(id)) return;
		const snapshot = candidates;
		// Optimistic: upvote keeps the row (marked liked), downvote drops it.
		candidates = applyCandidateAction(candidates, {
			type: value === 'up' ? 'upvote' : 'downvote',
			id
		});
		busyIds.add(id);
		try {
			await getClient().voteCandidate(id, value);
		} catch {
			candidates = snapshot; // rollback
		} finally {
			busyIds.delete(id);
		}
	}

	async function save(id: string) {
		if (busyIds.has(id)) return;
		const snapshot = candidates;
		candidates = applyCandidateAction(candidates, { type: 'save', id });
		busyIds.add(id);
		try {
			await getClient().saveCandidate(id);
		} catch {
			candidates = snapshot; // rollback the "Saved" badge
		} finally {
			busyIds.delete(id);
		}
	}

	async function discoverNow() {
		if (triggering) return;
		triggering = true;
		try {
			await getClient().triggerDiscoveryRun();
			await goto(resolve('/discover/activity'));
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not start a discovery run.';
			triggering = false;
		}
	}
</script>

<div class="page">
	<header class="head">
		<h1>Discover</h1>
		<div class="head-actions">
			<a class="btn ghost" href={resolve('/discover/activity')}>
				<Icon name="refresh" size={16} /> Activity
			</a>
			<button type="button" class="btn" disabled={triggering} onclick={discoverNow}>
				<Icon name="compass" size={16} />
				{triggering ? 'Starting…' : 'Discover now'}
			</button>
		</div>
	</header>

	<p class="lede">
		Articles from around the web that match what you read and save. Vote
		<span class="glyph">▲</span> for more like it, <span class="glyph">▼</span> to dismiss, or save one
		to your library.
	</p>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if loading}
		<ul class="skeletons" aria-hidden="true">
			{#each [0, 1, 2, 3] as i (i)}
				<li>
					<span class="sk-line sk-title"></span>
					<span class="sk-line"></span>
				</li>
			{/each}
		</ul>
	{:else if candidates.length === 0}
		<div class="empty">
			<span class="empty-mark"><Icon name="compass" size={24} /></span>
			<p class="empty-title">Nothing to discover yet</p>
			<p class="empty-hint">
				The model is still learning what you like. Run <strong>Discover now</strong> to fetch a
				fresh batch, or add topics and seed sites under
				<a class="link" href={resolve('/settings')}>Settings → Discover</a>. As you vote and save,
				later runs get sharper.
			</p>
		</div>
	{:else}
		<DiscoverList {candidates} {busyIds} onvote={vote} onsave={save} />
	{/if}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 0.6rem;
	}
	h1 {
		font-size: var(--text-2xl);
	}
	.head-actions {
		display: flex;
		gap: 0.5rem;
	}
	.lede {
		color: var(--text-muted);
		font-size: var(--text-sm);
		max-width: 40rem;
		margin: 0 0 1.4rem;
	}
	.glyph {
		font-size: 0.7rem;
		color: var(--accent);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.btn:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.ghost {
		background: transparent;
		color: var(--text-muted);
	}
	.err {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0 0 1rem;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 4rem 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.empty-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.empty-title {
		margin: 0.2rem 0 0;
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text);
	}
	.empty-hint {
		margin: 0;
		max-width: 26rem;
		font-size: var(--text-base);
		line-height: 1.5;
	}
	.link {
		color: var(--accent);
	}
	.link:hover {
		text-decoration: underline;
	}

	.skeletons {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.skeletons li {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.95rem 0.55rem 1.05rem 0.7rem;
		border-bottom: 1px solid var(--border);
	}
	.sk-line {
		height: 0.85rem;
		width: 60%;
		border-radius: var(--radius-sm);
		background: linear-gradient(
			90deg,
			var(--surface-alt) 25%,
			color-mix(in srgb, var(--surface-alt) 55%, transparent) 50%,
			var(--surface-alt) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.3s linear infinite;
	}
	.sk-title {
		height: 1.15rem;
		width: 80%;
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk-line {
			animation: none;
		}
	}
</style>
