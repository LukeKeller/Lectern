<script lang="ts">
	import { onMount } from 'svelte';
	import DOMPurify from 'dompurify';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getClient } from '$lib/config';
	import type { Card } from '@lectern/shared';

	const id = page.params.id;

	let card = $state<Card | undefined>(undefined);
	let html = $state('');
	let error = $state<string | undefined>(undefined);
	let loading = $state(true);

	onMount(async () => {
		try {
			card = id ? await db.cards.get(id) : undefined;
			if (!id) throw new Error('Missing document id');
			const content = await getClient().getContent(id);
			// Sanitize before rendering untrusted article HTML on the client.
			html = DOMPurify.sanitize(content.html);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});
</script>

<a class="back" href={resolve('/')}>← Back</a>

{#if card}
	<h1>{card.title}</h1>
	<p class="meta">{card.siteName ?? card.author ?? new URL(card.url).hostname}</p>
{/if}

{#if loading}
	<p class="muted">Loading…</p>
{:else if error}
	<p class="error">Could not load article: {error}</p>
{:else}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<article>{@html html}</article>
{/if}

<style>
	.back {
		color: #52606d;
		text-decoration: none;
		font-size: 0.9rem;
	}
	.meta {
		color: #7b8794;
		margin-top: 0;
	}
	.muted {
		color: #7b8794;
	}
	.error {
		color: #c53030;
	}
	article {
		margin-top: 1rem;
	}
</style>
