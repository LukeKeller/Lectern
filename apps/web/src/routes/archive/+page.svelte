<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery } from '$lib/views';

	const archive = (card: Card) => card.location === 'archive';
	const baseQuery = locationQuery('archive');
</script>

<ListView
	title="Archive"
	predicate={archive}
	{baseQuery}
	empty="Nothing archived yet."
	emptyIcon="archive"
	actions={[
		{ label: 'Later', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' }
	]}
/>
