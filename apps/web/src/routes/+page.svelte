<script lang="ts">
	import type { Card } from '@lectern/shared';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery } from '$lib/views';

	const inbox = (card: Card) => card.location === 'inbox';
	const baseQuery = locationQuery('inbox');
</script>

<ListView
	title="Inbox"
	predicate={inbox}
	{baseQuery}
	empty="Inbox zero. Nothing new to triage."
	emptyHint="New items from your feeds and saved articles land here. Sort them into Later, Shortlist, or Archive to keep it clear."
	actions={[
		{ label: 'Later', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
