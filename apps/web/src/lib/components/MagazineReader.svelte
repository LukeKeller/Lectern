<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { magazineTitle, type Magazine } from '$lib/magazine';
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { getSync } from '$lib/sync';
	import { getArticleHtml } from '$lib/content';
	import { cleanArticleHtml } from '$lib/article-html';
	import Icon from './Icon.svelte';
	import SourceAvatar from './SourceAvatar.svelte';
	import { displayAuthor } from '$lib/author';
	import { ttsPlayer } from '$lib/tts-player.svelte';
	import { scrollIntoViewMotion } from '$lib/motion';
	import '$lib/styles/drop-cap.css';

	let {
		magazine,
		startId,
		onclose
	}: { magazine: Magazine; startId?: string; onclose: () => void } = $props();

	// Per-article fetched HTML and load failures, plus the triage state we apply
	// locally for instant feedback (the mutation is also queued to sync).
	let html = $state<Record<string, string>>({});
	let failed = $state<Record<string, boolean>>({});
	let marked = $state<Record<string, 'read' | 'archived'>>({});

	// Lead images that failed to load, keyed by card id, so we can hide them.
	const coverFailed = new SvelteSet<string>();

	const title = $derived(magazineTitle(magazine.tag));

	function meta(card: Card): string {
		const parts: string[] = [];
		if (card.siteName) parts.push(card.siteName);
		if (card.author) parts.push(displayAuthor(card.author));
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min`);
		return parts.join(' · ');
	}

	// DOM-id-safe anchor for a unified id ("readeck:abc" → "mag-readeck-abc").
	function anchor(id: string): string {
		return 'mag-' + id.replace(/[^a-zA-Z0-9_-]/g, '-');
	}

	function jump(id: string): void {
		scrollIntoViewMotion(document.getElementById(anchor(id)), { block: 'start' });
	}

	function markRead(card: Card): void {
		const sync = getSync();
		void sync.enqueue({ type: 'markRead', id: card.id, read: true }).then(() => sync.flush());
		marked[card.id] = 'read';
	}

	function archive(card: Card): void {
		const sync = getSync();
		void sync
			.enqueue({ type: 'setLocation', id: card.id, location: 'archive' })
			.then(() => sync.flush());
		marked[card.id] = 'archived';
	}

	onMount(() => {
		// Load every article's content up front (memoised + deduped in content.ts)
		// so the issue reads as one continuous page.
		for (const card of magazine.cards) {
			getArticleHtml(card.id)
				.then((h) => {
					html[card.id] = cleanArticleHtml(h, card.title);
				})
				.catch(() => {
					failed[card.id] = true;
				});
		}
		if (startId) {
			void tick().then(() => jump(startId));
		}
	});
</script>

<section class="mag-reader">
	<header class="mr-head">
		<button class="mr-close" type="button" onclick={onclose}>
			<Icon name="back" size={16} /> All magazines
		</button>
		<p class="mr-masthead">Lectern</p>
		<h1>{title}</h1>
		<div class="mr-head-row">
			<p class="mr-count">
				{magazine.cards.length}
				{magazine.cards.length === 1 ? 'article' : 'articles'}
			</p>
			<button
				type="button"
				class="mr-listen-all"
				onclick={() => ttsPlayer.playAll(magazine.cards.map((c) => ({ id: c.id, title: c.title })))}
			>
				<Icon name="headphones" size={15} /> Listen to issue
			</button>
		</div>
	</header>

	<nav class="mr-toc" id="mr-contents" aria-label="Contents">
		<h2>Contents</h2>
		<ol>
			{#each magazine.cards as card, i (card.id)}
				<li class:done={marked[card.id]}>
					<button type="button" class="toc-link" onclick={() => jump(card.id)}>
						<span class="toc-num">{i + 1}</span>
						<span class="toc-title">{card.title}</span>
						{#if marked[card.id]}<span class="toc-state">{marked[card.id]}</span>{/if}
					</button>
				</li>
			{/each}
		</ol>
	</nav>

	<div class="mr-articles">
		{#each magazine.cards as card, i (card.id)}
			<article
				id={anchor(card.id)}
				class="mr-article"
				class:archived={marked[card.id] === 'archived'}
			>
				<div class="mr-article-head">
					<div class="mr-article-meta">
						<span class="mr-kicker">
							{i + 1} / {magazine.cards.length}
							{#if marked[card.id]}· {marked[card.id]}{/if}
						</span>
						<h2>
							<a href={resolve('/read/[id]', { id: card.id })}>{card.title}</a>
						</h2>
						<span class="mr-by">
							<SourceAvatar url={card.url} siteName={card.siteName} size={20} />
							{#if meta(card)}<span>{meta(card)}</span>{/if}
						</span>
					</div>
					<div class="mr-actions">
						<button
							type="button"
							title="Listen"
							aria-label="Listen"
							onclick={() => ttsPlayer.listen({ id: card.id, title: card.title })}
						>
							<Icon name="headphones" size={16} />
						</button>
						<button
							type="button"
							class:active={marked[card.id] === 'read'}
							title="Mark as read"
							aria-label="Mark as read"
							onclick={() => markRead(card)}
						>
							<Icon name="check" size={16} />
						</button>
						<button
							type="button"
							class:active={marked[card.id] === 'archived'}
							title="Archive"
							aria-label="Archive"
							onclick={() => archive(card)}
						>
							<Icon name="archive" size={16} />
						</button>
					</div>
				</div>

				{#if card.coverImage && !coverFailed.has(card.id)}
					<figure class="mr-lead">
						<img
							src={card.coverImage}
							alt=""
							loading="lazy"
							onerror={() => coverFailed.add(card.id)}
						/>
					</figure>
				{/if}

				{#if html[card.id]}
					<!-- content.ts sanitizes with DOMPurify before caching -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="mr-body lectern-prose drop-cap">{@html html[card.id]}</div>
					<p class="mr-end" aria-hidden="true">∎</p>
				{:else if failed[card.id]}
					<p class="mr-fail">
						Couldn’t load this article.
						<a href={resolve('/read/[id]', { id: card.id })}>Open it →</a>
					</p>
				{:else}
					<p class="mr-loading">Loading…</p>
				{/if}

				<button
					type="button"
					class="mr-top"
					onclick={() =>
						scrollIntoViewMotion(document.getElementById('mr-contents'), { block: 'start' })}
				>
					↑ Contents
				</button>
			</article>
			{#if i < magazine.cards.length - 1}
				<div class="mr-sep" role="separator" aria-hidden="true">❧</div>
			{/if}
		{/each}
	</div>
</section>

<style>
	.mag-reader {
		position: relative;
		max-width: 44rem;
		margin: 0 auto;
	}
	/* A faint paper grain beneath the whole issue — the article sits on a sheet,
	   not a flat panel. Confined to the column (the reader shares the page chrome)
	   and never intercepts input. */
	.mag-reader::before {
		content: '';
		position: absolute;
		inset: -1.5rem 0;
		z-index: 0;
		pointer-events: none;
		background-image: var(--grain);
		background-size: 180px 180px;
		opacity: var(--grain-strength);
		mix-blend-mode: soft-light;
	}
	.mr-head,
	.mr-toc,
	.mr-articles {
		position: relative;
		z-index: 1;
	}
	.mr-head {
		margin-bottom: var(--space-6);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	.mr-masthead {
		font-family: var(--font-serif);
		font-size: var(--text-2xs);
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 var(--space-2);
	}
	.mr-close {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		padding: 0.2rem 0;
		margin-bottom: 0.6rem;
	}
	.mr-close:hover {
		color: var(--text);
	}
	.mr-head h1 {
		font-family: var(--font-serif);
		font-size: var(--text-2xl);
		line-height: 1.1;
		letter-spacing: -0.015em;
		margin: 0;
		text-transform: capitalize;
	}
	.mr-count {
		color: var(--text-muted);
		font-size: var(--text-sm);
		margin: 0.25rem 0 0;
	}
	.mr-head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.5rem;
	}
	.mr-listen-all {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.mr-listen-all:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.mr-toc {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		margin-bottom: 2.5rem;
		background: var(--surface);
		scroll-margin-top: 1.5rem;
	}
	.mr-toc h2 {
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0 0 0.6rem;
	}
	.mr-toc ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.toc-link {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		width: 100%;
		border: 0;
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		padding: 0.4rem 0.4rem;
		border-radius: var(--radius);
		font-size: var(--text-base);
	}
	.toc-link:hover {
		background: var(--surface-alt);
	}
	.toc-num {
		flex-shrink: 0;
		width: 1.6rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-sm);
	}
	.toc-title {
		flex: 1;
		min-width: 0;
	}
	.toc-state {
		flex-shrink: 0;
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.mr-toc li.done .toc-title {
		color: var(--text-muted);
		text-decoration: line-through;
	}

	.mr-article {
		scroll-margin-top: 1.5rem;
	}
	.mr-article.archived {
		opacity: 0.5;
	}

	/* Editorial separator between articles: a centered ornament with breathing room. */
	.mr-sep {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		margin: var(--space-7) 0;
		color: var(--text-muted);
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		line-height: 1;
		user-select: none;
	}
	.mr-sep::before,
	.mr-sep::after {
		content: '';
		width: 2.5rem;
		height: 1px;
		background: var(--border);
	}
	.mr-article-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: var(--space-5);
	}
	.mr-kicker {
		display: inline-block;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--text-2xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.mr-article-head h2 {
		font-family: var(--font-serif);
		font-size: var(--text-xl);
		line-height: 1.15;
		letter-spacing: -0.01em;
		margin: var(--space-2) 0 var(--space-3);
	}
	.mr-article-head h2 a {
		color: var(--text);
		text-decoration: none;
	}
	.mr-article-head h2 a:hover {
		text-decoration: underline;
	}
	.mr-by {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.mr-actions {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}
	.mr-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
	}
	.mr-actions button:hover {
		color: var(--text);
		border-color: var(--accent);
	}
	.mr-actions button.active {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: var(--accent);
	}

	.mr-loading,
	.mr-fail {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* Lead figure: a visual anchor at the top of each feature, full measure. */
	.mr-lead {
		margin: 0 0 var(--space-5);
	}
	.mr-lead img {
		display: block;
		width: 100%;
		max-height: 22rem;
		object-fit: cover;
		border-radius: var(--radius);
	}

	/* Article body: the reader's own typography at full scale (×1). Content
	   styling lives in the shared .lectern-prose layer; only the magazine's
	   voice (drop cap, pull-quote, separators) is kept below. */
	.mr-body {
		font-family: var(--reader-font, var(--font-serif));
		font-size: calc(var(--reader-size, 19px) * 1);
		line-height: calc(var(--reader-leading, 1.6) + var(--prose-leading-boost, 0));
	}
	/* Pull-quote treatment: a hanging open-quote and a hairline, set in emphatic
	   serif italic — editorial, not the heavy accent stripe. */
	.mr-body :global(blockquote) {
		position: relative;
		margin: 1.8rem 0;
		padding-left: 1.4rem;
		border-left: 1px solid var(--border-strong);
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.12em;
		line-height: 1.5;
		color: var(--text);
	}
	.mr-body :global(blockquote)::before {
		content: '\201C';
		position: absolute;
		left: 0.5rem;
		top: -0.35rem;
		font-family: var(--font-serif);
		font-size: 2.2em;
		line-height: 1;
		color: var(--border-strong);
		pointer-events: none;
	}

	/* End-of-article mark — a small printed full stop to the feature. */
	.mr-end {
		margin: 1.4rem 0 0;
		text-align: right;
		color: var(--text-muted);
		font-size: 1.15rem;
		line-height: 1;
	}

	.mr-top {
		display: inline-block;
		margin-top: 1.5rem;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.mr-top:hover {
		color: var(--accent);
	}
</style>
