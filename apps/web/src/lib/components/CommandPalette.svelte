<script lang="ts">
	import type { Location } from '@lectern/shared';
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { activeList } from '$lib/list-controller.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { viewsStore } from '$lib/views-store.svelte';
	import { trapFocus } from '$lib/focus-trap';

	let { open = $bindable(false), onAddLink }: { open?: boolean; onAddLink?: () => void } =
		$props();

	interface Command {
		id: string;
		label: string;
		group: string;
		run: () => void;
	}

	let query = $state('');
	let cursor = $state(0);
	let input = $state<HTMLInputElement | null>(null);

	const commands = $derived.by<Command[]>(() => {
		const list: Command[] = [
			{ id: 'add-link', label: 'Add link…', group: 'Go to', run: () => onAddLink?.() },
			{ id: 'go-home', label: 'Home', group: 'Go to', run: () => void goto(resolve('/')) },
			{
				id: 'go-inbox',
				label: 'Inbox',
				group: 'Go to',
				run: () => void goto(resolve('/inbox'))
			},
			{ id: 'go-later', label: 'Later', group: 'Go to', run: () => void goto(resolve('/later')) },
			{
				id: 'go-shortlist',
				label: 'Shortlist',
				group: 'Go to',
				run: () => void goto(resolve('/shortlist'))
			},
			{
				id: 'go-archive',
				label: 'Archive',
				group: 'Go to',
				run: () => void goto(resolve('/archive'))
			},
			{ id: 'go-feed', label: 'Feed', group: 'Go to', run: () => void goto(resolve('/feed')) },
			{
				id: 'go-library',
				label: 'Library',
				group: 'Go to',
				run: () => void goto(resolve('/library'))
			},
			{
				id: 'go-newspaper',
				label: 'Newspaper',
				group: 'Go to',
				run: () => void goto(resolve('/newspaper'))
			},
			{
				id: 'go-magazine',
				label: 'Magazine',
				group: 'Go to',
				run: () => void goto(resolve('/magazine'))
			},
			{
				id: 'go-search',
				label: 'Search',
				group: 'Go to',
				run: () => void goto(resolve('/search'))
			},
			{ id: 'go-feeds', label: 'Feeds', group: 'Go to', run: () => void goto(resolve('/feeds')) },
			{ id: 'go-views', label: 'Views', group: 'Go to', run: () => void goto(resolve('/views')) },
			{
				id: 'go-settings',
				label: 'Settings',
				group: 'Go to',
				run: () => void goto(resolve('/settings'))
			},
			{
				id: 'theme-light',
				label: 'Light',
				group: 'Theme',
				run: () => readerSettings.update({ theme: 'light' })
			},
			{
				id: 'theme-dark',
				label: 'Dark',
				group: 'Theme',
				run: () => readerSettings.update({ theme: 'dark' })
			},
			{
				id: 'theme-auto',
				label: 'Auto',
				group: 'Theme',
				run: () => readerSettings.update({ theme: 'auto' })
			}
		];
		for (const v of viewsStore.pinned) {
			list.push({
				id: `view-${v.id}`,
				label: v.name,
				group: 'Pinned view',
				run: () => void goto(resolve('/views/[id]', { id: v.id }))
			});
		}
		const ctrl = activeList.current;
		if (ctrl) {
			list.push({ id: 'open', label: 'Open selected', group: 'Selection', run: () => ctrl.open() });
			const triage: [string, Location][] = [
				['Archive selected', 'archive'],
				['Save selected for later', 'later'],
				['Shortlist selected', 'shortlist']
			];
			for (const [label, location] of triage) {
				list.push({
					id: `triage-${location}`,
					label,
					group: 'Selection',
					run: () => ctrl.triage(location)
				});
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
	<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" use:trapFocus>
		<div class="search">
			<input
				bind:this={input}
				bind:value={query}
				{onkeydown}
				type="text"
				placeholder="Search commands…"
				autocomplete="off"
				role="combobox"
				aria-expanded="true"
				aria-controls="cmd-palette-list"
				aria-activedescendant={filtered[cursor] ? `cmd-${filtered[cursor].id}` : undefined}
			/>
		</div>
		<ul id="cmd-palette-list" role="listbox" aria-label="Commands">
			{#each filtered as cmd, i (cmd.id)}
				<li role="option" id="cmd-{cmd.id}" aria-selected={i === cursor}>
					<button
						type="button"
						tabindex="-1"
						class:active={i === cursor}
						onmouseenter={() => (cursor = i)}
						onclick={() => run(cmd)}
					>
						<span class="grp">{cmd.group}</span>
						<span class="lbl">{cmd.label}</span>
					</button>
				</li>
			{:else}
				<li class="empty">No matching commands</li>
			{/each}
		</ul>
		<div class="hints">
			<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
			<span><kbd>↵</kbd> run</span>
			<span><kbd>esc</kbd> close</span>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 16, 10, 0.34);
		border: 0;
		z-index: 60;
		animation: fade var(--dur-fast) var(--ease);
	}
	.palette {
		position: fixed;
		top: 13vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(560px, 92vw);
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
		z-index: 61;
		overflow: hidden;
		animation: pop var(--dur) var(--ease);
	}
	.search {
		border-bottom: 1px solid var(--border);
	}
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.9rem 1.1rem;
		border: 0;
		font-size: var(--text-md);
		background: transparent;
		color: var(--text);
		outline: none;
	}
	input::placeholder {
		color: var(--text-muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0.35rem;
		max-height: 52vh;
		overflow-y: auto;
	}
	li {
		margin: 0;
	}
	button {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		width: 100%;
		text-align: left;
		padding: 0.55rem 0.7rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font-size: var(--text-base);
		cursor: pointer;
	}
	button.active {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.grp {
		flex-shrink: 0;
		min-width: 5.5rem;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	button.active .grp {
		color: color-mix(in srgb, var(--accent) 70%, var(--text-muted));
	}
	.lbl {
		font-weight: 500;
	}
	.empty {
		padding: 0.7rem;
		color: var(--text-muted);
		font-size: var(--text-base);
	}
	.hints {
		display: flex;
		gap: 1rem;
		padding: 0.5rem 0.85rem;
		border-top: 1px solid var(--border);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.hints span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		padding: 0.05rem 0.3rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-alt);
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-6px) scale(0.98);
		}
	}
</style>
