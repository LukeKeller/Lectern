<script lang="ts">
	import { page } from '$app/state';
	import ListView from '$lib/components/ListView.svelte';
	import { SMART_VIEWS } from '$lib/smart-views';

	const view = $derived(SMART_VIEWS.find((v) => v.key === page.params.key));
</script>

{#if view}
	<ListView
		title={view.label}
		predicate={view.predicate}
		empty="Nothing here yet."
		emptyHint="Items matching this collection will appear here automatically as you read and save."
		emptyIcon={view.icon}
	/>
{:else}
	<div class="page">
		<h1>Unknown collection</h1>
		<p class="muted">No collection matches “{page.params.key}”.</p>
	</div>
{/if}

<style>
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 0.5rem;
	}
	.muted {
		color: var(--text-muted);
	}
</style>
