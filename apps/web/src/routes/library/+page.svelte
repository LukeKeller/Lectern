<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery, orQueries } from '$lib/views';

	// The full saved collection: everything that isn't a transient feed item.
	const library = (card: Card) => card.location !== 'feed';
	const baseQuery = orQueries(
		locationQuery('inbox'),
		locationQuery('later'),
		locationQuery('shortlist'),
		locationQuery('archive')
	);
</script>

<ListView
	title="Library"
	predicate={library}
	{baseQuery}
	empty="Your library is empty."
	emptyIcon="book"
	actions={[
		{ label: 'Later', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
