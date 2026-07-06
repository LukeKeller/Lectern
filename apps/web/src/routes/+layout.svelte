<script lang="ts">
	import '../app.css';
	import '$lib/styles/prose.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getSync } from '$lib/sync';
	import { syncStatus } from '$lib/sync-status.svelte';
	import { resolveKey } from '$lib/keyboard';
	import { activeList } from '$lib/list-controller.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { appSettings } from '$lib/app-settings.svelte';
	import { viewsStore } from '$lib/views-store.svelte';
	import { matchesQuery } from '$lib/lists';
	import { SMART_VIEWS } from '$lib/smart-views';
	import { buildEdition, latestIssueKey, yesterdayKey } from '$lib/newspaper';
	import { buildMagazines } from '$lib/magazine';
	import { feedsStore } from '$lib/feeds-store.svelte';
	import { feedGroupKey } from '$lib/feeds';
	import { buildPublications } from '$lib/newsletters';
	import { SvelteSet } from 'svelte/reactivity';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import AddLinkDialog from '$lib/components/AddLinkDialog.svelte';
	import ShortcutsHelp from '$lib/components/ShortcutsHelp.svelte';
	import WhatsNew from '$lib/components/WhatsNew.svelte';
	import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
	import ListenPlayer from '$lib/components/ListenPlayer.svelte';
	import SyncStatus from '$lib/components/SyncStatus.svelte';
	import { ttsPlayer } from '$lib/tts-player.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import { THEME_SWATCHES, type ThemeMode } from '$lib/typography';
	import type { Card } from '@lectern/shared';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';

	let { children } = $props();

	let paletteOpen = $state(false);
	let drawerOpen = $state(false);
	let helpOpen = $state(false);
	let addOpen = $state(false);
	let pending: string | null = null;

	// The reader supplies its own toolbar (with Back); on phones, the app top bar
	// above it would stack two chrome bars, so it is hidden on that route.
	const isReader = $derived(page.route.id === '/read/[id]');

	interface NavItem {
		id: string;
		label: string;
		icon: IconName;
	}

	// The triage buckets shown as children of the collapsible Library group. Each
	// is also reachable from a `g` keyboard chord. `as const` keeps `id` a literal
	// route so `resolve()` stays type-safe.
	const libraryItems = [
		{ id: '/inbox', label: 'Inbox', icon: 'inbox' },
		{ id: '/later', label: 'Later', icon: 'clock' },
		{ id: '/shortlist', label: 'Shortlist', icon: 'star' },
		{ id: '/archive', label: 'Archive', icon: 'archive' }
	] as const satisfies readonly NavItem[];
	const tools = [
		{ id: '/search', label: 'Search', icon: 'search' }
	] as const satisfies readonly NavItem[];

	// Live per-location counts for the nav, mirroring Readwise's sidebar badges.
	// A single toArray keeps the liveQuery simple; the mirror is a personal-scale
	// library so the reduce is cheap and re-runs only when cards change.
	const allCards = liveCards(() => db.cards.toArray());
	const counts = $derived.by(() => {
		const c = { inbox: 0, later: 0, shortlist: 0, archive: 0, feed: 0 };
		for (const card of (allCards.value ?? []) as Card[]) {
			// Feed mirrors Readwise's "Unseen" badge: count only unread items so the
			// number tracks what's left to read, not the total ever fetched.
			if (card.location === 'feed') {
				if (card.readState !== 'finished') c.feed += 1;
			} else if (card.location in c) {
				c[card.location as keyof typeof c] += 1;
			}
		}
		return c;
	});
	// Counts for the "Daily" desk: stories in the latest newspaper edition and the
	// number of bound magazine issues. Computed from the same mirror as the lists.
	const dailyCounts = $derived.by(() => {
		const list = (allCards.value ?? []) as Card[];
		const edition = buildEdition(list, latestIssueKey(list, yesterdayKey()));
		return { newspaper: edition.total, magazine: buildMagazines(list).length };
	});

	// Unread feed counts keyed by publication (card.siteName === MiniFlux feed
	// title), so the per-feed/folder badges in the tree match the top "Feed"
	// badge and the per-feed list (which filters on the same key). Derived from
	// the local mirror so the counts work offline; the feeds *structure* still
	// needs the feeds store.
	const feedUnread = $derived.by(() => {
		const m: Record<string, number> = {};
		for (const card of (allCards.value ?? []) as Card[]) {
			if (card.location === 'feed' && card.readState !== 'finished' && card.siteName) {
				m[card.siteName] = (m[card.siteName] ?? 0) + 1;
			}
		}
		return m;
	});
	function folderUnread(titles: string[]): number {
		let n = 0;
		for (const t of titles) n += feedUnread[t] ?? 0;
		return n;
	}

	// Newsletter publications for the sidebar drop-down, grouped by sender domain
	// (the same shelf model as the Newsletters page). Derived from the local mirror
	// so the list and its per-publication unread badges work offline; the group's
	// badge sums the unread across publications, mirroring the Feed badge.
	const publications = $derived(
		buildPublications(((allCards.value ?? []) as Card[]).filter((c) => c.category === 'email'))
	);
	const newsletterUnread = $derived(publications.reduce((n, p) => n + p.unread, 0));

	// Sidebar feed-tree disclosure state, persisted so the tree reopens as the
	// user left it. Top-level open flag + the set of expanded folder keys.
	let feedsOpen = $state(loadFeedsOpen());
	const openFolders = new SvelteSet<string>(loadOpenFolders());
	function loadFeedsOpen(): boolean {
		return (
			typeof localStorage !== 'undefined' && localStorage.getItem('lectern.feedsNav.open') === '1'
		);
	}
	function loadOpenFolders(): string[] {
		if (typeof localStorage === 'undefined') return [];
		try {
			const parsed = JSON.parse(localStorage.getItem('lectern.feedsNav.folders') ?? '[]');
			return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
		} catch {
			return [];
		}
	}
	function toggleFolder(key: string) {
		if (openFolders.has(key)) openFolders.delete(key);
		else openFolders.add(key);
	}
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('lectern.feedsNav.open', feedsOpen ? '1' : '0');
		}
	});
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('lectern.feedsNav.folders', JSON.stringify([...openFolders]));
		}
	});

	// Library group disclosure — defaults open so the triage buckets stay
	// discoverable; persisted as soon as the user toggles it.
	let libraryOpen = $state(loadLibraryOpen());
	function loadLibraryOpen(): boolean {
		return (
			typeof localStorage === 'undefined' || localStorage.getItem('lectern.libraryNav.open') !== '0'
		);
	}
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('lectern.libraryNav.open', libraryOpen ? '1' : '0');
		}
	});

	// Newsletter group disclosure — defaults closed (the rack can be long); the
	// twisty toggles it and the choice persists, matching the Feed tree.
	let newslettersOpen = $state(loadNewslettersOpen());
	function loadNewslettersOpen(): boolean {
		return (
			typeof localStorage !== 'undefined' &&
			localStorage.getItem('lectern.newslettersNav.open') === '1'
		);
	}
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('lectern.newslettersNav.open', newslettersOpen ? '1' : '0');
		}
	});

	function navCount(id: string): number {
		switch (id) {
			case '/inbox':
				return counts.inbox;
			case '/later':
				return counts.later;
			case '/shortlist':
				return counts.shortlist;
			case '/archive':
				return counts.archive;
			case '/feed':
				return counts.feed;
			case '/library':
				return counts.inbox + counts.later + counts.shortlist + counts.archive;
			default:
				return 0;
		}
	}

	// The footer button is a quick light/dark/auto toggle; the full palette
	// (sepia, newsprint, black, contrast) lives in Settings → Reading. From any
	// of those, one tap lands back on `light`.
	const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'auto'];
	const THEME_ICON: Record<ThemeMode, IconName> = {
		light: 'sun',
		sepia: 'sun',
		newsprint: 'sun',
		eink: 'sun',
		dark: 'moon',
		black: 'moon',
		contrast: 'moon',
		auto: 'auto'
	};

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		const path = page.url.pathname;
		return path === href || path.startsWith(`${href}/`);
	}

	function cycleTheme() {
		const current = readerSettings.current.theme;
		const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
		readerSettings.update({ theme: next });
	}

	function isEditable(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
	}

	function onKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			paletteOpen = !paletteOpen;
			pending = null;
			return;
		}
		// `?` (Shift+/) toggles the shortcut sheet; never while typing or in the palette.
		if (event.key === '?' && !paletteOpen && !isEditable(event.target)) {
			event.preventDefault();
			helpOpen = !helpOpen;
			pending = null;
			return;
		}
		if (event.key === 'Escape') {
			if (helpOpen) {
				helpOpen = false;
				return;
			}
			if (drawerOpen) {
				drawerOpen = false;
				return;
			}
			// otherwise fall through so the reading view can go back
		}
		if (paletteOpen || helpOpen || isEditable(event.target)) {
			pending = null;
			return;
		}
		const result = resolveKey(pending, event);
		pending = result.pending;
		const action = result.action;
		if (!action) return;
		const ctrl = activeList.current;
		switch (action.type) {
			case 'navigate':
				event.preventDefault();
				void goto(resolve(action.path));
				break;
			case 'focusSearch':
				event.preventDefault();
				void goto(resolve('/search'));
				break;
			case 'move':
				if (ctrl) {
					event.preventDefault();
					ctrl.move(action.delta);
				}
				break;
			case 'open':
				if (ctrl) {
					event.preventDefault();
					ctrl.open();
				}
				break;
			case 'setLocation':
				if (ctrl) {
					event.preventDefault();
					ctrl.triage(action.location);
				}
				break;
			case 'markRead':
				if (ctrl?.markRead) {
					event.preventDefault();
					ctrl.markRead();
				} else if (ctrl) {
					// The reader has no mark-read; Space keeps advancing the paragraph
					// focus (skim) there instead of going inert.
					event.preventDefault();
					ctrl.move(1);
				}
				break;
			case 'refresh':
				if (ctrl?.refresh) {
					event.preventDefault();
					ctrl.refresh();
				}
				break;
			case 'back':
				if (ctrl?.back) {
					event.preventDefault();
					ctrl.back();
				}
				break;
			case 'addLink':
				event.preventDefault();
				addOpen = true;
				break;
			case 'palette':
				event.preventDefault();
				paletteOpen = true;
				break;
		}
	}

	// Close the mobile drawer whenever the route changes.
	$effect(() => {
		// Touch pathname so the effect re-runs on navigation, then close the drawer.
		if (page.url.pathname) drawerOpen = false;
	});

	onMount(() => {
		readerSettings.applyTheme();
		// On first load, send the user to their chosen default view. Only redirect
		// from the root path so deep links (and later in-app navigation to Inbox)
		// are untouched; runs once since the layout mounts a single time.
		const target = appSettings.current.defaultView;
		if (target && target !== '/' && page.url.pathname === '/') {
			// defaultView is validated against the LANDING_VIEWS allowlist on read.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(target, { replaceState: true });
		}
		// Dev-only: populate the local store with mock cards when it's empty so the
		// views have content without a backend. Dynamically imported + DEV-guarded so
		// it's stripped from production builds.
		if (import.meta.env.DEV) {
			void import('$lib/dev-seed').then((m) => m.seedMockData());
		}
		void viewsStore.load();
		void feedsStore.load();
		ttsPlayer.init();
		const sync = getSync();
		sync.start();
		syncStatus.start();
		// Service-worker update lifecycle (deploy detection + "new version" prompt)
		// lives in <UpdatePrompt>.
		window.addEventListener('keydown', onKeydown);
		return () => {
			sync.stop();
			window.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<div class="topbar" class:reader-route={isReader}>
	<a class="brand" href={resolve('/')}>
		<span class="mark" aria-hidden="true"></span>
		Lectern
	</a>
</div>

{#if drawerOpen}
	<button
		type="button"
		class="scrim"
		aria-label="Close navigation"
		onclick={() => (drawerOpen = false)}
	></button>
{/if}

<aside class="sidebar" class:open={drawerOpen}>
	<a class="brand brand-side" href={resolve('/')} onclick={() => (drawerOpen = false)}>
		<span class="mark" aria-hidden="true"></span>
		Lectern
	</a>

	<nav aria-label="Primary">
		<ul>
			<li>
				<a
					href={resolve('/')}
					class:active={isActive('/')}
					aria-current={isActive('/') ? 'page' : undefined}
				>
					<Icon name="home" />
					<span>Home</span>
				</a>
			</li>

			<li class="group">
				<a
					href={resolve('/library')}
					class="group-link"
					class:active={isActive('/library')}
					aria-current={isActive('/library') ? 'page' : undefined}
				>
					<Icon name="book" />
					<span>Library</span>
					{#if navCount('/library') > 0}<span class="nav-count">{navCount('/library')}</span>{/if}
				</a>
				<button
					type="button"
					class="twisty"
					aria-expanded={libraryOpen}
					aria-label={libraryOpen ? 'Collapse Library' : 'Expand Library'}
					onclick={() => (libraryOpen = !libraryOpen)}
				>
					<span class="chev" class:open={libraryOpen}><Icon name="chevron" size={14} /></span>
				</button>
			</li>
			{#if libraryOpen}
				{#each libraryItems as item (item.id)}
					<li>
						<a
							href={resolve(item.id)}
							class="child"
							class:active={isActive(item.id)}
							aria-current={isActive(item.id) ? 'page' : undefined}
						>
							<Icon name={item.icon} size={17} />
							<span>{item.label}</span>
							{#if navCount(item.id) > 0}<span class="nav-count">{navCount(item.id)}</span>{/if}
						</a>
					</li>
				{/each}
			{/if}

			<li class="group">
				<a
					href={resolve('/feed')}
					class="group-link"
					class:active={isActive('/feed')}
					aria-current={isActive('/feed') ? 'page' : undefined}
				>
					<Icon name="rss" />
					<span>Feed</span>
					{#if navCount('/feed') > 0}<span class="nav-count">{navCount('/feed')}</span>{/if}
				</a>
				<button
					type="button"
					class="twisty"
					aria-expanded={feedsOpen}
					aria-label={feedsOpen ? 'Collapse Feed' : 'Expand Feed'}
					onclick={() => (feedsOpen = !feedsOpen)}
				>
					<span class="chev" class:open={feedsOpen}><Icon name="chevron" size={14} /></span>
				</button>
			</li>
			{#if feedsOpen}
				{#each feedsStore.grouped as group (feedGroupKey(group))}
					{@const fkey = feedGroupKey(group)}
					{@const folderOpen = openFolders.has(fkey)}
					{@const unread = folderUnread(group.feeds.map((f) => f.title))}
					<li class="tree-li">
						<button
							type="button"
							class="tree-row"
							aria-expanded={folderOpen}
							onclick={() => toggleFolder(fkey)}
						>
							<span class="chev" class:open={folderOpen}><Icon name="chevron" size={12} /></span>
							<Icon name="folder" size={15} />
							<span class="tree-label">{group.title}</span>
							{#if unread > 0}<span class="nav-count">{unread}</span>{/if}
						</button>
						{#if folderOpen}
							<ul class="feed-children">
								{#each group.feeds as feed (feed.id)}
									{@const feedCount = feedUnread[feed.title] ?? 0}
									{@const href = `${resolve('/feed')}?feed=${encodeURIComponent(feed.title)}`}
									<li>
										<!-- resolve() owns the path; the query string is appended for the per-feed filter -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											{href}
											class:active={page.url.pathname === resolve('/feed') &&
												page.url.searchParams.get('feed') === feed.title}
										>
											<span class="tree-label">{feed.title}</span>
											{#if feedCount > 0}<span class="nav-count">{feedCount}</span>{/if}
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
				{#if feedsStore.loaded && feedsStore.grouped.length === 0}
					<li class="tree-empty">No feeds yet</li>
				{/if}
			{/if}

			<li class="group">
				<a
					href={resolve('/collections/newsletters')}
					class="group-link"
					class:active={isActive('/collections/newsletters')}
					aria-current={isActive('/collections/newsletters') ? 'page' : undefined}
				>
					<Icon name="mail" />
					<span>Newsletters</span>
					{#if newsletterUnread > 0}<span class="nav-count">{newsletterUnread}</span>{/if}
				</a>
				<button
					type="button"
					class="twisty"
					aria-expanded={newslettersOpen}
					aria-label={newslettersOpen ? 'Collapse Newsletters' : 'Expand Newsletters'}
					onclick={() => (newslettersOpen = !newslettersOpen)}
				>
					<span class="chev" class:open={newslettersOpen}><Icon name="chevron" size={14} /></span>
				</button>
			</li>
			{#if newslettersOpen}
				{#each publications as pub (pub.key)}
					{@const href = `${resolve('/collections/newsletters')}?pub=${encodeURIComponent(pub.key)}`}
					<li>
						<!-- resolve() owns the path; the query string carries the publication filter -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							{href}
							class="child"
							class:active={page.url.pathname === resolve('/collections/newsletters') &&
								page.url.searchParams.get('pub') === pub.key}
						>
							<span class="tree-label">{pub.name}</span>
							{#if pub.unread > 0}<span class="nav-count">{pub.unread}</span>{/if}
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
				{#if publications.length === 0}
					<li class="tree-empty">No newsletters yet</li>
				{/if}
			{/if}
		</ul>

		<p class="section">Daily</p>
		<ul>
			<li>
				<a
					href={resolve('/newspaper')}
					class:active={isActive('/newspaper')}
					aria-current={isActive('/newspaper') ? 'page' : undefined}
				>
					<Icon name="newspaper" />
					<span>Newspaper</span>
					{#if dailyCounts.newspaper > 0}<span class="nav-count">{dailyCounts.newspaper}</span>{/if}
				</a>
			</li>
			<li>
				<a
					href={resolve('/magazine')}
					class:active={isActive('/magazine')}
					aria-current={isActive('/magazine') ? 'page' : undefined}
				>
					<Icon name="magazine" />
					<span>Magazine</span>
					{#if dailyCounts.magazine > 0}<span class="nav-count">{dailyCounts.magazine}</span>{/if}
				</a>
			</li>
		</ul>

		<p class="section">Collections</p>
		<ul>
			{#each SMART_VIEWS as view (view.key)}
				{@const count = ((allCards.value ?? []) as Card[]).filter(view.predicate).length}
				<li>
					<a
						href={resolve('/collections/[key]', { key: view.key })}
						class:active={isActive(`/collections/${view.key}`)}
						aria-current={isActive(`/collections/${view.key}`) ? 'page' : undefined}
					>
						<Icon name={view.icon} />
						<span>{view.label}</span>
						{#if count > 0}<span class="nav-count">{count}</span>{/if}
					</a>
				</li>
			{/each}
		</ul>

		<p class="section">Tools</p>
		<ul>
			<li>
				<button type="button" class="nav-btn" onclick={() => (addOpen = true)}>
					<Icon name="plus" />
					<span>Add link</span>
				</button>
			</li>
			{#each tools as item (item.id)}
				<li>
					<a
						href={resolve(item.id)}
						class:active={isActive(item.id)}
						aria-current={isActive(item.id) ? 'page' : undefined}
					>
						<Icon name={item.icon} />
						<span>{item.label}</span>
					</a>
				</li>
			{/each}
			<li>
				<a
					href={resolve('/feeds')}
					class:active={isActive('/feeds')}
					aria-current={isActive('/feeds') ? 'page' : undefined}
				>
					<Icon name="folder" />
					<span>Manage feeds</span>
				</a>
			</li>
		</ul>

		{#if ttsPlayer.hasQueue}
			<p class="section">Playlist</p>
			<ul>
				{#each ttsPlayer.queue as item, i (item.id)}
					<li>
						<button
							type="button"
							class="playlist-item"
							class:active={i === ttsPlayer.index}
							onclick={() => ttsPlayer.playIndex(i)}
						>
							<Icon
								name={i === ttsPlayer.index && ttsPlayer.status === 'playing' ? 'pause' : 'play'}
								size={13}
							/>
							<span class="tree-label">{item.title || 'Untitled'}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if viewsStore.pinned.length}
			<p class="section">Pinned</p>
			<ul>
				{#each viewsStore.pinned as view (view.id)}
					{@const count = ((allCards.value ?? []) as Card[]).filter((c) =>
						matchesQuery(c, view.query)
					).length}
					<li>
						<a
							href={resolve('/views/[id]', { id: view.id })}
							class:active={isActive(`/views/${view.id}`)}
							aria-current={isActive(`/views/${view.id}`) ? 'page' : undefined}
						>
							{#if view.icon}
								<span class="view-emoji" aria-hidden="true">{view.icon}</span>
							{:else}
								<Icon name="bookmark" />
							{/if}
							<span>{view.name}</span>
							{#if count > 0}<span class="nav-count">{count}</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</nav>

	<div class="foot">
		<a href={resolve('/views')} class:active={isActive('/views')} class="foot-link">
			<Icon name="views" size={18} />
			<span>Views</span>
		</a>
		<a href={resolve('/settings')} class:active={isActive('/settings')} class="foot-link">
			<Icon name="settings" size={18} />
			<span>Settings</span>
		</a>
		<div class="foot-row">
			<button
				type="button"
				class="ghost"
				onclick={cycleTheme}
				title={`Theme: ${THEME_SWATCHES[readerSettings.current.theme].label}`}
				aria-label={`Theme: ${THEME_SWATCHES[readerSettings.current.theme].label}. Switch theme.`}
			>
				<Icon name={THEME_ICON[readerSettings.current.theme]} size={18} />
				<span class="theme-label">{THEME_SWATCHES[readerSettings.current.theme].label}</span>
			</button>
			<button
				type="button"
				class="ghost kbd"
				onclick={() => (paletteOpen = true)}
				aria-label="Open command palette"
			>
				<kbd>⌘K</kbd>
			</button>
		</div>
		<SyncStatus />
	</div>
</aside>

<main class:reader-route={isReader}>
	{@render children()}
</main>

<!-- Mobile bottom navigation: thumb-reachable primary destinations plus a central
     Add button for saving links. Hidden on desktop and on the reader route (which
     supplies its own toolbar). -->
<nav class="bottomnav" class:reader-route={isReader} aria-label="Primary">
	<a
		href={resolve('/inbox')}
		class="bn-item"
		class:active={isActive('/inbox')}
		aria-current={isActive('/inbox') ? 'page' : undefined}
	>
		<span class="bn-ico">
			<Icon name="inbox" size={22} />
			{#if counts.inbox > 0}<span class="bn-count" aria-hidden="true"></span>{/if}
		</span>
		<span class="bn-label">Inbox</span>
	</a>
	<a
		href={resolve('/feed')}
		class="bn-item"
		class:active={isActive('/feed')}
		aria-current={isActive('/feed') ? 'page' : undefined}
	>
		<span class="bn-ico">
			<Icon name="rss" size={22} />
			{#if counts.feed > 0}<span class="bn-count" aria-hidden="true"></span>{/if}
		</span>
		<span class="bn-label">Feed</span>
	</a>
	<button
		type="button"
		class="bn-item bn-add"
		onclick={() => (addOpen = true)}
		aria-label="Save a link"
	>
		<span class="bn-fab"><Icon name="plus" size={24} /></span>
	</button>
	<a
		href={resolve('/search')}
		class="bn-item"
		class:active={isActive('/search')}
		aria-current={isActive('/search') ? 'page' : undefined}
	>
		<span class="bn-ico"><Icon name="search" size={22} /></span>
		<span class="bn-label">Search</span>
	</a>
	<button
		type="button"
		class="bn-item"
		class:active={drawerOpen}
		aria-label="Open navigation menu"
		aria-expanded={drawerOpen}
		onclick={() => (drawerOpen = true)}
	>
		<span class="bn-ico"><Icon name="menu" size={22} /></span>
		<span class="bn-label">Menu</span>
	</button>
</nav>

<CommandPalette bind:open={paletteOpen} onAddLink={() => (addOpen = true)} />
<AddLinkDialog bind:open={addOpen} />

{#if helpOpen}
	<ShortcutsHelp onclose={() => (helpOpen = false)} />
{/if}

<WhatsNew />
<UpdatePrompt />
<ListenPlayer />

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 700;
		font-size: 1.05rem;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	.mark {
		width: 1.1rem;
		height: 1.1rem;
		border-radius: var(--radius-sm);
		background:
			linear-gradient(var(--accent), var(--accent)) center / 1.6px 70% no-repeat,
			var(--accent-soft);
		border: 1.5px solid var(--accent);
		box-sizing: border-box;
	}

	/* Mobile top bar (hidden on desktop). */
	.topbar {
		position: fixed;
		inset: 0 0 auto 0;
		z-index: 30;
		height: calc(var(--topbar-h) + env(safe-area-inset-top));
		display: none;
		align-items: center;
		gap: 0.5rem;
		padding: env(safe-area-inset-top) 0.5rem 0;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.topbar .brand {
		margin: 0 auto;
		font-size: 1rem;
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 35;
		border: 0;
		padding: 0;
		background: rgba(20, 16, 10, 0.32);
		display: none;
		cursor: default;
	}

	.sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 40;
		width: var(--sidebar-w);
		display: flex;
		flex-direction: column;
		padding: 1.15rem 0.7rem 0.9rem;
		background: var(--bg-sunken);
		border-right: 1px solid var(--border);
	}
	.brand-side {
		padding: 0.2rem 0.5rem 0.9rem;
	}

	nav {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
	nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.section {
		margin: 0.9rem 0.55rem 0.3rem;
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	nav > .section:first-child {
		margin-top: 0.15rem;
	}

	nav a,
	.nav-btn,
	.foot-link {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.46rem 0.55rem;
		border-radius: var(--radius);
		color: var(--text-muted);
		font-size: var(--text-base);
		font-weight: 500;
		line-height: 1.2;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	nav a span,
	.foot-link span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.view-emoji {
		flex-shrink: 0;
		width: 1.15rem;
		text-align: center;
		font-size: 1.02rem;
		line-height: 1;
	}
	nav a:hover,
	.nav-btn:hover,
	.foot-link:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.nav-btn {
		width: 100%;
		border: 0;
		background: transparent;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}
	nav a.active,
	.foot-link.active {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}
	.nav-count {
		margin-left: auto;
		flex-shrink: 0;
		font-size: var(--text-2xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		opacity: 0.85;
	}
	nav a.active .nav-count {
		color: var(--accent);
	}

	/* Collapsible top-level group (Library, Feed): the row is a full-width nav
	   link with a chevron toggle overlaid on its left, so clicking the row
	   navigates while the chevron alone expands/collapses — like Reader's
	   sidebar sections. */
	.group {
		position: relative;
	}
	.group-link {
		padding-left: 2rem;
	}
	.twisty {
		position: absolute;
		left: 0.1rem;
		top: 0;
		bottom: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease);
	}
	.twisty:hover {
		color: var(--text);
	}
	/* Sub-items under a group (triage buckets): one step quieter, indented to sit
	   under the group's label. */
	.child {
		padding-left: 2rem;
		font-size: var(--text-sm);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--dur-fast) var(--ease);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	/* Folder rows: a button styled like a nav link, indented under Feeds. */
	.tree-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.4rem 0.55rem 0.4rem 1.75rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		line-height: 1.2;
		text-align: left;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.tree-row:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.tree-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tree-row .nav-count {
		margin-left: auto;
	}
	/* Sidebar playlist: a play/pause row per queued listen item. */
	.playlist-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		line-height: 1.2;
		text-align: left;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.playlist-item:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.playlist-item.active {
		color: var(--accent);
		font-weight: 600;
	}
	/* Feed leaves: nudged a further step in from their folder. */
	.feed-children a {
		padding-left: 2.9rem;
		font-size: var(--text-sm);
	}
	.tree-empty {
		padding: 0.4rem 0.55rem 0.4rem 1.35rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
		opacity: 0.7;
	}

	.foot {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
		margin-top: 0.4rem;
	}
	.foot-row {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.25rem;
		padding: 0 0.05rem;
	}
	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.55rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.ghost:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.theme-label {
		white-space: nowrap;
	}
	.kbd {
		margin-left: auto;
	}
	kbd {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.02em;
	}

	/* Mobile bottom navigation (hidden on desktop; revealed at the 820px break). */
	.bottomnav {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 30;
		display: none;
		align-items: stretch;
		height: calc(var(--bottomnav-h) + env(safe-area-inset-bottom));
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--bg);
		border-top: 1px solid var(--border);
	}
	.bn-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.12rem;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		font-family: inherit;
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease);
		-webkit-tap-highlight-color: transparent;
	}
	.bn-item:hover {
		color: var(--text);
	}
	.bn-item.active {
		color: var(--accent);
	}
	.bn-ico {
		position: relative;
		display: inline-flex;
	}
	.bn-label {
		font-size: var(--text-2xs);
		font-weight: 600;
		line-height: 1;
	}
	/* A small unread dot on the icon, mirroring the sidebar count badges. */
	.bn-count {
		position: absolute;
		top: -2px;
		right: -3px;
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--accent);
		box-shadow: 0 0 0 2px var(--bg);
	}
	/* Center Add button: an accent disc that lifts above the bar. */
	.bn-add {
		flex: 0 0 auto;
		padding: 0 0.6rem;
	}
	.bn-fab {
		display: grid;
		place-items: center;
		width: 2.85rem;
		height: 2.85rem;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--accent-contrast);
		box-shadow: var(--shadow-md);
		transition: transform var(--dur-fast) var(--ease);
	}
	.bn-add:active .bn-fab {
		transform: scale(0.92);
	}

	main {
		margin-left: var(--sidebar-w);
		padding: clamp(1.5rem, 3vw, 3rem) clamp(1.1rem, 4vw, 3rem)
			calc(5rem + env(safe-area-inset-bottom));
	}

	@media (max-width: 820px) {
		.topbar {
			display: flex;
		}
		.bottomnav {
			display: flex;
		}
		.scrim {
			display: block;
		}
		.sidebar {
			transform: translateX(-100%);
			box-shadow: var(--shadow);
			transition: transform var(--dur) var(--ease);
		}
		.sidebar.open {
			transform: translateX(0);
		}
		main {
			margin-left: 0;
			padding-top: calc(var(--topbar-h) + env(safe-area-inset-top) + 1rem);
			/* Reserve space for the fixed bottom nav so content clears it. */
			padding-bottom: calc(var(--bottomnav-h) + env(safe-area-inset-bottom) + 1rem);
		}
	}
	/* Reader route on phones: the reader's own toolbar (with Back) is the only
	   chrome — drop the app bar and the bottom nav, plus the padding that reserved
	   space for them. */
	@media (max-width: 640px) {
		.topbar.reader-route {
			display: none;
		}
		.bottomnav.reader-route {
			display: none;
		}
		main.reader-route {
			padding-top: calc(env(safe-area-inset-top) + 0.75rem);
			padding-bottom: calc(env(safe-area-inset-bottom) + 0.75rem);
		}
	}
</style>
