<script lang="ts">
	import type { Card, Location } from '@lectern/shared';
	import { getClient } from '$lib/config';
	import { onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import { buildPublications, isFinished, issueDate, publicationKey } from '$lib/newsletters';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import { readingQueue } from '$lib/reading-queue.svelte';
	import CardList from '$lib/components/CardList.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const all = liveCards(() => db.cards.toArray());
	const emails = $derived((all.value ?? []).filter((c) => c.category === 'email'));
	const publications = $derived(buildPublications(emails));
	const totalUnread = $derived(publications.reduce((n, p) => n + p.unread, 0));

	let selectedIndex = $state(0);
	// Bumped on every keyboard-driven selection move so CardList can scroll the
	// focused row into view (hover-driven selection leaves this untouched).
	let scrollNonce = $state(0);
	// SR-only announcement for triage / mark-read so assistive tech hears the move
	// even when the row simply slides away.
	let liveMessage = $state('');

	// Ids marked read while viewing this list. They stay visible but faded instead
	// of vanishing under the "unread" filter, until a refresh (component remount)
	// rebuilds the list from current read state. Reactive so the filter recomputes.
	const stickyRead = new SvelteSet<string>();
	function noteRead(id: string, read: boolean) {
		if (read) stickyRead.add(id);
		else stickyRead.delete(id);
	}

	// The publication lens. Holds a publication KEY (the sender domain, or the
	// display name when none) — not a bare sender, since one publication can span
	// many bylines. Seeded from the sidebar's `?pub=<key>` link, then rack clicks
	// move it in place (a way of looking, not a saved preference).
	let activeKey = $state<string | null>(untrack(() => page.url.searchParams.get('pub')));
	const activePub = $derived(
		activeKey === null ? null : (publications.find((p) => p.key === activeKey) ?? null)
	);
	// Follow the sidebar: when the `?pub` query changes (a newsletter drop-down
	// link), move the lens to match. In-page rack clicks set activeKey directly and
	// leave the URL untouched, so this only fires on real navigation.
	$effect(() => {
		const pub = page.url.searchParams.get('pub');
		untrack(() => {
			activeKey = pub;
		});
	});
	// If the active publication disappears (ignored, deleted elsewhere), fall back
	// to the full rack instead of filtering against a ghost. Guarded on a loaded
	// mirror so a URL-seeded key survives the brief window before cards arrive.
	$effect(() => {
		if (
			activeKey !== null &&
			all.value !== undefined &&
			!publications.some((p) => p.key === activeKey)
		) {
			activeKey = null;
		}
	});

	type ReadFilter = 'unread' | 'read' | 'all';
	const READ_FILTERS: { value: ReadFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'unread', label: 'Unread' },
		{ value: 'read', label: 'Read' }
	];
	// The key matches the old generic list (whose persistence key was its title,
	// "Newsletters"), so an existing stored choice carries over.
	const READ_FILTER_STORAGE = 'lectern.readFilter.Newsletters';
	const defaultRead: ReadFilter = 'unread';
	let readFilter = $state<ReadFilter>(
		untrack(() => {
			if (typeof localStorage === 'undefined') return defaultRead;
			const stored = localStorage.getItem(READ_FILTER_STORAGE);
			return stored === 'read' || stored === 'all' || stored === 'unread' ? stored : defaultRead;
		})
	);
	$effect(() => {
		if (typeof localStorage !== 'undefined') localStorage.setItem(READ_FILTER_STORAGE, readFilter);
	});

	// Pipeline: publication lens → read state → newest issue first (stable on id).
	const senderFiltered = $derived(
		activeKey === null ? emails : emails.filter((c) => publicationKey(c) === activeKey)
	);
	// In the unread view, keep items the user just marked read (stickyRead) in
	// place — they render faded and only drop out on the next refresh.
	const afterRead = $derived(
		readFilter === 'unread'
			? senderFiltered.filter((c) => !isFinished(c) || stickyRead.has(c.id))
			: readFilter === 'read'
				? senderFiltered.filter((c) => isFinished(c))
				: senderFiltered
	);
	const visible = $derived(
		[...afterRead].sort((a, b) => issueDate(b) - issueDate(a) || a.id.localeCompare(b.id))
	);

	// Keep the selection inside the (reactively changing) list bounds.
	$effect(() => {
		if (selectedIndex >= visible.length) selectedIndex = Math.max(0, visible.length - 1);
	});

	const ACTIONS: { label: string; location: Location }[] = [
		{ label: 'Inbox', location: 'inbox' },
		{ label: 'Read later', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' }
	];

	const DAY_MS = 86_400_000;
	function relativeArrival(ts: number): string {
		const days = Math.floor((Date.now() - ts) / DAY_MS);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 7) return `${days}d ago`;
		if (days < 30) return `${Math.round(days / 7)}w ago`;
		if (days < 365) return `${Math.round(days / 30)}mo ago`;
		return `${Math.round(days / 365)}y ago`;
	}

	const LOCATION_LABEL: Record<Location, string> = {
		inbox: 'Inbox',
		later: 'Later',
		shortlist: 'Shortlist',
		archive: 'Archive',
		feed: 'Feed'
	};

	function triageById(id: string, location: Location) {
		const card = (all.value ?? []).find((c) => c.id === id);
		const from = card?.location;
		const sync = getSync();
		void sync.enqueue({ type: 'setLocation', id, location }).then(() => sync.flush());
		const label = location === 'archive' ? 'Archived' : `Moved to ${LOCATION_LABEL[location]}`;
		// Single triage is reversible too: snapshot the prior location and offer the
		// same timed Undo the bulk actions use. Its role=status toast doubles as the
		// screen-reader announcement; a no-op move still announces via the live region.
		if (from && from !== location) {
			offerBulkUndo(label, () => {
				const s = getSync();
				void s.enqueue({ type: 'setLocation', id, location: from }).then(() => s.flush());
			});
		} else {
			liveMessage = label;
		}
	}

	// Mark one issue read. Newsletters are readeck documents, which have no read
	// flag — completing their reading progress stands in. The id is noted so the
	// row stays (faded).
	function markReadById(card: Card) {
		const sync = getSync();
		void sync
			.enqueue({ type: 'setReadingProgress', id: card.id, readingProgress: 1, readAnchor: null })
			.then(() => sync.flush());
		noteRead(card.id, true);
		liveMessage = 'Marked read';
	}

	// ---- Bulk mark-read over a scope (all visible, or one publication). ----
	// As easy to undo as a single swipe: it snapshots the prior progress of every
	// issue it touches and offers a timed Undo that restores it exactly.
	let bulkUndo = $state<{ label: string; run: () => void } | null>(null);
	let bulkUndoTimer: ReturnType<typeof setTimeout> | undefined;
	function offerBulkUndo(label: string, run: () => void) {
		bulkUndo = { label, run };
		if (bulkUndoTimer) clearTimeout(bulkUndoTimer);
		bulkUndoTimer = setTimeout(() => (bulkUndo = null), 8000);
	}
	function applyBulkUndo() {
		if (!bulkUndo) return;
		bulkUndo.run();
		bulkUndo = null;
		if (bulkUndoTimer) clearTimeout(bulkUndoTimer);
	}

	function markIssuesRead(scope: Card[]) {
		const sync = getSync();
		const changed = scope.filter((c) => !isFinished(c));
		if (!changed.length) return;
		// Snapshot prior progress so undo restores it exactly (not just to zero).
		const snap = changed.map((c) => ({
			id: c.id,
			progress: c.readingProgress,
			anchor: c.readAnchor
		}));
		for (const card of changed) {
			void sync.enqueue({
				type: 'setReadingProgress',
				id: card.id,
				readingProgress: 1,
				readAnchor: null
			});
			noteRead(card.id, true);
		}
		void sync.flush();
		offerBulkUndo(`Marked ${changed.length} read`, () => {
			const s = getSync();
			for (const it of snap) {
				void s.enqueue({
					type: 'setReadingProgress',
					id: it.id,
					readingProgress: it.progress,
					readAnchor: it.anchor
				});
				noteRead(it.id, false);
			}
			void s.flush();
		});
	}

	// ---- Ignore a sender (server-side, irreversible) ----
	// The server skips the sender's future emails AND deletes its already-saved
	// issues; a sync pull then drops the matching rows from the local mirror.
	let pubBusy = $state(false);
	let pubError = $state<string | null>(null);
	async function ignoreSender(name: string, count: number) {
		if (pubBusy) return;
		const what = `${count} saved ${count === 1 ? 'issue' : 'issues'}`;
		if (!confirm(`Ignore "${name}"? Future issues are skipped and its ${what} are deleted.`)) {
			return;
		}
		pubBusy = true;
		pubError = null;
		try {
			const res = await getClient().addEmailIgnore(name);
			if (res.removed > 0) await getSync().pull();
			activeKey = null;
		} catch (err) {
			pubError = err instanceof Error ? err.message : 'Could not ignore the sender.';
		} finally {
			pubBusy = false;
		}
	}

	/** Snapshot this list's order so the reader can auto-advance after triage. */
	function snapshotQueue() {
		readingQueue.set(visible.map((c) => c.id));
	}
	function openCard(card: Card | undefined) {
		if (card) {
			snapshotQueue();
			void goto(resolve('/read/[id]', { id: card.id }));
		}
	}

	const controller: ListController = {
		move(delta) {
			if (visible.length === 0) return;
			selectedIndex = Math.min(visible.length - 1, Math.max(0, selectedIndex + delta));
			// Signal CardList to scroll the (keyboard-)focused row into view.
			scrollNonce += 1;
		},
		open() {
			openCard(visible[selectedIndex]);
		},
		triage(location) {
			const card = visible[selectedIndex];
			// Selection index stays put so the next card slides into focus.
			if (card) triageById(card.id, location);
		},
		markRead() {
			const card = visible[selectedIndex];
			// Selection index stays put so the next card slides into focus.
			if (card) markReadById(card);
		}
	};

	onMount(() => {
		activeList.set(controller);
		void getSync().pull();
		return () => activeList.clear(controller);
	});

	// Overflow menu, dismissed by an outside click (the window handler; inner
	// clicks stop it).
	let menuOpen = $state(false);

	const emptyTitle = $derived(
		emails.length === 0
			? 'No newsletters yet.'
			: readFilter === 'unread'
				? activePub
					? `All caught up with ${activePub.name}.`
					: 'All caught up.'
				: 'Nothing here.'
	);
	const emptyHintText = $derived(
		emails.length === 0
			? 'Issues sent to your dedicated newsletter address land here as readable articles, pulled straight from the mailbox.'
			: readFilter === 'unread'
				? activePub
					? 'Switch the filter to All to revisit past issues.'
					: 'Every issue is read. New mail lands here automatically.'
				: undefined
	);
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<!-- Mobile-only scrim behind the actions menu, which becomes a bottom sheet there
     (see the max-width media query). Tapping it closes the menu. -->
{#if menuOpen}
	<div class="menu-scrim" role="presentation" onclick={() => (menuOpen = false)}></div>
{/if}

<section class="list page">
	<div class="sr-only" role="status" aria-live="polite">{liveMessage}</div>
	<header class="head">
		<h1>
			Newsletters
			{#if emails.length}<span class="count">{emails.length}</span>{/if}
		</h1>
		<div class="tools">
			<div class="seg" role="group" aria-label="Filter by read state">
				{#each READ_FILTERS as opt (opt.value)}
					<button
						type="button"
						class:active={readFilter === opt.value}
						aria-pressed={readFilter === opt.value}
						onclick={() => (readFilter = opt.value)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
			<div class="pop-wrap">
				<button
					type="button"
					class="icon"
					aria-label="List actions"
					aria-expanded={menuOpen}
					title="List actions"
					onclick={(e) => {
						e.stopPropagation();
						menuOpen = !menuOpen;
					}}
				>
					<Icon name="more" size={18} />
				</button>
				{#if menuOpen}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
						<button
							type="button"
							role="menuitem"
							disabled={!visible.some((c) => !isFinished(c))}
							onclick={() => {
								markIssuesRead(visible);
								menuOpen = false;
							}}
						>
							<Icon name="check" size={15} /> Mark all read
						</button>
						<a role="menuitem" href={resolve('/settings')} onclick={() => (menuOpen = false)}>
							<Icon name="settings" size={15} /> Ignored senders
						</a>
					</div>
				{/if}
			</div>
		</div>
	</header>

	{#if publications.length}
		<div class="rack" role="group" aria-label="Filter by publication">
			<button
				type="button"
				class="plate"
				class:active={activeKey === null}
				aria-pressed={activeKey === null}
				onclick={() => (activeKey = null)}
			>
				<span class="plate-name">All issues</span>
				<span class="plate-meta">{totalUnread > 0 ? `${totalUnread} unread` : 'Up to date'}</span>
			</button>
			{#each publications as pub (pub.key)}
				<button
					type="button"
					class="plate"
					class:active={activeKey === pub.key}
					aria-pressed={activeKey === pub.key}
					onclick={() => (activeKey = activeKey === pub.key ? null : pub.key)}
				>
					<span class="plate-name">{pub.name}</span>
					<span class="plate-meta"
						>{pub.unread > 0 ? `${pub.unread} unread` : 'Up to date'} · {relativeArrival(
							pub.latestAt
						)}</span
					>
				</button>
			{/each}
		</div>
	{/if}

	{#if activePub}
		<div class="pub-bar">
			<p class="pub-line">
				{activePub.total}
				{activePub.total === 1 ? 'issue' : 'issues'} · {activePub.unread} unread{activePub.cadence
					? ` · ${activePub.cadence}`
					: ''}
			</p>
			<div class="pub-actions">
				<button
					type="button"
					class="pub-btn"
					disabled={activePub.unread === 0}
					onclick={() => markIssuesRead(senderFiltered)}
				>
					Mark issues read
				</button>
				<button
					type="button"
					class="pub-btn danger"
					disabled={pubBusy}
					onclick={() => {
						if (activePub) ignoreSender(activePub.name, activePub.total);
					}}
				>
					Ignore sender
				</button>
			</div>
		</div>
		{#if pubError}<p class="pub-error">{pubError}</p>{/if}
	{/if}

	<CardList
		cards={visible}
		loading={all.value === undefined}
		actions={ACTIONS}
		grouped
		{selectedIndex}
		{scrollNonce}
		fadedIds={stickyRead}
		ontriage={triageById}
		onread={noteRead}
		onselect={(i) => (selectedIndex = i)}
		onopen={snapshotQueue}
		empty={emptyTitle}
		emptyHint={emptyHintText}
		emptyIcon="mail"
	/>

	{#if bulkUndo}
		<div class="undo-toast" role="status">
			<span>{bulkUndo.label}</span>
			<button type="button" onclick={applyBulkUndo}>Undo</button>
		</div>
	{/if}
</section>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1.1rem;
	}
	h1 {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		font-size: var(--text-2xl);
	}
	.count {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--text-muted);
		letter-spacing: 0;
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.icon {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.icon:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.seg {
		display: flex;
		gap: 0.2rem;
		padding: 0.2rem;
		background: var(--surface-alt);
		border-radius: var(--radius);
	}
	.seg button {
		padding: 0.3rem 0.6rem;
		border: 0;
		border-radius: calc(var(--radius) - 3px);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.seg button:hover {
		color: var(--text);
	}
	.seg button.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	.pop-wrap {
		position: relative;
		display: inline-flex;
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 40;
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
	.menu a {
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
	.menu a:hover {
		background: var(--surface-alt);
	}
	.menu button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* Scrim only paints on mobile, where the menu is a bottom sheet (below). */
	.menu-scrim {
		display: none;
	}

	/* The rack: nameplates standing on a shelf hairline, not a card grid. Each
	   plate echoes the masthead lockup at miniature scale (serif, heavy,
	   condensed, double rule). */
	.rack {
		display: flex;
		gap: 0.35rem;
		margin: 0.2rem 0 1.3rem;
		padding: 0 0 0;
		overflow-x: auto;
		border-bottom: 1px solid var(--border);
		scrollbar-width: thin;
		scrollbar-color: var(--border-strong) transparent;
	}
	.plate {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		align-items: flex-start;
		min-width: 8rem;
		max-width: 12.5rem;
		padding: 0.65rem 0.8rem 0.7rem;
		border: 0;
		background: transparent;
		border-radius: var(--radius) var(--radius) 0 0;
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease);
	}
	.plate:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
	}
	.plate.active {
		background: var(--accent-soft);
	}
	.plate-name {
		font-family: var(--font-serif);
		font-weight: 700;
		font-stretch: 87.5%;
		font-size: var(--text-md);
		line-height: 1.15;
		letter-spacing: -0.01em;
		color: var(--text);
		padding-bottom: 0.3rem;
		border-bottom: 3px double var(--border-strong);
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	.plate-meta {
		font-size: var(--text-2xs);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.plate.active .plate-meta {
		color: var(--accent);
	}

	.pub-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.9rem;
		margin: 0 0 0.6rem;
	}
	.pub-line {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.pub-actions {
		margin-left: auto;
		display: flex;
		gap: 0.4rem;
	}
	.pub-btn {
		padding: 0.32rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.pub-btn:hover:not(:disabled) {
		border-color: var(--border-strong);
	}
	.pub-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.pub-btn.danger:hover:not(:disabled) {
		border-color: var(--error);
		color: var(--error);
		background: color-mix(in srgb, var(--error) 8%, transparent);
	}
	.pub-error {
		margin: 0 0 0.6rem;
		font-size: var(--text-sm);
		color: var(--error);
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

	@media (max-width: 640px) {
		.plate {
			min-width: 7rem;
		}
		.pub-actions {
			margin-left: 0;
			width: 100%;
		}
		/* The absolute dropdown can fall below the fold; promote it to a
		   viewport-anchored bottom sheet so every item is reachable. */
		.menu-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 40;
			background: rgba(20, 16, 10, 0.32);
		}
		.menu {
			position: fixed;
			top: auto;
			right: 0;
			left: 0;
			bottom: 0;
			z-index: 41;
			min-width: 0;
			max-height: 70vh;
			overflow-y: auto;
			padding: 0.4rem 0.4rem calc(0.4rem + env(safe-area-inset-bottom));
			border-width: 1px 0 0;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			gap: 2px;
		}
		.menu button,
		.menu a {
			padding: 0.7rem 0.65rem;
			font-size: var(--text-md);
		}
	}
</style>
