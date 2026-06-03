<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/db';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import CardList from '$lib/components/CardList.svelte';

	const cards = liveCards(async () => {
		const list = await db.cards.where('location').anyOf('shortlist', 'archive').sortBy('updatedAt');
		return list.reverse();
	});

	onMount(() => {
		void getSync().pull();
	});
</script>

<h1>Library</h1>
<CardList
	cards={cards.value}
	empty="Your library is empty."
	actions={[
		{ label: 'Inbox', location: 'inbox' },
		{ label: 'Archive', location: 'archive' }
	]}
/>
