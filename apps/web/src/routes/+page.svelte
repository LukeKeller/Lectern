<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery, orQueries } from '$lib/views';

	const inbox = (card: Card) => card.location === 'inbox' || card.location === 'later';
	const baseQuery = orQueries(locationQuery('inbox'), locationQuery('later'));
</script>

<ListView
	title="Inbox"
	predicate={inbox}
	{baseQuery}
	empty="Inbox zero."
	actions={[
		{ label: 'Later', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
