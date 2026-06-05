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
	emptyHint="Items you file away land here. Archive from any list — or swipe left on a card — to keep your inbox clear."
	emptyIcon="archive"
	actions={[
		{ label: 'Later', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' }
	]}
	bulkDelete={{
		scope: 'archive',
		label: 'Empty Archive',
		confirm: 'Delete all archived items permanently?'
	}}
/>
