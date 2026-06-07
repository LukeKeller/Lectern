<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { syncStatus } from '$lib/sync-status.svelte';
	import { getSync } from '$lib/sync';

	// A single quiet line for the sidebar foot. Idle text uses muted ink; only the
	// failed/Retry affordance borrows the calm error token, used sparingly.
	const state = $derived.by(() => {
		const { online, flushing, failed, pending } = syncStatus;
		if (!online) return 'offline' as const;
		if (flushing && pending > 0) return 'syncing' as const;
		if (failed && pending > 0) return 'failed' as const;
		if (pending > 0) return 'queued' as const;
		return 'synced' as const;
	});
</script>

<div
	class="sync"
	class:failed={state === 'failed'}
	class:syncing={state === 'syncing'}
	aria-live="polite"
>
	{#if state === 'offline'}
		<span class="dot" aria-hidden="true"></span>
		<span class="label"
			>Offline{#if syncStatus.pending > 0}&nbsp;·&nbsp;{syncStatus.pending} queued{/if}</span
		>
	{:else if state === 'syncing'}
		<Icon name="refresh" size={14} />
		<span class="label">Syncing…</span>
	{:else if state === 'failed'}
		<span class="label">{syncStatus.pending} queued</span>
		<button
			type="button"
			class="retry"
			onclick={() =>
				getSync()
					.flush()
					.catch(() => {})}>Retry</button
		>
	{:else if state === 'queued'}
		<span class="dot" aria-hidden="true"></span>
		<span class="label">{syncStatus.pending} queued</span>
	{:else}
		<Icon name="check" size={14} />
		<span class="label">Synced</span>
	{/if}
</div>

<style>
	.sync {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		color: var(--text-muted);
		min-height: 1.5rem;
	}
	.sync.failed {
		color: var(--error);
	}
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.7;
		flex: none;
	}
	.retry {
		border: 0;
		background: transparent;
		padding: 0;
		font: inherit;
		color: var(--error);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.retry:hover {
		opacity: 0.8;
	}
	.sync :global(svg) {
		flex: none;
		opacity: 0.85;
	}
	.sync.syncing :global(svg) {
		animation: sync-spin 1.4s linear infinite;
	}
	@keyframes sync-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sync.syncing :global(svg) {
			animation: none;
		}
	}
</style>
