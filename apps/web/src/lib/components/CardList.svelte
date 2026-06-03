<script lang="ts">
	import type { Card, Location } from '@lectern/shared';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import Icon, { type IconName } from './Icon.svelte';
	import SourceAvatar from './SourceAvatar.svelte';

	interface TriageAction {
		label: string;
		location: Location;
	}

	let {
		cards,
		actions = [],
		empty = 'Nothing here.',
		emptyIcon = 'inbox',
		selectedIndex = -1,
		ontriage,
		onselect
	}: {
		cards: Card[] | undefined;
		actions?: TriageAction[];
		empty?: string;
		emptyIcon?: IconName;
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

	/** Relative "saved" stamp, kept terse to fit the meta row. */
	function savedAgo(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		const day = 86_400_000;
		const diff = Date.now() - t;
		if (diff < day) return 'today';
		if (diff < 2 * day) return 'yesterday';
		const days = Math.floor(diff / day);
		if (days < 7) return `${days}d`;
		if (days < 30) return `${Math.floor(days / 7)}w`;
		if (days < 365) return `${Math.floor(days / 30)}mo`;
		return `${Math.floor(days / 365)}y`;
	}

	const finished = (card: Card) => card.readingProgress >= 0.99;
</script>

{#if !cards}
	<ul class="cards" aria-hidden="true">
		{#each [0, 1, 2, 3] as i (i)}
			<li><div class="skeleton"><span class="sk-av"></span><span class="sk-lines"></span></div></li>
		{/each}
	</ul>
{:else if cards.length === 0}
	<div class="empty">
		<span class="empty-mark"><Icon name={emptyIcon} size={26} /></span>
		<p>{empty}</p>
	</div>
{:else}
	<ul class="cards">
		{#each cards as card, i (card.id)}
			<li class:selected={i === selectedIndex}>
				<article class="card" onmouseenter={() => onselect?.(i)}>
					<SourceAvatar url={card.url} siteName={card.siteName} />
					<div class="body">
						<a class="title" href={resolve('/read/[id]', { id: card.id })}>
							{card.title || hostname(card.url)}
						</a>
						{#if card.note}<p class="dek">{card.note}</p>{/if}
						<div class="meta">
							<span class="src">{meta(card)}</span>
							{#if savedAgo(card.savedAt)}
								<span class="dot" aria-hidden="true">·</span>
								<span class="when">{savedAgo(card.savedAt)}</span>
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
					</div>
					<div class="aside">
						{#if finished(card)}
							<span class="badge done" title="Finished"><Icon name="check" size={15} /></span>
						{:else if card.readingProgress > 0}
							<span
								class="ring"
								style={`--p:${Math.round(card.readingProgress * 100)}`}
								title={`${Math.round(card.readingProgress * 100)}% read`}
							>
								<svg viewBox="0 0 36 36" width="26" height="26" aria-hidden="true">
									<circle class="ring-bg" cx="18" cy="18" r="15.5" pathLength="100" />
									<circle class="ring-fg" cx="18" cy="18" r="15.5" pathLength="100" />
								</svg>
							</span>
						{/if}
					</div>
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
		gap: 1px;
	}
	.card {
		position: relative;
		display: flex;
		gap: 0.85rem;
		padding: 0.8rem 0.85rem;
		border-radius: var(--radius-lg);
		transition:
			background var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease);
	}
	.card:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
		box-shadow: var(--shadow-sm);
	}
	li.selected .card {
		background: var(--accent-soft);
		box-shadow: var(--shadow-sm);
	}
	li.selected .card::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.7rem;
		bottom: 0.7rem;
		width: 3px;
		border-radius: var(--radius-full);
		background: var(--accent);
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.title {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: var(--text-md);
		font-weight: 620;
		line-height: 1.34;
		color: var(--text);
		letter-spacing: -0.01em;
		transition: color var(--dur-fast) var(--ease);
	}
	/* Stretched link: the whole row opens the document, while the action
	   buttons below sit above this layer and stay independently clickable. */
	.title::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.card:hover .title,
	li.selected .title {
		color: var(--accent);
	}
	.dek {
		margin: 0.25rem 0 0;
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
		gap: 0.45rem;
		margin-top: 0.35rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.src {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.dot {
		opacity: 0.6;
	}
	.when {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.hl {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
		margin-left: auto;
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
		margin-top: 0.65rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		position: relative;
		z-index: 1;
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

	.aside {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		min-width: 1.65rem;
		justify-content: center;
	}
	.ring svg {
		transform: rotate(-90deg);
		display: block;
	}
	.ring circle {
		fill: none;
		stroke-width: 3.2;
	}
	.ring-bg {
		stroke: var(--border-strong);
		opacity: 0.6;
	}
	.ring-fg {
		stroke: var(--accent);
		stroke-linecap: round;
		stroke-dasharray: var(--p) 100;
	}
	.badge.done {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.55rem;
		height: 1.55rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--ok) 16%, transparent);
		color: var(--ok);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 3.5rem 1rem;
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
	.empty p {
		margin: 0;
		font-size: var(--text-base);
	}

	.skeleton {
		display: flex;
		gap: 0.85rem;
		align-items: center;
		padding: 0.8rem 0.85rem;
	}
	.sk-av,
	.sk-lines {
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
	.sk-av {
		width: 30px;
		height: 30px;
		flex-shrink: 0;
	}
	.sk-lines {
		height: 1.5rem;
		flex: 1;
		max-width: 70%;
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
		.sk-av,
		.sk-lines {
			animation: none;
		}
	}
</style>
