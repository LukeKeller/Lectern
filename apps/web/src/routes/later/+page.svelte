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
	emptyHint="Send articles here to read when you have time. Use Read later on any card, or swipe right on mobile."
	emptyIcon="clock"
	actions={[
		{ label: 'Shortlist', location: 'shortlist' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
