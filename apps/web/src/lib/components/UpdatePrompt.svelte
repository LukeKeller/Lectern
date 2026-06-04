<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';

	// Owns the service-worker update lifecycle. The worker no longer calls
	// skipWaiting() on install, so a waiting worker sits idle until the user
	// accepts here — a reader is never reloaded out from under an open article.
	// On accept we post SKIP_WAITING, then reload once the new worker takes
	// control (controllerchange), which is the fix for the classic
	// "needs a second refresh" PWA gotcha.

	let waiting = $state<ServiceWorker | null>(null);
	let reloading = false;

	function watch(reg: ServiceWorkerRegistration) {
		if (reg.waiting) waiting = reg.waiting;
		reg.addEventListener('updatefound', () => {
			const next = reg.installing;
			if (!next) return;
			next.addEventListener('statechange', () => {
				// 'installed' with an existing controller means an update is ready
				// (a fresh first install has no controller and should just activate).
				if (next.state === 'installed' && navigator.serviceWorker.controller) {
					waiting = reg.waiting ?? next;
				}
			});
		});
	}

	function update() {
		if (!waiting) return;
		waiting.postMessage({ type: 'SKIP_WAITING' });
	}

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;

		// Best-effort: ask the browser to keep our cached articles/audio durable.
		// iOS evicts script-writable storage after ~7 days of non-use otherwise.
		navigator.storage?.persist?.().catch(() => {});

		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (reloading) return;
			reloading = true;
			window.location.reload();
		});

		void navigator.serviceWorker.ready.then((reg) => {
			watch(reg);
			// Check for a new deploy on load, and hourly for long-lived reader sessions.
			void reg.update().catch(() => {});
			const id = setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
			return () => clearInterval(id);
		});
	});
</script>

{#if waiting}
	<div class="update" role="status">
		<Icon name="auto" size={16} />
		<span>A new version is ready.</span>
		<button type="button" onclick={update}>Reload</button>
		<button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (waiting = null)}>
			×
		</button>
	</div>
{/if}

<style>
	.update {
		position: fixed;
		left: 50%;
		bottom: calc(1rem + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 80;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: calc(100vw - 1.5rem);
		padding: 0.6rem 0.7rem 0.6rem 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow);
		font-size: var(--text-sm);
		color: var(--text);
	}
	.update :global(svg) {
		color: var(--accent);
		flex-shrink: 0;
	}
	button {
		border: 0;
		cursor: pointer;
		font: inherit;
	}
	.update > button:not(.dismiss) {
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--accent-contrast);
		font-weight: 600;
	}
	.dismiss {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-muted);
		font-size: 1.1rem;
		line-height: 1;
	}
	.dismiss:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
</style>
