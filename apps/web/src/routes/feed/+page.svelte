<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import CardList from '$lib/components/CardList.svelte';

	const cards = liveCards(async () => {
		const list = await db.cards.where('location').equals('feed').sortBy('updatedAt');
		return list.reverse();
	});

	onMount(() => {
		void getSync().pull();
	});
</script>

<h1>Feed</h1>
<CardList
	cards={cards.value}
	empty="No feed items."
	actions={[
		{ label: 'Save', location: 'later' },
		{ label: 'Shortlist', location: 'shortlist' }
	]}
/>
