<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { page } from '$app/state';
	import ListView from '$lib/components/ListView.svelte';
	import { locationQuery } from '$lib/views';

	// Optional ?feed=<siteName> narrows the feed list to a single publication
	// (the sidebar feed tree links here). siteName mirrors the MiniFlux feed
	// title, so it is the join key between a Feed and its cards.
	const feedName = $derived(page.url.searchParams.get('feed'));
	const predicate = $derived(
		(card: Card) => card.location === 'feed' && (feedName === null || card.siteName === feedName)
	);
	const baseQuery = locationQuery('feed');
</script>

<ListView
	title={feedName ?? 'Feed'}
	{predicate}
	{baseQuery}
	empty="No feed items."
	emptyHint="Your RSS subscriptions appear here as they publish. Add feeds in your MiniFlux backend to fill it."
	emptyIcon="rss"
	hideReadKey="feed"
	actions={[
		{ label: 'Save', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' }
	]}
	bulkDelete={{
		scope: 'read-feed',
		label: 'Delete all read',
		confirm: "Delete all read articles from your feeds? This can't be undone."
	}}
	maintenance={{ location: 'feed' }}
/>
