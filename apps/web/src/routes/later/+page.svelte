<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery } from '$lib/views';

	const later = (card: Card) => card.location === 'later';
	const baseQuery = locationQuery('later');
</script>

<ListView
	title="Later"
	predicate={later}
	{baseQuery}
	empty="Nothing saved for later yet."
	actions={[
		{ label: 'Shortlist', location: 'shortlist' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
