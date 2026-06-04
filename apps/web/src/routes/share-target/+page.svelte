<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import Icon from '$lib/components/Icon.svelte';

	type Status = 'saving' | 'saved' | 'error';
	let status = $state<Status>('saving');
	let message = $state('Saving to Lectern…');

	// Android typically fills `url`, but some apps put the link in `text` (or
	// `text` carries "Title https://…"). Pull the first http(s) URL out of either.
	function extractUrl(params: URLSearchParams): string | null {
		const direct = params.get('url')?.trim();
		if (direct && /^https?:\/\//i.test(direct)) return direct;
		const text = `${params.get('text') ?? ''} ${params.get('title') ?? ''}`;
		const match = text.match(/https?:\/\/[^\s]+/i);
		return match ? match[0] : (direct ?? null);
	}

	onMount(async () => {
		const url = extractUrl(page.url.searchParams);
		if (!url) {
			status = 'error';
			message = 'No link found in the shared content.';
			return;
		}
		try {
			await getClient().saveDocument({ url, tags: [], location: 'later' });
			status = 'saved';
			message = 'Saved to Later.';
			// Brief confirmation, then drop the user into the queue they just added to.
			setTimeout(() => void goto(resolve('/later')), 900);
		} catch (err) {
			status = 'error';
			message = err instanceof Error ? err.message : 'Could not save the link.';
		}
	});
</script>

<svelte:head>
	<title>Save to Lectern</title>
</svelte:head>

<div class="share">
	<div class="card" class:error={status === 'error'}>
		<span class="glyph" aria-hidden="true">
			{#if status === 'saving'}
				<span class="spinner"></span>
			{:else if status === 'saved'}
				<Icon name="archive" size={28} />
			{:else}
				<Icon name="rss" size={28} />
			{/if}
		</span>
		<p class="msg">{message}</p>
		{#if status === 'error'}
			<a class="home" href={resolve('/')}>Back to Inbox</a>
		{/if}
	</div>
</div>

<style>
	.share {
		min-height: 60vh;
		display: grid;
		place-items: center;
		padding: 2rem 1rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		text-align: center;
		padding: 2rem 2.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 3.25rem;
		height: 3.25rem;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.card.error .glyph {
		background: color-mix(in srgb, var(--error) 14%, transparent);
		color: var(--error);
	}
	.msg {
		margin: 0;
		font-size: var(--text-md);
		color: var(--text);
	}
	.home {
		font-size: var(--text-sm);
		color: var(--accent);
	}
	.spinner {
		width: 1.5rem;
		height: 1.5rem;
		border: 2.5px solid var(--accent-soft);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
