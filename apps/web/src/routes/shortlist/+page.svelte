<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery } from '$lib/views';

	const shortlist = (card: Card) => card.location === 'shortlist';
	const baseQuery = locationQuery('shortlist');
</script>

<ListView
	title="Shortlist"
	predicate={shortlist}
	{baseQuery}
	empty="Your shortlist is empty."
	emptyIcon="star"
	actions={[
		{ label: 'Later', location: 'later' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
