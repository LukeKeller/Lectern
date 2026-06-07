<script lang="ts">
	/**
	 * Keyboard shortcut reference, opened with `?` (mirrors Readwise Reader's
	 * shortcut sheet). Pure presentation: the layout owns the open state and the
	 * actual key handling, so this stays a static, discoverable cheat-sheet.
	 */
	import Icon from './Icon.svelte';
	import { trapFocus } from '$lib/focus-trap';

	let { onclose }: { onclose: () => void } = $props();

	const groups: { title: string; items: [string, string][] }[] = [
		{
			title: 'Navigate',
			items: [
				['j  /  ↓', 'Next document'],
				['k  /  ↑', 'Previous document'],
				['Space', 'Next (Shift+Space: previous)'],
				['Enter  /  o', 'Open document'],
				['Esc', 'Back to list'],
				['/', 'Search'],
				['⌘K  /  Ctrl K', 'Command palette'],
				['?', 'This shortcut sheet']
			]
		},
		{
			title: 'Triage focused document',
			items: [
				['i', 'Move to Inbox'],
				['l', 'Move to Later'],
				['s', 'Move to Shortlist'],
				['e', 'Archive'],
				['r', 'Mark read']
			]
		},
		{
			title: 'Go to',
			items: [
				['g  h', 'Home'],
				['g  i', 'Inbox'],
				['g  l', 'Later'],
				['g  s', 'Shortlist'],
				['g  a', 'Archive'],
				['g  f', 'Feed'],
				['g  b', 'Library']
			]
		}
	];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label="Keyboard shortcuts"
		tabindex="-1"
		use:trapFocus
		onclick={(e) => e.stopPropagation()}
	>
		<header>
			<h2>Keyboard shortcuts</h2>
			<button type="button" class="close" aria-label="Close" onclick={onclose}>
				<Icon name="close" size={18} />
			</button>
		</header>
		<div class="grid">
			{#each groups as group (group.title)}
				<section>
					<h3>{group.title}</h3>
					<dl>
						{#each group.items as [keys, label] (label)}
							<div class="row">
								<dt><kbd>{keys}</kbd></dt>
								<dd>{label}</dd>
							</div>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: clamp(1.5rem, 8vh, 6rem) 1rem;
		background: rgba(20, 16, 10, 0.4);
	}
	.sheet {
		width: min(46rem, 100%);
		max-height: 80vh;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		background: var(--surface);
	}
	h2 {
		font-size: var(--text-md);
		font-weight: 650;
	}
	.close {
		display: inline-flex;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.3rem;
		border-radius: var(--radius);
	}
	.close:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 1.4rem 2rem;
		padding: 1.25rem;
	}
	h3 {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 0.55rem;
	}
	dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	dt {
		flex-shrink: 0;
	}
	dd {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-align: right;
	}
	kbd {
		display: inline-block;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--text);
		background: var(--surface-alt);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.12rem 0.45rem;
		white-space: nowrap;
	}
</style>
