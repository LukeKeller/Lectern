<script lang="ts">
	import type {
		BulkDeleteScope,
		Card,
		Category,
		Location,
		QueryNode,
		SortDir,
		Source,
		ViewSortBy
	} from '@lectern/shared';
	import { getClient } from '$lib/config';
	import { onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import {
		collectCategories,
		collectSources,
		collectTags,
		filterByCategory,
		filterByReadState,
		filterBySource,
		filterByTag,
		filterByText,
		sortCards
	} from '$lib/lists';
	import { andQueries, tagQuery } from '$lib/views';
	import { viewsStore } from '$lib/views-store.svelte';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import { readingQueue } from '$lib/reading-queue.svelte';
	import CardList from './CardList.svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface TriageAction {
		label: string;
		location: Location;
	}

	let {
		title,
		predicate,
		actions = [],
		empty = 'Nothing here.',
		emptyHint,
		emptyIcon = 'inbox',
		hideReadKey = undefined,
		baseQuery,
		bulkDelete,
		maintenance,
		sortBy = $bindable<ViewSortBy>('publishedAt'),
		sortDir = $bindable<SortDir>('desc')
	}: {
		title: string;
		predicate: (card: Card) => boolean;
		actions?: TriageAction[];
		empty?: string;
		/** Teaching line under the empty headline (what this list is for). */
		emptyHint?: string;
		emptyIcon?: IconName;
		/**
		 * Opts this list into a default of showing only unread items. The read-state
		 * control is present on every list regardless; when set, this also names the
		 * persistence key (otherwise the list title is used).
		 */
		hideReadKey?: string;
		/** The query AST this list represents, enabling "save as view". */
		baseQuery?: QueryNode;
		/**
		 * Opts this list into a destructive bulk-delete action in the overflow menu
		 * (e.g. "Empty Archive", "Delete all read"). The scope is sent to the server;
		 * `confirm` is the message shown before it runs.
		 */
		bulkDelete?: { scope: BulkDeleteScope; label: string; confirm: string };
		/**
		 * Opts this list into the "Clean up" sweep (delete or mark-read items older
		 * than a cutoff, or everything below the selected item). The facets scope the
		 * server-side sweep to this list (e.g. the feed). Sized to fight a backend
		 * that keeps re-serving stale items.
		 */
		maintenance?: { location?: Location; source?: Source; category?: Category };
		sortBy?: ViewSortBy;
		sortDir?: SortDir;
	} = $props();

	const all = liveCards(() => db.cards.toArray());

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

	// Per-list filter facets. The storage key derives from hideReadKey (so the
	// feed keeps its existing key) and otherwise falls back to the list title.
	const listKey = $derived(hideReadKey ?? title);

	type ReadFilter = 'unread' | 'read' | 'all';
	type SourceFilter = Source | 'all';
	type CategoryFilter = Category | 'all';

	const READ_FILTERS: { value: ReadFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'unread', label: 'Unread' },
		{ value: 'read', label: 'Read' }
	];
	const SOURCE_LABELS: Record<Source, string> = { miniflux: 'RSS', readeck: 'Saved' };
	const CATEGORY_LABELS: Record<Category, string> = {
		article: 'Article',
		rss: 'RSS',
		email: 'Email',
		pdf: 'PDF'
	};

	// Every list defaults to showing unread only; a stored per-list choice (below)
	// still overrides, and the always-present control lets the user switch to
	// All/Read at any time.
	const defaultRead: ReadFilter = 'unread';
	const readFilterStorage = $derived(`lectern.readFilter.${listKey}`);
	let readFilter = $state<ReadFilter>(
		untrack(() => {
			if (typeof localStorage === 'undefined') return defaultRead;
			const stored = localStorage.getItem(`lectern.readFilter.${hideReadKey ?? title}`);
			return stored === 'read' || stored === 'all' || stored === 'unread' ? stored : defaultRead;
		})
	);
	$effect(() => {
		if (typeof localStorage !== 'undefined') localStorage.setItem(readFilterStorage, readFilter);
	});

	// The remaining facets persist together as one JSON blob, SSR-guarded.
	interface StoredFilters {
		source?: SourceFilter;
		category?: CategoryFilter;
		tag?: string | null;
		text?: string;
	}
	const filterStorage = $derived(`lectern.filters.${listKey}`);
	const storedFilters: StoredFilters = untrack(() => {
		if (typeof localStorage === 'undefined') return {};
		try {
			const raw = localStorage.getItem(`lectern.filters.${hideReadKey ?? title}`);
			return raw ? (JSON.parse(raw) as StoredFilters) : {};
		} catch {
			return {};
		}
	});
	let sourceFilter = $state<SourceFilter>(storedFilters.source ?? 'all');
	let categoryFilter = $state<CategoryFilter>(storedFilters.category ?? 'all');
	let tagFilter = $state<string | null>(storedFilters.tag ?? null);
	let textFilter = $state(storedFilters.text ?? '');
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const payload: StoredFilters = {
			source: sourceFilter,
			category: categoryFilter,
			tag: tagFilter,
			text: textFilter
		};
		localStorage.setItem(filterStorage, JSON.stringify(payload));
	});

	// Compose the facets in a fixed pipeline. The option lists for the dependent
	// facets are derived from the set produced by the earlier facets, so they only
	// ever offer choices that can still match.
	const matched = $derived((all.value ?? []).filter(predicate));
	// In the unread view, keep items the user just marked read (stickyRead) in
	// place — they render faded and only drop out on the next refresh.
	const afterRead = $derived(
		readFilter === 'unread'
			? matched.filter((c) => c.readState !== 'finished' || stickyRead.has(c.id))
			: filterByReadState(matched, readFilter)
	);
	const afterSource = $derived(filterBySource(afterRead, sourceFilter));
	const afterCategory = $derived(filterByCategory(afterSource, categoryFilter));
	const afterTag = $derived(filterByTag(afterCategory, tagFilter));
	const sources = $derived(collectSources(afterRead));
	const categories = $derived(collectCategories(afterSource));
	const tags = $derived(collectTags(afterCategory));
	const cards = $derived(sortCards(filterByText(afterTag, textFilter), sortBy, sortDir));

	// Group into date sections only when the order is chronological; alphabetical
	// or length sorts have no meaningful date runs.
	const grouped = $derived(
		sortBy === 'publishedAt' || sortBy === 'savedAt' || sortBy === 'updatedAt'
	);

	// Facets that live behind the Filter popover (source / category / tag). Read
	// state and text search stay inline, so they are counted separately.
	const facetCount = $derived(
		(sourceFilter !== 'all' ? 1 : 0) + (categoryFilter !== 'all' ? 1 : 0) + (tagFilter ? 1 : 0)
	);
	const hasFacets = $derived(sources.length > 1 || categories.length > 1 || tags.length > 0);
	const activeCount = $derived(
		(readFilter !== defaultRead ? 1 : 0) + (textFilter.trim() ? 1 : 0) + facetCount
	);
	function clearFilters() {
		readFilter = defaultRead;
		sourceFilter = 'all';
		categoryFilter = 'all';
		tagFilter = null;
		textFilter = '';
	}

	// Drop a facet selection once an upstream facet makes it impossible to match,
	// so a stale dropdown never points at a value with no option. Guarded on a
	// non-empty upstream set so a persisted facet is not wiped before the cards
	// have loaded (the upstream set is briefly empty during hydration). None of
	// these reads feed back into their own option list, so there is no loop.
	$effect(() => {
		if (afterRead.length && sourceFilter !== 'all' && !sources.includes(sourceFilter)) {
			sourceFilter = 'all';
		}
	});
	$effect(() => {
		if (afterSource.length && categoryFilter !== 'all' && !categories.includes(categoryFilter)) {
			categoryFilter = 'all';
		}
	});
	$effect(() => {
		if (afterCategory.length && tagFilter && !tags.includes(tagFilter)) tagFilter = null;
	});

	// Keep the selection inside the (reactively changing) list bounds.
	$effect(() => {
		if (selectedIndex >= cards.length) selectedIndex = Math.max(0, cards.length - 1);
	});

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

	// Mark one card read. RSS items flip their MiniFlux read flag (markRead); saved
	// articles have no read flag, so completing their progress stands in. Mirrors
	// markAllRead's per-source logic. The id is noted so the row stays (faded).
	function markReadById(card: Card) {
		const sync = getSync();
		if (card.source === 'miniflux') {
			void sync.enqueue({ type: 'markRead', id: card.id, read: true }).then(() => sync.flush());
		} else {
			void sync
				.enqueue({ type: 'setReadingProgress', id: card.id, readingProgress: 1, readAnchor: null })
				.then(() => sync.flush());
		}
		noteRead(card.id, true);
		liveMessage = 'Marked read';
	}

	// ---- Bulk actions over the currently-visible cards, each reversible. ----
	// A bulk action is as easy to undo as a single swipe: it snapshots the prior
	// state of every row it touches and offers a timed Undo that restores it.
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

	function markAllRead() {
		const sync = getSync();
		const changed = cards.filter((c) => c.readState !== 'finished');
		if (!changed.length) return;
		// Snapshot prior progress so undo restores it exactly (not just to zero).
		const snap = changed.map((c) => ({ id: c.id, source: c.source, progress: c.readingProgress }));
		for (const card of changed) {
			if (card.source === 'miniflux') {
				void sync.enqueue({ type: 'markRead', id: card.id, read: true });
			} else {
				void sync.enqueue({
					type: 'setReadingProgress',
					id: card.id,
					readingProgress: 1,
					readAnchor: null
				});
			}
			noteRead(card.id, true);
		}
		void sync.flush();
		offerBulkUndo(`Marked ${changed.length} read`, () => {
			const s = getSync();
			for (const it of snap) {
				if (it.source === 'miniflux') {
					void s.enqueue({ type: 'markRead', id: it.id, read: false });
				} else {
					void s.enqueue({
						type: 'setReadingProgress',
						id: it.id,
						readingProgress: it.progress,
						readAnchor: null
					});
				}
				noteRead(it.id, false);
			}
			void s.flush();
		});
	}
	function archiveAll() {
		const sync = getSync();
		const changed = cards.filter((c) => c.location !== 'archive');
		if (!changed.length) return;
		const snap = changed.map((c) => ({ id: c.id, from: c.location }));
		for (const c of changed) {
			void sync.enqueue({ type: 'setLocation', id: c.id, location: 'archive' });
		}
		void sync.flush();
		offerBulkUndo(`Archived ${changed.length}`, () => {
			const s = getSync();
			for (const it of snap) {
				void s.enqueue({ type: 'setLocation', id: it.id, location: it.from });
			}
			void s.flush();
		});
	}

	// ---- Server-side bulk delete (irreversible) ----
	// Unlike the reversible bulk actions above, this permanently removes items from
	// the source. After the server deletes + tombstones them, a sync pull drops the
	// matching rows from the local mirror so the live list updates on its own.
	let bulkDeleting = $state(false);
	let bulkDeleteResult = $state<string | null>(null);
	let bulkDeleteTimer: ReturnType<typeof setTimeout> | undefined;
	async function runBulkDelete() {
		if (!bulkDelete || bulkDeleting) return;
		if (!confirm(bulkDelete.confirm)) return;
		bulkDeleting = true;
		bulkDeleteResult = null;
		try {
			const { deleted } = await getClient().bulkDelete(bulkDelete.scope);
			await getSync().pull();
			bulkDeleteResult = `Deleted ${deleted} item${deleted === 1 ? '' : 's'}`;
		} catch (err) {
			bulkDeleteResult = err instanceof Error ? err.message : 'Bulk delete failed';
		} finally {
			bulkDeleting = false;
			if (bulkDeleteTimer) clearTimeout(bulkDeleteTimer);
			bulkDeleteTimer = setTimeout(() => (bulkDeleteResult = null), 5000);
		}
	}

	// ---- "Clean up" sweep (server-side, age- or anchor-based) ----
	// Two scopes share one cutoff model: "older than <preset>" sends now − preset;
	// "below the selected item" sends the selected card's timestamp. Either can
	// delete (irreversible — removed at the source so the poll can't re-add) or
	// mark read. The selected card is the keyboard/hover focus (selectedIndex).
	const AGE_PRESETS = [
		{ value: 7, label: '1 week' },
		{ value: 14, label: '2 weeks' },
		{ value: 30, label: '1 month' },
		{ value: 90, label: '3 months' },
		{ value: 180, label: '6 months' }
	];
	let cleanupOpen = $state(false);
	let cleanupScope = $state<'age' | 'below'>('age');
	let cleanupDays = $state(7);
	let cleanupBusy = $state(false);
	let cleanupResult = $state<string | null>(null);
	let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
	const anchorCard = $derived(cards[selectedIndex]);
	// MiniFlux publish date and a saved article's save date both live in savedAt;
	// only an explicit "Updated" sort compares the backend's last-change time.
	const cleanupDateField = $derived<'savedAt' | 'updatedAt'>(
		sortBy === 'updatedAt' ? 'updatedAt' : 'savedAt'
	);

	function anchorTimestamp(card: Card): string {
		if (sortBy === 'updatedAt') return card.updatedAt;
		if (sortBy === 'savedAt') return card.savedAt;
		return card.publishedAt ?? card.savedAt;
	}

	async function runCleanup(action: 'delete' | 'mark-read') {
		if (!maintenance || cleanupBusy) return;
		let before: string;
		if (cleanupScope === 'below') {
			if (!anchorCard) return;
			before = anchorTimestamp(anchorCard);
		} else {
			before = new Date(Date.now() - cleanupDays * 86_400_000).toISOString();
		}
		const verb = action === 'delete' ? 'Delete' : 'Mark read';
		const what =
			cleanupScope === 'below'
				? 'everything below the selected item'
				: `items older than ${AGE_PRESETS.find((p) => p.value === cleanupDays)?.label ?? `${cleanupDays} days`}`;
		const warn = action === 'delete' ? " This can't be undone." : '';
		if (!confirm(`${verb} ${what}?${warn}`)) return;
		cleanupBusy = true;
		cleanupResult = null;
		try {
			const res = await getClient().bulkMaintenance({
				action,
				before,
				dateField: cleanupDateField,
				inclusive: false,
				location: maintenance.location,
				source: maintenance.source,
				category: maintenance.category
			});
			await getSync().pull();
			cleanupResult = `${res.action === 'delete' ? 'Deleted' : 'Marked read'} ${res.affected} item${res.affected === 1 ? '' : 's'}`;
		} catch (err) {
			cleanupResult = err instanceof Error ? err.message : 'Cleanup failed';
		} finally {
			cleanupBusy = false;
			cleanupOpen = false;
			if (cleanupTimer) clearTimeout(cleanupTimer);
			cleanupTimer = setTimeout(() => (cleanupResult = null), 5000);
		}
	}

	/** Snapshot this list's order so the reader can auto-advance after triage. */
	function snapshotQueue() {
		readingQueue.set(cards.map((c) => c.id));
	}
	function openCard(card: Card | undefined) {
		if (card) {
			snapshotQueue();
			void goto(resolve('/read/[id]', { id: card.id }));
		}
	}

	const controller: ListController = {
		move(delta) {
			if (cards.length === 0) return;
			selectedIndex = Math.min(cards.length - 1, Math.max(0, selectedIndex + delta));
			// Signal CardList to scroll the (keyboard-)focused row into view.
			scrollNonce += 1;
		},
		open() {
			openCard(cards[selectedIndex]);
		},
		triage(location) {
			const card = cards[selectedIndex];
			// Selection index stays put so the next card slides into focus.
			if (card) triageById(card.id, location);
		},
		markRead() {
			const card = cards[selectedIndex];
			// Selection index stays put so the next card slides into focus.
			if (card) markReadById(card);
		}
	};

	onMount(() => {
		activeList.set(controller);
		void getSync().pull();
		return () => activeList.clear(controller);
	});

	const SORT_LABELS: Record<ViewSortBy, string> = {
		publishedAt: 'Published',
		savedAt: 'Saved',
		updatedAt: 'Updated',
		title: 'Title',
		wordCount: 'Length',
		readingProgress: 'Progress'
	};

	// Header popovers: the Filter panel and the overflow menu, one open at a time,
	// dismissed by an outside click (the window handler; inner clicks stop it).
	let filtersOpen = $state(false);
	let menuOpen = $state(false);
	function closePopovers() {
		filtersOpen = false;
		menuOpen = false;
	}

	let saving = $state(false);
	let viewName = $state('');
	let saveError = $state<string | undefined>(undefined);

	async function saveView(event: SubmitEvent) {
		event.preventDefault();
		if (!baseQuery) return;
		const name = viewName.trim();
		if (!name) return;
		// Fold the active tag filter into the saved query so the view reproduces it.
		const query = tagFilter ? andQueries(baseQuery, tagQuery(tagFilter)) : baseQuery;
		const view = await viewsStore.create({
			name,
			query,
			pinned: true,
			icon: null,
			position: 0,
			sortBy,
			sortDir
		});
		if (view) {
			saving = false;
			viewName = '';
			saveError = undefined;
		} else {
			saveError = viewsStore.error ?? 'Could not save view';
		}
	}
