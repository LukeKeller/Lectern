<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import { getSync } from '$lib/sync';
	import { resolveKey } from '$lib/keyboard';
	import { activeList } from '$lib/list-controller.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { viewsStore } from '$lib/views-store.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';

	let { children } = $props();

	let paletteOpen = $state(false);
	let pending: string | null = null;

	const nav = [
		{ id: '/', label: 'Inbox' },
		{ id: '/feed', label: 'Feed' },
		{ id: '/feeds', label: 'Feeds' },
		{ id: '/library', label: 'Library' },
		{ id: '/views', label: 'Views' },
		{ id: '/search', label: 'Search' },
		{ id: '/settings', label: 'Settings' }
	] as const;

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		const path = page.url.pathname;
		return path === href || path.startsWith(`${href}/`);
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
		if (paletteOpen || isEditable(event.target)) {
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
			case 'palette':
				event.preventDefault();
				paletteOpen = true;
				break;
		}
	}

	onMount(() => {
		readerSettings.applyTheme();
		void viewsStore.load();
		const sync = getSync();
		sync.start();
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

<div class="app">
	<nav>
		<span class="brand">Lectern</span>
		{#each nav as item (item.id)}
			<a href={resolve(item.id)} class:active={isActive(item.id)}>{item.label}</a>
		{/each}
		{#each viewsStore.pinned as view (view.id)}
			<a href={resolve('/views/[id]', { id: view.id })} class:active={isActive(`/views/${view.id}`)}
				>{view.name}</a
			>
		{/each}
		<button type="button" class="cmdk" onclick={() => (paletteOpen = true)} aria-label="Commands">
			⌘K
		</button>
	</nav>
	<main>
		{@render children()}
	</main>
</div>

<CommandPalette bind:open={paletteOpen} />

<style>
	:global(:root) {
		--bg: #ffffff;
		--surface: #ffffff;
		--surface-alt: #f5f7fa;
		--text: #1f2933;
		--text-muted: #7b8794;
		--border: #e4e7eb;
		--accent: #3b82f6;
		--error: #c53030;
		--ok: #2f855a;
	}
	:global(:root[data-theme='dark']) {
		--bg: #15181c;
		--surface: #1c2127;
		--surface-alt: #252b33;
		--text: #e4e7eb;
		--text-muted: #9aa5b1;
		--border: #2f363d;
		--accent: #60a5fa;
		--error: #f98080;
		--ok: #68d391;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme])) {
			--bg: #15181c;
			--surface: #1c2127;
			--surface-alt: #252b33;
			--text: #e4e7eb;
			--text-muted: #9aa5b1;
			--border: #2f363d;
			--accent: #60a5fa;
			--error: #f98080;
			--ok: #68d391;
		}
	}
	:global(body) {
		margin: 0;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		background: var(--bg);
		color: var(--text);
	}
	.app {
		max-width: 720px;
		margin: 0 auto;
		padding: 1rem;
	}
	nav {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.75rem;
		margin-bottom: 1rem;
	}
	.brand {
		font-weight: 700;
		margin-right: auto;
	}
	nav a {
		text-decoration: none;
		color: var(--text-muted);
	}
	nav a.active {
		color: var(--text);
		font-weight: 600;
	}
	.cmdk {
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface-alt);
		color: var(--text-muted);
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		cursor: pointer;
	}
	main {
		line-height: 1.5;
	}
</style>
