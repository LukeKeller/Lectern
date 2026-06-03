<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery, orQueries } from '$lib/views';

	const library = (card: Card) => card.location === 'shortlist' || card.location === 'archive';
	const baseQuery = orQueries(locationQuery('shortlist'), locationQuery('archive'));
</script>

<ListView
	title="Library"
	predicate={library}
	{baseQuery}
	empty="Your library is empty."
	actions={[
		{ label: 'Inbox', location: 'inbox' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
