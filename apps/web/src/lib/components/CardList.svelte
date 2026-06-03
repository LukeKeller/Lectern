<script lang="ts">
	import type { Card, Location } from '@lectern/shared';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import Icon from './Icon.svelte';

	interface TriageAction {
		label: string;
		location: Location;
	}

	let {
		cards,
		actions = [],
		empty = 'Nothing here.',
		selectedIndex = -1,
		ontriage,
		onselect
	}: {
		cards: Card[] | undefined;
		actions?: TriageAction[];
		empty?: string;
		selectedIndex?: number;
		ontriage?: (id: string, location: Location) => void;
		onselect?: (index: number) => void;
	} = $props();

	async function defaultTriage(id: string, location: Location) {
		const sync = getSync();
		await sync.enqueue({ type: 'setLocation', id, location });
		void sync.flush();
	}

	function triage(id: string, location: Location) {
		if (ontriage) ontriage(id, location);
		else void defaultTriage(id, location);
	}

	let savingId = $state<string | null>(null);

	// Pull a MiniFlux entry into the library as a saved "read later" document,
	// then refresh the local mirror so it appears immediately.
	async function saveToLater(card: Card) {
		savingId = card.id;
		try {
			await getClient().saveDocument({ url: card.url, tags: [], location: 'later' });
			await getSync().pull();
		} finally {
			savingId = null;
		}
	}

	function hostname(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	/** Compact, de-duplicated metadata line: source · author · reading time. */
	function meta(card: Card): string {
		const source = card.siteName ?? hostname(card.url);
		const parts: string[] = [source];
		if (card.author && card.author !== source) parts.push(card.author);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min`);
		return parts.join('  ·  ');
	}

	const finished = (card: Card) => card.readingProgress >= 0.99;
</script>

{#if !cards}
	<p class="state">Loading…</p>
{:else if cards.length === 0}
	<p class="state">{empty}</p>
{:else}
	<ul class="cards">
		{#each cards as card, i (card.id)}
			<li class:selected={i === selectedIndex}>
				<article class="card" onmouseenter={() => onselect?.(i)}>
					<a class="title" href={resolve('/read/[id]', { id: card.id })}>{card.title}</a>
					{#if card.note}<p class="dek">{card.note}</p>{/if}
					<div class="meta">
						<span class="src">{meta(card)}</span>
						{#if finished(card)}
							<span class="done">Read</span>
						{:else if card.readingProgress > 0}
							<span class="pct">{Math.round(card.readingProgress * 100)}%</span>
						{/if}
						{#if card.highlightCount > 0}
							<span class="hl"><Icon name="highlight" size={13} />{card.highlightCount}</span>
						{/if}
					</div>
					{#if card.tags.length}
						<div class="tags">
							{#each card.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
						</div>
					{/if}
					{#if actions.length || card.source === 'miniflux'}
						<div class="actions">
							{#each actions as action (action.location)}
								<button type="button" onclick={() => triage(card.id, action.location)}>
									{action.label}
								</button>
							{/each}
							{#if card.source === 'miniflux'}
								<button
									type="button"
									class="primary"
									onclick={() => saveToLater(card)}
									disabled={savingId === card.id}
								>
									{savingId === card.id ? 'Saving…' : 'Read later'}
								</button>
							{/if}
						</div>
					{/if}
					{#if card.readingProgress > 0 && !finished(card)}
						<div
							class="track"
							aria-hidden="true"
							style={`--p:${Math.round(card.readingProgress * 100)}%`}
						></div>
					{/if}
				</article>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.card {
		position: relative;
		padding: 0.95rem 0.85rem 1.05rem;
		border-radius: var(--radius-lg);
		transition: background var(--dur-fast) var(--ease);
	}
	li.selected .card {
		background: var(--surface-alt);
	}
	li.selected .card::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.85rem;
		bottom: 0.85rem;
		width: 3px;
		border-radius: var(--radius-full);
		background: var(--accent);
	}
	.card:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
	}

	.title {
		display: inline;
		font-size: var(--text-md);
		font-weight: 620;
		line-height: 1.32;
		color: var(--text);
		letter-spacing: -0.01em;
		transition: color var(--dur-fast) var(--ease);
	}
	.card:hover .title,
	li.selected .title {
		color: var(--accent);
	}
	.dek {
		margin: 0.3rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.src {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pct,
	.done {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.done {
		color: var(--ok);
	}
	.hl {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.tags {
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.tag {
		font-size: var(--text-2xs);
		letter-spacing: 0.02em;
		padding: 0.12rem 0.5rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		color: var(--text-muted);
	}

	.actions {
		margin-top: 0.7rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease);
	}
	.card:hover .actions,
	li.selected .actions,
	.card:focus-within .actions {
		opacity: 1;
	}
	@media (hover: none) {
		.actions {
			opacity: 1;
		}
	}
	.actions button {
		font-size: var(--text-sm);
		font-weight: 500;
		padding: 0.25rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.actions button:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.actions button.primary:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.actions button:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.track {
		position: absolute;
		left: 0.85rem;
		right: 0.85rem;
		bottom: 0.45rem;
		height: 2px;
		border-radius: var(--radius-full);
		background: var(--border);
		overflow: hidden;
	}
	.track::after {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--p);
		background: var(--accent);
		border-radius: var(--radius-full);
	}

	.state {
		color: var(--text-muted);
		padding: 1.5rem 0.85rem;
	}
</style>
