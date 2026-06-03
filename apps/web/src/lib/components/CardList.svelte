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
		empty = 'Nothing here.'
	}: {
		cards: Card[] | undefined;
		actions?: TriageAction[];
		empty?: string;
	} = $props();

	async function triage(id: string, location: Location) {
		const sync = getSync();
		await sync.enqueue({ type: 'setLocation', id, location });
		void sync.flush();
	}
</script>

{#if !cards}
	<p class="muted">Loading…</p>
{:else if cards.length === 0}
	<p class="muted">{empty}</p>
{:else}
	<ul>
		{#each cards as card (card.id)}
			<li>
				<a class="title" href={resolve('/read/[id]', { id: card.id })}>{card.title}</a>
				<div class="meta">
					{card.siteName ?? card.author ?? new URL(card.url).hostname}
					· {card.location}
					{#if card.readingTimeMinutes}· {card.readingTimeMinutes} min{/if}
				</div>
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
		padding: 0.75rem 0;
		border-bottom: 1px solid #e4e7eb;
	}
	.title {
		font-weight: 600;
		color: #1f2933;
		text-decoration: none;
	}
	.meta {
		font-size: 0.85rem;
		color: #7b8794;
		margin-top: 0.2rem;
	}
	.actions {
		margin-top: 0.4rem;
		display: flex;
		gap: 0.4rem;
	}
	button {
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid #cbd2d9;
		border-radius: 4px;
		background: #f5f7fa;
		cursor: pointer;
	}
	.muted {
		color: #7b8794;
	}
</style>
