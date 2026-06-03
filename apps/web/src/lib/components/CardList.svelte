<script lang="ts">
	import type { Card, Location } from '@lectern/shared';
	import { resolve } from '$app/paths';
	import { getSync } from '$lib/sync';

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
</script>

{#if !cards}
	<p class="muted">Loading…</p>
{:else if cards.length === 0}
	<p class="muted">{empty}</p>
{:else}
	<ul>
		{#each cards as card, i (card.id)}
			<li class:selected={i === selectedIndex}>
				<a
					class="title"
					href={resolve('/read/[id]', { id: card.id })}
					onmouseenter={() => onselect?.(i)}>{card.title}</a
				>
				<div class="meta">
					{card.siteName ?? card.author ?? new URL(card.url).hostname}
					· {card.location}
					{#if card.readingTimeMinutes}· {card.readingTimeMinutes} min{/if}
					{#if card.readingProgress > 0}· {Math.round(card.readingProgress * 100)}%{/if}
				</div>
				{#if card.tags.length}
					<div class="tags">
						{#each card.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
					</div>
				{/if}
				{#if actions.length}
					<div class="actions">
						{#each actions as action (action.location)}
							<button type="button" onclick={() => triage(card.id, action.location)}>
								{action.label}
							</button>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		padding: 0.75rem;
		margin: 0 -0.75rem;
		border-bottom: 1px solid var(--border);
		border-left: 3px solid transparent;
	}
	li.selected {
		border-left-color: var(--accent);
		background: var(--surface-alt);
	}
	.title {
		font-weight: 600;
		color: var(--text);
		text-decoration: none;
	}
	.meta {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 0.2rem;
	}
	.tags {
		margin-top: 0.3rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.tag {
		font-size: 0.72rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.actions {
		margin-top: 0.4rem;
		display: flex;
		gap: 0.4rem;
	}
	button {
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface-alt);
		color: var(--text);
		cursor: pointer;
	}
	.muted {
		color: var(--text-muted);
	}
</style>
