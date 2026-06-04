<script lang="ts">
	import type { Card, Location } from '@lectern/shared';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import Icon, { type IconName } from './Icon.svelte';
	import SourceAvatar from './SourceAvatar.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { ttsPlayer } from '$lib/tts-player.svelte';
	import { swipeable, type SwipeDirection } from '$lib/swipe';

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
		scrollNonce = 0,
		fadedIds,
		ontriage,
		onread,
		onselect,
		onopen
	}: {
		cards: Card[] | undefined;
		actions?: TriageAction[];
		empty?: string;
		emptyIcon?: IconName;
		selectedIndex?: number;
		/** Bumped by the parent on keyboard moves to scroll the focused row in view. */
		scrollNonce?: number;
		/** Ids to render faded (e.g. read-but-kept items awaiting a refresh). */
		fadedIds?: ReadonlySet<string>;
		ontriage?: (id: string, location: Location) => void;
		/** Fired when a card's read state is toggled here (swipe), so the parent can track it. */
		onread?: (id: string, read: boolean) => void;
		onselect?: (index: number) => void;
		/** Fired just before a card link navigates to the reader (queue snapshot). */
		onopen?: () => void;
	} = $props();

	// Scroll the keyboard-focused row into view. Depends only on scrollNonce (which
	// the parent bumps on j/k/Space), so hover-driven selection never scrolls.
	let listEl = $state<HTMLUListElement | null>(null);
	$effect(() => {
		void scrollNonce;
		untrack(() => {
			const li = listEl?.children[selectedIndex] as HTMLElement | undefined;
			li?.scrollIntoView({ block: 'nearest' });
		});
	});

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

	/** Byline: author · publication · reading time (de-duplicated). */
	function meta(card: Card): string {
		const pub = card.siteName ?? hostname(card.url);
		const parts: string[] = [];
		if (card.author) parts.push(card.author);
		if (pub && pub !== card.author) parts.push(pub);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min`);
		return parts.join('  ·  ');
	}

	/** The kind label shown top-right (Feed / Article / Email / PDF). */
	function kindLabel(card: Card): string {
		if (card.location === 'feed' || card.category === 'rss') return 'Feed';
		if (card.category === 'email') return 'Email';
		if (card.category === 'pdf') return 'PDF';
		return 'Article';
	}

	/** Compact timestamp: time-of-day for today, else date + time. */
	function publishedStamp(card: Card): string {
		const t = Date.parse(card.publishedAt ?? card.savedAt);
		if (Number.isNaN(t)) return '';
		const d = new Date(t);
		const now = new Date();
		const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		if (d.toDateString() === now.toDateString()) return time;
		const date = d.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'
		});
		return `${date}, ${time}`;
	}

	const finished = (card: Card) => card.readingProgress >= 0.99;

	// Three-dot overflow menu: only one open at a time (window-click closes it).
	let menuOpenId = $state<string | null>(null);
	function toggleMenu(id: string) {
		menuOpenId = menuOpenId === id ? null : id;
	}
	function queueTitle(card: Card) {
		return card.title || hostname(card.url);
	}
	function actionIcon(location: Location): IconName {
		switch (location) {
			case 'later':
				return 'clock';
			case 'shortlist':
				return 'star';
			case 'archive':
				return 'archive';
			case 'feed':
				return 'rss';
			default:
				return 'inbox';
		}
	}

	// ---- Mobile swipe actions (progressive enhancement over the buttons) ----
	function toggleRead(card: Card) {
		const read = card.readState !== 'finished';
		const sync = getSync();
		void sync.enqueue({ type: 'markRead', id: card.id, read }).then(() => sync.flush());
		onread?.(card.id, read);
	}

	let undo = $state<{ id: string; from: Location } | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;

	function onSwipe(card: Card, dir: SwipeDirection) {
		if (dir === 'right') {
			toggleRead(card);
			return;
		}
		// Left swipe = archive, offered with a brief undo since it's destructive.
		const from = card.location;
		triage(card.id, 'archive');
		if (from !== 'archive') {
			undo = { id: card.id, from };
			if (undoTimer) clearTimeout(undoTimer);
			undoTimer = setTimeout(() => (undo = null), 6000);
		}
	}

	function applyUndo() {
		if (!undo) return;
		triage(undo.id, undo.from);
		undo = null;
		if (undoTimer) clearTimeout(undoTimer);
	}

	// Cover thumbnails fall back to the source avatar when absent or on load error.
	let failedCovers = new SvelteSet<string>();
</script>

<svelte:window onclick={() => (menuOpenId = null)} />

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
	<ul class="cards" bind:this={listEl}>
		{#each cards as card, i (card.id)}
			<li class:selected={i === selectedIndex} class:faded={fadedIds?.has(card.id)}>
				<div class="swipe" use:swipeable={{ onCommit: (dir) => onSwipe(card, dir) }}>
					<div class="swipe-bg" aria-hidden="true">
						<span class="swipe-action read">
							<Icon name="check" size={16} />
							{card.readState === 'finished' ? 'Unread' : 'Read'}
						</span>
						<span class="swipe-action archive">
							Archive
							<Icon name="archive" size={16} />
						</span>
					</div>
					<article
						class="card swipe-front"
						class:unread={card.readState !== 'finished'}
						class:menu-open={menuOpenId === card.id}
						onmouseenter={() => onselect?.(i)}
					>
						<span class="lead">
							{#if card.readState !== 'finished'}
								<span class="unread-dot" aria-hidden="true"></span>
							{/if}
							{#if card.coverImage && !failedCovers.has(card.id)}
								<img
									class="thumb"
									src={card.coverImage}
									alt=""
									loading="lazy"
									onerror={() => failedCovers.add(card.id)}
								/>
							{:else}
								<span class="thumb thumb-fallback">
									<SourceAvatar url={card.url} siteName={card.siteName} size={30} />
								</span>
							{/if}
						</span>

						<div class="body">
							<a
								class="title"
								href={resolve('/read/[id]', { id: card.id })}
								onclick={() => onopen?.()}
							>
								{card.title || hostname(card.url)}
							</a>
							{#if card.excerpt}<p class="snippet">{card.excerpt}</p>{/if}
							<p class="meta">
								<span class="byline">{meta(card)}</span>
								{#if card.highlightCount > 0}
									<span class="hl"><Icon name="highlight" size={13} />{card.highlightCount}</span>
								{/if}
							</p>
						</div>

						<div class="trail">
							<span class="kind">
								<span class="kind-type">{kindLabel(card)} · </span>{publishedStamp(card)}
							</span>
							<div class="actions">
								<div class="menu-wrap">
									<button
										type="button"
										class="round"
										title="More"
										aria-label="More actions"
										aria-expanded={menuOpenId === card.id}
										onclick={(e) => {
											e.stopPropagation();
											toggleMenu(card.id);
										}}
									>
										<Icon name="more" size={18} />
									</button>
									{#if menuOpenId === card.id}
										<div class="menu" role="menu">
											<button
												type="button"
												role="menuitem"
												onclick={(e) => {
													e.stopPropagation();
													ttsPlayer.listen({ id: card.id, title: queueTitle(card) });
													menuOpenId = null;
												}}
											>
												<Icon name="headphones" size={15} /> Listen
											</button>
											<button
												type="button"
												role="menuitem"
												onclick={(e) => {
													e.stopPropagation();
													ttsPlayer.enqueue({ id: card.id, title: queueTitle(card) });
													menuOpenId = null;
												}}
											>
												<Icon name="plus" size={15} /> Add to queue
											</button>
											<button
												type="button"
												role="menuitem"
												onclick={(e) => {
													e.stopPropagation();
													toggleRead(card);
													menuOpenId = null;
												}}
											>
												<Icon name="check" size={15} /> Mark {card.readState === 'finished'
													? 'unread'
													: 'read'}
											</button>
											{#each actions as action (action.location)}
												{#if action.location !== 'later' && action.location !== 'archive'}
													<button
														type="button"
														role="menuitem"
														onclick={(e) => {
															e.stopPropagation();
															triage(card.id, action.location);
															menuOpenId = null;
														}}
													>
														<Icon name={actionIcon(action.location)} size={15} />
														{action.label}
													</button>
												{/if}
											{/each}
											{#if card.source === 'miniflux'}
												<button
													type="button"
													role="menuitem"
													disabled={savingId === card.id}
													onclick={(e) => {
														e.stopPropagation();
														saveToLater(card);
														menuOpenId = null;
													}}
												>
													<Icon name="bookmark" size={15} />
													{savingId === card.id ? 'Saving…' : 'Save to library'}
												</button>
											{/if}
											<!-- eslint-disable svelte/no-navigation-without-resolve -->
											<a
												class="menu-link"
												role="menuitem"
												href={card.url}
												target="_blank"
												rel="noreferrer noopener"
												onclick={(e) => {
													e.stopPropagation();
													menuOpenId = null;
												}}
											>
												<Icon name="external" size={15} /> Open original
											</a>
											<!-- eslint-enable svelte/no-navigation-without-resolve -->
										</div>
									{/if}
								</div>
								<div class="quick">
									{#if card.location !== 'later'}
										<button
											type="button"
											class="round"
											title="Read later"
											aria-label="Read later"
											onclick={() => triage(card.id, 'later')}
										>
											<Icon name="clock" size={17} />
										</button>
									{/if}
									{#if card.location !== 'archive'}
										<button
											type="button"
											class="round"
											title="Archive"
											aria-label="Archive"
											onclick={() => triage(card.id, 'archive')}
										>
											<Icon name="archive" size={17} />
										</button>
									{/if}
								</div>
							</div>
						</div>

						{#if finished(card)}
							<span class="progress-bar done" aria-hidden="true"></span>
						{:else if card.readingProgress > 0}
							<span
								class="progress-bar"
								style={`--p:${Math.round(card.readingProgress * 100)}%`}
								aria-hidden="true"
							></span>
						{/if}
					</article>
				</div>
			</li>
		{/each}
	</ul>
	{#if undo}
		<div class="undo-toast" role="status">
			<span>Archived</span>
			<button type="button" onclick={applyUndo}>Undo</button>
		</div>
	{/if}
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
	/* Swipe-to-act: the front (the card) slides over coloured action panels.
	   pan-y keeps vertical scrolling; the front is only opaque mid-swipe so the
	   list keeps its flat resting look. */
	.swipe {
		position: relative;
		border-radius: var(--radius-lg);
		touch-action: pan-y;
	}
	.swipe-bg {
		position: absolute;
		inset: 0;
		display: flex;
		border-radius: inherit;
		overflow: hidden;
		/* Hidden until a swipe engages (the action toggles opacity) so the panels
		   never bleed through the transparent card at rest. */
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.swipe-action {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 1.25rem;
		color: #fff;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.swipe-action.read {
		background: var(--accent);
		justify-content: flex-start;
	}
	.swipe-action.archive {
		background: var(--error, #c0392b);
		justify-content: flex-end;
	}
	.swipe-front {
		position: relative;
		z-index: 1;
	}
	.undo-toast {
		position: fixed;
		left: 50%;
		bottom: 5.5rem;
		transform: translateX(-50%);
		z-index: 70;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 0.75rem 0.6rem 1rem;
		background: var(--text);
		color: var(--bg);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-md);
		font-size: var(--text-sm);
	}
	.undo-toast button {
		border: 0;
		background: transparent;
		color: var(--accent);
		font-weight: 700;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
	}
	.card {
		position: relative;
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		padding: 0.85rem 0.9rem 0.95rem;
		border-radius: var(--radius-lg);
		border-left: 3px solid transparent;
		overflow: hidden;
		transition:
			background var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease);
	}
	.card:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
		box-shadow: var(--shadow-sm);
	}
	.card.unread {
		border-left-color: var(--accent);
	}
	/* While the overflow menu is open, let it escape the card's overflow clip and
	   paint above sibling cards (each .swipe-front establishes a z-index:1 context). */
	.card.menu-open {
		overflow: visible;
		z-index: 30;
	}
	/* Read-but-kept rows: dimmed in place until the next refresh drops them. The
	   selected/hover states still read clearly because they raise opacity back. */
	li.faded .card {
		opacity: 0.5;
		transition: opacity var(--dur-fast) var(--ease);
	}
	li.faded .card:hover,
	li.faded.selected .card {
		opacity: 0.8;
	}
	li.selected .card {
		background: var(--accent-soft);
		box-shadow: var(--shadow-sm);
	}

	.lead {
		position: relative;
		flex-shrink: 0;
	}
	.unread-dot {
		position: absolute;
		top: -3px;
		left: -3px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent);
		border: 2px solid var(--bg);
		z-index: 2;
	}
	.thumb,
	.thumb-fallback {
		width: 52px;
		height: 52px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface-alt);
		object-fit: cover;
		display: block;
	}
	.thumb-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		display: block;
		font-size: var(--text-md);
		font-weight: 650;
		line-height: 1.3;
		color: var(--text);
		letter-spacing: -0.01em;
		transition: color var(--dur-fast) var(--ease);
	}
	/* Stretched link: the whole card opens the document; the trail actions sit
	   on a higher layer and stay independently clickable. */
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
	.snippet {
		margin: 0.25rem 0 0;
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.45rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.byline {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.hl {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.trail {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
		position: relative;
		z-index: 1;
	}
	.kind {
		font-size: var(--text-2xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease);
	}
	.card:hover .actions,
	li.selected .actions,
	.card:focus-within .actions,
	.actions:has(.menu) {
		opacity: 1;
	}
	@media (hover: none) {
		.actions {
			opacity: 1;
		}
	}
	.round {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.round:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.round:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.quick {
		display: flex;
		gap: 0.25rem;
	}

	/* Mobile: drop the kind label + quick triage buttons (swipe handles those),
	   keep just a compact timestamp and the overflow menu so titles get room. */
	@media (max-width: 640px) {
		.kind-type {
			display: none;
		}
		.quick {
			display: none;
		}
		.actions {
			opacity: 1;
		}
		.card {
			gap: 0.7rem;
			padding: 0.75rem 0.7rem 0.85rem;
		}
	}

	.menu-wrap {
		position: relative;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 20;
		min-width: 12rem;
		padding: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-md);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.menu button,
	.menu-link {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.45rem 0.55rem;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
		text-decoration: none;
	}
	.menu button:hover,
	.menu-link:hover {
		background: var(--surface-alt);
	}
	.menu button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.progress-bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: var(--p, 100%);
		background: var(--accent);
		border-radius: 0 var(--radius-full) var(--radius-full) 0;
	}
	.progress-bar.done {
		width: 100%;
		background: var(--ok);
		opacity: 0.55;
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
