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
		emptyHint,
		emptyIcon = 'inbox',
		grouped = false,
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
		/** Secondary line under the empty headline that teaches what this list holds. */
		emptyHint?: string;
		emptyIcon?: IconName;
		/** Insert date dividers (Today / Yesterday / …). Set when sorted by a date. */
		grouped?: boolean;
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
	// the parent bumps on j/k/Space), so hover-driven selection never scrolls. Rows
	// are addressed by class so interleaved date dividers don't shift the index.
	let listEl = $state<HTMLUListElement | null>(null);
	$effect(() => {
		void scrollNonce;
		untrack(() => {
			const rows = listEl?.querySelectorAll<HTMLElement>('li.row');
			rows?.[selectedIndex]?.scrollIntoView({ block: 'nearest' });
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

	/** The kind label shown in the byline (Feed / Article / Email / PDF). */
	function kindLabel(card: Card): string {
		if (card.location === 'feed' || card.category === 'rss') return 'Feed';
		if (card.category === 'email') return 'Email';
		if (card.category === 'pdf') return 'PDF';
		return 'Article';
	}

	function cardDate(card: Card): number {
		return Date.parse(card.publishedAt ?? card.savedAt);
	}

	/** Compact timestamp: time-of-day for today, else date + time. */
	function publishedStamp(card: Card): string {
		const t = cardDate(card);
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

	// Date bucket for the section dividers. Cards arrive already sorted, so equal
	// consecutive labels collapse into one run under a single heading.
	function startOfDay(d: Date): number {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	}
	function bucketLabel(card: Card): string {
		const t = cardDate(card);
		if (Number.isNaN(t)) return 'Undated';
		const d = new Date(t);
		const now = new Date();
		const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
		if (days <= 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return 'Earlier this week';
		if (days < 14) return 'Last week';
		return d.toLocaleDateString(undefined, {
			month: 'long',
			year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'
		});
	}

	type Row = { type: 'header'; label: string } | { type: 'card'; card: Card; index: number };

	// Flatten cards into a render list, threading the original index through so
	// keyboard selection and hover stay aligned regardless of inserted headers.
	const rows = $derived.by<Row[]>(() => {
		const list = cards ?? [];
		if (!grouped) return list.map((card, index) => ({ type: 'card', card, index }));
		const out: Row[] = [];
		let last = '';
		list.forEach((card, index) => {
			const label = bucketLabel(card);
			if (label !== last) {
				out.push({ type: 'header', label });
				last = label;
			}
			out.push({ type: 'card', card, index });
		});
		return out;
	});

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

	// Cover thumbnails fall back to text-only rows when absent or on load error —
	// images become the exception that earns visual weight, not a forced rail.
	let failedCovers = new SvelteSet<string>();
	const hasCover = (card: Card) => !!card.coverImage && !failedCovers.has(card.id);
</script>

<svelte:window onclick={() => (menuOpenId = null)} />

{#if !cards}
	<ul class="cards" aria-hidden="true">
		{#each [0, 1, 2, 3] as i (i)}
			<li class="row">
				<div class="skeleton">
					<span class="sk-line sk-title"></span>
					<span class="sk-line"></span>
				</div>
			</li>
		{/each}
	</ul>
{:else if cards.length === 0}
	<div class="empty">
		<span class="empty-mark"><Icon name={emptyIcon} size={24} /></span>
		<p class="empty-title">{empty}</p>
		{#if emptyHint}<p class="empty-hint">{emptyHint}</p>{/if}
	</div>
{:else}
	<ul class="cards" bind:this={listEl}>
		{#each rows as row (row.type === 'card' ? row.card.id : 'header:' + row.label)}
			{#if row.type === 'header'}
				<li class="group"><span class="group-label">{row.label}</span></li>
			{:else}
				{@const card = row.card}
				{@const i = row.index}
				<li class="row" class:selected={i === selectedIndex} class:faded={fadedIds?.has(card.id)}>
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
							class:read={card.readState === 'finished'}
							class:menu-open={menuOpenId === card.id}
							onmouseenter={() => onselect?.(i)}
						>
							{#if card.readState !== 'finished'}
								<span class="dot" aria-hidden="true"></span>
							{/if}

							{#if hasCover(card)}
								<span class="media">
									<img
										class="cover"
										src={card.coverImage}
										alt=""
										loading="lazy"
										onerror={() => failedCovers.add(card.id)}
									/>
								</span>
							{/if}

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
									<SourceAvatar url={card.url} siteName={card.siteName} size={16} />
									<span class="byline">{meta(card)}</span>
									{#if card.highlightCount > 0}
										<span class="hl"><Icon name="highlight" size={13} />{card.highlightCount}</span>
									{/if}
									<span class="when">{kindLabel(card)} · {publishedStamp(card)}</span>
								</p>
							</div>

							<div class="trail">
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
								<div class="menu-wrap">
									<button
										type="button"
										class="round more-btn"
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
			{/if}
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
	}

	/* Date divider: a tracked label trailed by a hairline section rule, the way a
	   newspaper index breaks its columns. */
	.group {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 1.6rem 0.2rem 0.55rem;
	}
	.group:first-child {
		padding-top: 0.2rem;
	}
	.group-label {
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.group::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	/* Each entry sits over a hairline rule so the list reads as an index at rest;
	   the hover/selected highlight is an inset rounded plane above it. */
	.row {
		border-bottom: 1px solid var(--border);
	}
	.row:last-child {
		border-bottom: 0;
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
		/* Left inset reserves the unread-dot gutter so titles align whether or not
		   a row is unread or carries a cover. */
		padding: 0.85rem 0.55rem 0.9rem 1.45rem;
		border-radius: var(--radius-lg);
		transition:
			background var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease);
	}
	.card:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
		box-shadow: var(--shadow-sm);
	}
	/* While the overflow menu is open, let it paint above sibling rows
	   (each .swipe-front establishes a z-index:1 context). */
	.card.menu-open {
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

	.dot {
		position: absolute;
		left: 0.5rem;
		top: 1.45rem;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
	}

	.media {
		flex-shrink: 0;
	}
	.cover {
		width: 58px;
		height: 58px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface-alt);
		object-fit: cover;
		display: block;
	}

	.body {
		flex: 1;
		min-width: 0;
	}
	/* Serif headlines give the list a magazine-index voice and a strong step over
	   the sans byline below. */
	.title {
		display: block;
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 600;
		line-height: 1.25;
		color: var(--text);
		letter-spacing: -0.005em;
		transition: color var(--dur-fast) var(--ease);
	}
	/* Read rows recede: the unread state owns full contrast and weight. */
	.card.read .title {
		color: var(--text-muted);
		font-weight: 500;
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
		margin: 0.3rem 0 0;
		font-size: var(--text-base);
		line-height: 1.5;
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
		gap: 0.45rem;
		margin: 0.5rem 0 0;
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
	/* Kind + timestamp ride the right edge of the byline, newspaper dateline style. */
	.when {
		margin-left: auto;
		flex-shrink: 0;
		white-space: nowrap;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}

	.trail {
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
		position: relative;
		z-index: 1;
	}
	/* Quick triage floats in on hover so resting rows stay clean, while the
	   overflow button below stays faintly present as a discoverable handle. */
	.quick {
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--dur-fast) var(--ease);
	}
	.card:hover .quick,
	li.selected .quick,
	.card:focus-within .quick {
		opacity: 1;
		pointer-events: auto;
	}
	.more-btn {
		opacity: 0.5;
		transition: opacity var(--dur-fast) var(--ease);
	}
	.card:hover .more-btn,
	li.selected .more-btn,
	.card:focus-within .more-btn,
	.card.menu-open .more-btn {
		opacity: 1;
	}
	@media (hover: none) {
		.quick {
			display: none;
		}
		.more-btn {
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

	/* Mobile: serif title steps down, cover shrinks, swipe replaces quick buttons. */
	@media (max-width: 640px) {
		.card {
			gap: 0.7rem;
			padding: 0.75rem 0.4rem 0.8rem 1.3rem;
		}
		.title {
			font-size: var(--text-md);
		}
		.cover {
			width: 48px;
			height: 48px;
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
		max-width: 24rem;
		font-size: var(--text-base);
		line-height: 1.5;
	}

	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.9rem 0.55rem 0.95rem 1.45rem;
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
