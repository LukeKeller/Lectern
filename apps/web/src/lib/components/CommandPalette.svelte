<script lang="ts">
	import type { Location } from '@lectern/shared';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { activeList } from '$lib/list-controller.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { viewsStore } from '$lib/views-store.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	interface Command {
		id: string;
		label: string;
		run: () => void;
	}

	let query = $state('');
	let cursor = $state(0);
	let input = $state<HTMLInputElement | null>(null);

	const commands = $derived.by<Command[]>(() => {
		const list: Command[] = [
			{ id: 'go-inbox', label: 'Go to Inbox', run: () => void goto(resolve('/')) },
			{ id: 'go-feed', label: 'Go to Feed', run: () => void goto(resolve('/feed')) },
			{ id: 'go-library', label: 'Go to Library', run: () => void goto(resolve('/library')) },
			{ id: 'go-search', label: 'Go to Search', run: () => void goto(resolve('/search')) },
			{ id: 'go-settings', label: 'Go to Settings', run: () => void goto(resolve('/settings')) },
			{ id: 'go-views', label: 'Go to Views', run: () => void goto(resolve('/views')) },
			{
				id: 'theme-light',
				label: 'Theme: Light',
				run: () => readerSettings.update({ theme: 'light' })
			},
			{
				id: 'theme-dark',
				label: 'Theme: Dark',
				run: () => readerSettings.update({ theme: 'dark' })
			},
			{
				id: 'theme-auto',
				label: 'Theme: Auto',
				run: () => readerSettings.update({ theme: 'auto' })
			}
		];
		for (const v of viewsStore.pinned) {
			list.push({
				id: `view-${v.id}`,
				label: `View: ${v.name}`,
				run: () => void goto(resolve('/views/[id]', { id: v.id }))
			});
		}
		const ctrl = activeList.current;
		if (ctrl) {
			list.push({ id: 'open', label: 'Open selected', run: () => ctrl.open() });
			const triage: [string, Location][] = [
				['Archive selected', 'archive'],
				['Save selected for later', 'later'],
				['Shortlist selected', 'shortlist']
			];
			for (const [label, location] of triage) {
				list.push({ id: `triage-${location}`, label, run: () => ctrl.triage(location) });
			}
		}
		return list;
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
	});

	$effect(() => {
		if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1);
	});

	$effect(() => {
		if (open) {
			query = '';
			cursor = 0;
			void tick().then(() => input?.focus());
		}
	});

	function run(cmd: Command | undefined) {
		if (!cmd) return;
		open = false;
		cmd.run();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			open = false;
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			cursor = Math.min(filtered.length - 1, cursor + 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			cursor = Math.max(0, cursor - 1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			run(filtered[cursor]);
		}
	}
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close command palette"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Enter' && (open = false)}
	></div>
	<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
		<input
			bind:this={input}
			bind:value={query}
			{onkeydown}
			type="text"
			placeholder="Type a command…"
			autocomplete="off"
		/>
		<ul>
			{#each filtered as cmd, i (cmd.id)}
				<li>
					<button
						type="button"
						class:active={i === cursor}
						onmouseenter={() => (cursor = i)}
						onclick={() => run(cmd)}
					>
						{cmd.label}
					</button>
				</li>
			{:else}
				<li class="empty">No matching commands</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.35);
		border: 0;
		z-index: 40;
	}
	.palette {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(540px, 92vw);
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
		z-index: 41;
		overflow: hidden;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.8rem 1rem;
		border: 0;
		border-bottom: 1px solid var(--border);
		font-size: 1rem;
		background: var(--surface);
		color: var(--text);
		outline: none;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0.3rem;
		max-height: 50vh;
		overflow-y: auto;
	}
	li {
		margin: 0;
	}
	button {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.7rem;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text);
		font-size: 0.92rem;
		cursor: pointer;
	}
	button.active {
		background: var(--surface-alt);
	}
	.empty {
		padding: 0.6rem 0.7rem;
		color: var(--text-muted);
		font-size: 0.9rem;
	}
</style>
