<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery } from '$lib/views';

	const feed = (card: Card) => card.location === 'feed';
	const baseQuery = locationQuery('feed');
</script>

<ListView
	title="Feed"
	predicate={feed}
	{baseQuery}
	empty="No feed items."
	emptyIcon="rss"
	actions={[
		{ label: 'Save', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' }
	]}
/>
