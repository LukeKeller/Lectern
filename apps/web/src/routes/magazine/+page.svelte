<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';
	import { getSync } from '$lib/sync';
	import { buildMagazines } from '$lib/magazine';
	import Icon from '$lib/components/Icon.svelte';
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';

	const all = liveCards(() => db.cards.toArray());
	const cards = $derived((all.value ?? []) as Card[]);
	const issues = $derived(buildMagazines(cards));

	// A stable accent hue per tag so each cover feels like its own publication.
	function hue(tag: string): number {
		let h = 0;
		for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
		return h;
	}
	function meta(card: Card): string {
		const parts: string[] = [];
		if (card.siteName) parts.push(card.siteName);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min`);
		return parts.join(' · ');
	}

	onMount(() => {
		void getSync().pull();
	});
</script>

<section class="page">
	<header class="head">
		<h1>Magazines</h1>
		<p class="lede">
			Your saved library, bound into themed issues. Each tag shared by two or more articles becomes
			a collection of related reading.
		</p>
	</header>

	{#if issues.length === 0}
		<div class="empty">
			<span class="empty-mark"><Icon name="magazine" size={28} /></span>
			<p>No magazines yet — tag a few saved articles with the same topic to bind an issue.</p>
		</div>
	{:else}
		<div class="shelf">
			{#each issues as issue (issue.tag)}
				<article class="zine" style={`--hue:${hue(issue.tag)}`}>
					<div class="cover">
						<span class="brand">Lectern</span>
						<h2>{issue.tag}</h2>
						<span class="count">
							{issue.cards.length}
							{issue.cards.length === 1 ? 'article' : 'articles'}
						</span>
					</div>
					<ul>
						{#each issue.cards as card (card.id)}
							<li>
								<a href={resolve('/read/[id]', { id: card.id })}>
									<SourceAvatar url={card.url} siteName={card.siteName} size={26} />
									<span class="body">
										<span class="title">{card.title}</span>
										{#if meta(card)}<span class="sub">{meta(card)}</span>{/if}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	{/if}
</section>

<style>
	.page {
		max-width: 72rem;
		margin: 0 auto;
	}
	.head {
		margin-bottom: 1.6rem;
	}
	h1 {
		font-size: var(--text-2xl);
		margin: 0 0 0.4rem;
	}
	.lede {
		max-width: 42rem;
		color: var(--text-muted);
		font-size: var(--text-base);
		margin: 0;
	}

	.shelf {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: 1.4rem;
	}
	.zine {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.cover {
		position: relative;
		padding: 1.1rem 1.1rem 1rem;
		color: #fff;
		background: linear-gradient(
			135deg,
			hsl(var(--hue) 48% 38%),
			hsl(calc(var(--hue) + 28) 52% 30%)
		);
	}
	.brand {
		font-size: var(--text-2xs);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.85;
	}
	.cover h2 {
		font-family: var(--font-serif);
		font-size: var(--text-xl);
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: -0.01em;
		margin: 0.35rem 0 0.55rem;
		text-transform: capitalize;
		word-break: break-word;
	}
	.count {
		font-size: var(--text-2xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.9;
	}
	.zine ul {
		list-style: none;
		margin: 0;
		padding: 0.4rem;
		flex: 1;
	}
	.zine li {
		border-radius: var(--radius);
	}
	.zine li:hover {
		background: var(--surface-alt);
	}
	.zine a {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		padding: 0.55rem 0.5rem;
	}
	.body {
		min-width: 0;
	}
	.title {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 1.3;
		color: var(--text);
		transition: color var(--dur-fast) var(--ease);
	}
	.zine a:hover .title {
		color: var(--accent);
	}
	.sub {
		display: block;
		margin-top: 0.15rem;
		font-size: var(--text-2xs);
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
		padding: 3.5rem 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.empty-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
	}
	.empty p {
		margin: 0;
		max-width: 28rem;
		font-size: var(--text-base);
	}
</style>
