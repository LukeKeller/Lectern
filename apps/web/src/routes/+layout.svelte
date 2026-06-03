<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getSync } from '$lib/sync';
	import { resolveKey } from '$lib/keyboard';
	import { activeList } from '$lib/list-controller.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { viewsStore } from '$lib/views-store.svelte';
	import { matchesQuery } from '$lib/lists';
	import { SMART_VIEWS } from '$lib/smart-views';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ShortcutsHelp from '$lib/components/ShortcutsHelp.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import type { ThemeMode } from '$lib/typography';
	import type { Card } from '@lectern/shared';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';

	let { children } = $props();

	let paletteOpen = $state(false);
	let drawerOpen = $state(false);
	let helpOpen = $state(false);
	let pending: string | null = null;

	interface NavItem {
		id: string;
		label: string;
		icon: IconName;
	}

	// Mirrors the triage locations + tools. Inbox/Feed/Library are also reachable
	// from the `g i/f/l` keyboard chords. `as const` keeps `id` a literal route so
	// `resolve()` stays type-safe.
	const primary = [
		{ id: '/', label: 'Inbox', icon: 'inbox' },
		{ id: '/later', label: 'Later', icon: 'clock' },
		{ id: '/shortlist', label: 'Shortlist', icon: 'star' },
		{ id: '/archive', label: 'Archive', icon: 'archive' },
		{ id: '/feed', label: 'Feed', icon: 'rss' },
		{ id: '/library', label: 'Library', icon: 'book' }
	] as const satisfies readonly NavItem[];
	const tools = [
		{ id: '/search', label: 'Search', icon: 'search' },
		{ id: '/feeds', label: 'Feeds', icon: 'folder' }
	] as const satisfies readonly NavItem[];

	// Live per-location counts for the nav, mirroring Readwise's sidebar badges.
	// A single toArray keeps the liveQuery simple; the mirror is a personal-scale
	// library so the reduce is cheap and re-runs only when cards change.
	const allCards = liveCards(() => db.cards.toArray());
	const counts = $derived.by(() => {
		const c = { inbox: 0, later: 0, shortlist: 0, archive: 0, feed: 0 };
		for (const card of (allCards.value ?? []) as Card[]) {
			if (card.location in c) c[card.location as keyof typeof c] += 1;
		}
		return c;
	});
	function navCount(id: string): number {
		switch (id) {
			case '/':
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

	const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'auto'];
	const THEME_ICON: Record<ThemeMode, IconName> = { light: 'sun', dark: 'moon', auto: 'auto' };

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
			case 'back':
				if (ctrl?.back) {
					event.preventDefault();
					ctrl.back();
				}
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
		void viewsStore.load();
		const sync = getSync();
		sync.start();
		// Make new deploys reach the user: force a service-worker update check on
		// load, and reload once when a newer worker takes control (the classic
		// "needs a second refresh" PWA gotcha). Guarded so the first install and
		// post-reload states don't loop.
		if ('serviceWorker' in navigator) {
			const hadController = !!navigator.serviceWorker.controller;
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				if (hadController) window.location.reload();
			});
			void navigator.serviceWorker.ready.then((reg) => reg.update()).catch(() => {});
		}
		window.addEventListener('keydown', onKeydown);
		return () => {
			sync.stop();
			window.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="topbar">
	<button
		type="button"
		class="icon-btn"
		aria-label="Open navigation"
		aria-expanded={drawerOpen}
		onclick={() => (drawerOpen = true)}
	>
		<Icon name="menu" />
	</button>
	<a class="brand" href={resolve('/')}>
		<span class="mark" aria-hidden="true"></span>
		Lectern
	</a>
	<button
		type="button"
		class="icon-btn"
		aria-label="Open command palette"
		onclick={() => (paletteOpen = true)}
	>
		<Icon name="search" />
	</button>
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
		<p class="section">Library</p>
		<ul>
			{#each primary as item (item.id)}
				<li>
					<a
						href={resolve(item.id)}
						class:active={isActive(item.id)}
						aria-current={isActive(item.id) ? 'page' : undefined}
					>
						<Icon name={item.icon} />
						<span>{item.label}</span>
						{#if navCount(item.id) > 0}<span class="nav-count">{navCount(item.id)}</span>{/if}
					</a>
				</li>
			{/each}
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
		</ul>

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
							<Icon name="bookmark" />
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
				title={`Theme: ${readerSettings.current.theme}`}
				aria-label={`Theme: ${readerSettings.current.theme}. Switch theme.`}
			>
				<Icon name={THEME_ICON[readerSettings.current.theme]} size={18} />
				<span class="theme-label">{readerSettings.current.theme}</span>
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
	</div>
</aside>

<main>
	{@render children()}
</main>

<CommandPalette bind:open={paletteOpen} />

{#if helpOpen}
	<ShortcutsHelp onclose={() => (helpOpen = false)} />
{/if}

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
		border-radius: 5px;
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
		height: var(--topbar-h);
		display: none;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.5rem;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--border);
	}
	.topbar .brand {
		margin: 0 auto;
		font-size: 1rem;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease);
	}
	.icon-btn:hover {
		background: var(--surface-alt);
		color: var(--text);
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
	nav a:hover,
	.foot-link:hover {
		background: var(--surface-alt);
		color: var(--text);
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
		text-transform: capitalize;
	}
	.kbd {
		margin-left: auto;
	}
	kbd {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.02em;
	}

	main {
		margin-left: var(--sidebar-w);
		padding: clamp(1.5rem, 3vw, 3rem) clamp(1.1rem, 4vw, 3rem) 5rem;
	}

	@media (max-width: 820px) {
		.topbar {
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
			padding-top: calc(var(--topbar-h) + 1rem);
		}
	}
</style>
