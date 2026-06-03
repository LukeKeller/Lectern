<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import { getSync } from '$lib/sync';

	let { children } = $props();

	const nav = [
		{ id: '/', label: 'Inbox' },
		{ id: '/feed', label: 'Feed' },
		{ id: '/library', label: 'Library' },
		{ id: '/search', label: 'Search' },
		{ id: '/settings', label: 'Settings' }
	] as const;

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	onMount(() => {
		const sync = getSync();
		sync.start();
		return () => sync.stop();
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
	</nav>
	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		color: #1f2933;
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
		border-bottom: 1px solid #e4e7eb;
		padding-bottom: 0.75rem;
		margin-bottom: 1rem;
	}
	.brand {
		font-weight: 700;
		margin-right: auto;
	}
	nav a {
		text-decoration: none;
		color: #52606d;
	}
	nav a.active {
		color: #1f2933;
		font-weight: 600;
	}
	main {
		line-height: 1.5;
	}
</style>