</script>

<svelte:window onclick={closePopovers} />

<section class="list page">
	<div class="sr-only" role="status" aria-live="polite">{liveMessage}</div>
	<header class="head">
		<h1>
			{title}
			{#if cards.length}<span class="count">{cards.length}</span>{/if}
		</h1>
		<div class="tools">
			<div class="select">
				<select bind:value={sortBy} aria-label="Sort by">
					{#each Object.entries(SORT_LABELS) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</div>
			<button
				type="button"
				class="icon"
				onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')}
				aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
			>
				{sortDir === 'asc' ? '↑' : '↓'}
			</button>
			<div class="search">
				<Icon name="search" size={14} />
				<input
					bind:value={textFilter}
					type="search"
					placeholder="Filter…"
					autocomplete="off"
					aria-label="Filter by title, site or author"
				/>
			</div>
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

			{#if hasFacets || facetCount}
				<div class="pop-wrap">
					<button
						type="button"
						class="icon"
						class:on={facetCount > 0}
						aria-label="Filters"
						aria-expanded={filtersOpen}
						title="Filters"
						onclick={(e) => {
							e.stopPropagation();
							menuOpen = false;
							filtersOpen = !filtersOpen;
						}}
					>
						<Icon name="sliders" size={16} />
						{#if facetCount}<span class="badge">{facetCount}</span>{/if}
					</button>
					{#if filtersOpen}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<div class="popover" onclick={(e) => e.stopPropagation()}>
							{#if sources.length > 1}
								<label class="field">
									<span>Source</span>
									<div class="select block">
										<select bind:value={sourceFilter} aria-label="Filter by source">
											<option value="all">All sources</option>
											{#each sources as src (src)}
												<option value={src}>{SOURCE_LABELS[src]}</option>
											{/each}
										</select>
									</div>
								</label>
							{/if}
							{#if categories.length > 1}
								<label class="field">
									<span>Type</span>
									<div class="select block">
										<select bind:value={categoryFilter} aria-label="Filter by category">
											<option value="all">All types</option>
											{#each categories as cat (cat)}
												<option value={cat}>{CATEGORY_LABELS[cat]}</option>
											{/each}
										</select>
									</div>
								</label>
							{/if}
							{#if tags.length}
								<label class="field">
									<span>Tag</span>
									<div class="select block">
										<select bind:value={tagFilter} aria-label="Filter by tag">
											<option value={null}>All tags</option>
											{#each tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
										</select>
									</div>
								</label>
							{/if}
							{#if activeCount}
								<button type="button" class="ghost clear" onclick={clearFilters}>
									<Icon name="close" size={14} /> Clear all filters
									<span class="badge">{activeCount}</span>
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if cards.length || baseQuery || bulkDelete || maintenance}
				<div class="pop-wrap">
					<button
						type="button"
						class="icon"
						aria-label="List actions"
						aria-expanded={menuOpen}
						title="List actions"
						onclick={(e) => {
							e.stopPropagation();
							filtersOpen = false;
							menuOpen = !menuOpen;
						}}
					>
						<Icon name="more" size={18} />
					</button>
					{#if menuOpen}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
							{#if cards.length}
								<button
									type="button"
									role="menuitem"
									onclick={() => {
										markAllRead();
										menuOpen = false;
									}}
								>
									<Icon name="check" size={15} /> Mark all read
								</button>
								<button
									type="button"
									role="menuitem"
									onclick={() => {
										archiveAll();
										menuOpen = false;
									}}
								>
									<Icon name="archive" size={15} /> Archive all
								</button>
							{/if}
							{#if baseQuery}
								<button
									type="button"
									role="menuitem"
									onclick={() => {
										saving = true;
										menuOpen = false;
									}}
								>
									<Icon name="bookmark" size={15} /> Save as view
								</button>
							{/if}
							{#if maintenance}
								<button
									type="button"
									role="menuitem"
									onclick={() => {
										menuOpen = false;
										cleanupScope = 'age';
										cleanupOpen = true;
									}}
								>
									<Icon name="trash" size={15} /> Clean up…
								</button>
							{/if}
							{#if bulkDelete}
								<div class="menu-sep" role="separator"></div>
								<button
									type="button"
									role="menuitem"
									class="danger"
									aria-label={bulkDelete.label}
									disabled={bulkDeleting || cards.length === 0}
									onclick={() => {
										menuOpen = false;
										runBulkDelete();
									}}
								>
									<Icon name="trash" size={15} />
									{bulkDeleting ? 'Deleting…' : bulkDelete.label}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	{#if saving}
		<form class="save" onsubmit={saveView}>
			<input bind:value={viewName} type="text" placeholder="Name this view" autocomplete="off" />
			<button type="submit" class="text">Save view</button>
			<button type="button" class="text muted" onclick={() => (saving = false)}>Cancel</button>
		</form>
	{/if}

	{#if saveError}<p class="error">{saveError}</p>{/if}

	<CardList
		{cards}
		loading={all.value === undefined}
		{actions}
		{empty}
		{emptyHint}
		{emptyIcon}
		{grouped}
		{selectedIndex}
		{scrollNonce}
		fadedIds={stickyRead}
		ontriage={triageById}
		onread={noteRead}
		onselect={(i) => (selectedIndex = i)}
		onopen={snapshotQueue}
	/>

	{#if bulkUndo}
		<div class="undo-toast" role="status">
			<span>{bulkUndo.label}</span>
			<button type="button" onclick={applyBulkUndo}>Undo</button>
		</div>
	{/if}

	{#if bulkDeleteResult}
		<div class="undo-toast" role="status">
			<span>{bulkDeleteResult}</span>
		</div>
	{/if}

	{#if cleanupResult}
		<div class="undo-toast" role="status">
			<span>{cleanupResult}</span>
		</div>
	{/if}
</section>

{#if cleanupOpen && maintenance}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="cleanup-backdrop" onclick={() => (cleanupOpen = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="cleanup"
			role="dialog"
			tabindex="-1"
			aria-label="Clean up list"
			onclick={(e) => e.stopPropagation()}
		>
			<h2>Clean up</h2>
			<p class="cleanup-hint">
				Remove old items in bulk. Deleting takes them out of the source too, so a re-syncing backend
				can’t bring them back.
			</p>
			<div class="seg" role="group" aria-label="Clean up scope">
				<button
					type="button"
					class:active={cleanupScope === 'age'}
					aria-pressed={cleanupScope === 'age'}
					onclick={() => (cleanupScope = 'age')}>By age</button
				>
				<button
					type="button"
					class:active={cleanupScope === 'below'}
					aria-pressed={cleanupScope === 'below'}
					disabled={!anchorCard}
					onclick={() => (cleanupScope = 'below')}>Below selected</button
				>
			</div>
			{#if cleanupScope === 'age'}
				<label class="cleanup-field">
					<span>Older than</span>
					<div class="select block">
						<select bind:value={cleanupDays}>
							{#each AGE_PRESETS as p (p.value)}
								<option value={p.value}>{p.label}</option>
							{/each}
						</select>
					</div>
				</label>
			{:else if anchorCard}
				<p class="cleanup-anchor">
					Affects everything older than
					<strong>{anchorCard.title || 'the selected item'}</strong>. Hover or arrow to a row to
					choose the cut-off.
				</p>
			{/if}
			<div class="cleanup-actions">
				<button
					type="button"
					class="btn"
					disabled={cleanupBusy || (cleanupScope === 'below' && !anchorCard)}
					onclick={() => runCleanup('mark-read')}>Mark read</button
				>
				<button
					type="button"
					class="btn danger"
					disabled={cleanupBusy || (cleanupScope === 'below' && !anchorCard)}
					onclick={() => runCleanup('delete')}>Delete</button
				>
				<button type="button" class="text muted" onclick={() => (cleanupOpen = false)}
					>Cancel</button
				>
			</div>
		</div>
	</div>
{/if}

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
	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.select::after {
		content: '';
		position: absolute;
		right: 0.6rem;
		width: 0.4rem;
		height: 0.4rem;
		border-right: 1.5px solid var(--text-muted);
		border-bottom: 1.5px solid var(--text-muted);
		transform: translateY(-2px) rotate(45deg);
		pointer-events: none;
	}
	select {
		appearance: none;
		font-size: var(--text-sm);
		padding: 0.32rem 1.6rem 0.32rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.search {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 2rem;
		padding: 0 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-muted);
		transition: border-color var(--dur-fast) var(--ease);
	}
	.search:focus-within {
		border-color: var(--border-strong);
	}
	.search input {
		width: 7.5rem;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: var(--text-sm);
		color: var(--text);
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
	.icon.on {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
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
	.popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 40;
		min-width: 13rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.7rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-md);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.select.block,
	.select.block select {
		width: 100%;
	}
	.select.block {
		display: flex;
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
	.menu button {
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
	}
	.menu button:hover {
		background: var(--surface-alt);
	}
	.menu button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.menu-sep {
		height: 1px;
		margin: 0.2rem 0.25rem;
		background: var(--border);
	}
	.menu button.danger {
		color: var(--error);
	}
	.menu button.danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 2rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: var(--radius);
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
	.clear {
		justify-content: flex-start;
		color: var(--accent);
	}
	.clear:hover {
		background: var(--accent-soft);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.28rem;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	.icon .badge {
		position: absolute;
		top: -0.4rem;
		right: -0.4rem;
		border: 1.5px solid var(--bg);
	}

	.save {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.9rem;
	}
	.save input {
		flex: 1;
		max-width: 18rem;
		font-size: var(--text-sm);
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}
	.text {
		border: 0;
		background: transparent;
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		padding: 0.32rem 0.4rem;
		cursor: pointer;
	}
	.text.muted {
		color: var(--text-muted);
		font-weight: 500;
	}
	.error {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0 0 0.75rem;
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

	.cleanup-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(2px);
	}
	.cleanup {
		width: min(26rem, 100%);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.1rem 1.2rem 1.2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg, var(--shadow-md));
	}
	.cleanup h2 {
		font-size: var(--text-lg);
		margin: 0;
	}
	.cleanup-hint {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.cleanup-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.cleanup-anchor {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.cleanup-anchor strong {
		color: var(--text);
		font-weight: 600;
	}
	.cleanup-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.2rem;
	}
	.cleanup .btn {
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.cleanup .btn:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.cleanup .btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.cleanup .btn.danger {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 40%, var(--border));
	}
	.cleanup .btn.danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}
	.cleanup .text {
		margin-left: auto;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		padding: 0.32rem 0.4rem;
	}
</style>
