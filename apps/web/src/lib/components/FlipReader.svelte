<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import { getArticleHtml, prefetchArticles } from '$lib/content';
	import Icon from '$lib/components/Icon.svelte';
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';

	let {
		cards,
		start = 0,
		kind,
		label,
		onclose
	}: {
		cards: Card[];
		start?: number;
		kind: 'newspaper' | 'magazine';
		label: string;
		onclose: () => void;
	} = $props();

	let index = $state(untrack(() => Math.max(0, Math.min(start, cards.length - 1))));
	let dir = $state(1);
	let html = $state('');
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	let stageEl = $state<HTMLElement | null>(null);

	const current = $derived(cards[index]);
	const total = $derived(cards.length);
	const SKELETON_WIDTHS = [78, 92, 85, 70, 96, 82, 90, 74];

	function byline(card: Card): string {
		const parts: string[] = [];
		if (card.author) parts.push(card.author);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min read`);
		return parts.join(' \u00b7 ');
	}

	// Load (and sanitize, once) the current article whenever the page turns, and
	// warm the neighbours so the next flip is instant.
	$effect(() => {
		const card = current;
		if (!card) return;
		let cancelled = false;
		loading = true;
		error = undefined;
		getArticleHtml(card.id)
			.then((h) => {
				if (cancelled) return;
				html = h;
				loading = false;
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				error = e instanceof Error ? e.message : String(e);
				loading = false;
			});
		prefetchArticles([cards[index + 1]?.id, cards[index - 1]?.id]);
		return () => {
			cancelled = true;
		};
	});

	function go(delta: number) {
		const next = index + delta;
		if (next < 0 || next >= total) return;
		dir = delta;
		index = next;
		stageEl?.scrollTo({ top: 0 });
	}

	function isEditable(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
		if (e.key === 'ArrowRight' || e.key === 'PageDown') {
			go(1);
			e.preventDefault();
		} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
			go(-1);
			e.preventDefault();
		} else if (e.key === 'Escape') {
			onclose();
			e.preventDefault();
		}
	}

	let touchX = 0;
	let touchY = 0;
	function onTouchStart(e: TouchEvent) {
		touchX = e.changedTouches[0]?.clientX ?? 0;
		touchY = e.changedTouches[0]?.clientY ?? 0;
	}
	function onTouchEnd(e: TouchEvent) {
		const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
		const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			window.removeEventListener('keydown', onKey);
			document.body.style.overflow = prevOverflow;
		};
	});
</script>

<div class="flip {kind}" role="dialog" aria-modal="true" aria-label={label}>
	<header class="flipbar">
		<button type="button" class="icon" onclick={onclose} aria-label="Close issue">
			<Icon name="close" size={18} />
		</button>
		<span class="issue">{label}</span>
		<span class="folio" aria-label={`Page ${index + 1} of ${total}`}>
			{index + 1}<span class="sep">/</span>{total}
		</span>
	</header>

	<div
		class="stage"
		role="group"
		aria-label="Issue pages"
		bind:this={stageEl}
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
	>
		{#if current}
			{#key index}
				<article class="page" in:fly={{ x: dir >= 0 ? 36 : -36, duration: 220, opacity: 0 }}>
					<div class="head">
						<span class="kicker">
							<SourceAvatar url={current.url} siteName={current.siteName} size={18} />
							<span>{current.siteName ?? 'Article'}</span>
						</span>
						<h1>{current.title}</h1>
						{#if byline(current)}<p class="byline">{byline(current)}</p>{/if}
					</div>

					{#if loading}
						<div class="skeleton" aria-hidden="true">
							{#each SKELETON_WIDTHS as w, i (i)}<span style={`width:${w}%`}></span>{/each}
						</div>
					{:else if error}
						<p class="error">
							This article couldn't be loaded here.
							<a href={resolve('/read/[id]', { id: current.id })}>Open it in the reader</a>.
						</p>
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body">{@html html}</div>
					{/if}

					<a class="open-full" href={resolve('/read/[id]', { id: current.id })}>
						Open in full reader <Icon name="back" size={13} />
					</a>
				</article>
			{/key}
		{/if}
	</div>

	<button
		type="button"
		class="turn prev"
		onclick={() => go(-1)}
		disabled={index === 0}
		aria-label="Previous article"
	>
		<Icon name="back" size={22} />
	</button>
	<button
		type="button"
		class="turn next"
		onclick={() => go(1)}
		disabled={index === total - 1}
		aria-label="Next article"
	>
		<span class="flip-x"><Icon name="back" size={22} /></span>
	</button>
</div>

<style>
	.flip {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		padding-top: env(safe-area-inset-top);
		padding-bottom: env(safe-area-inset-bottom);
	}

	.flipbar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.9rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg);
	}
	.icon {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease);
	}
	.icon:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.issue {
		text-align: center;
		font-family: var(--font-serif);
		font-size: var(--text-sm);
		letter-spacing: 0.02em;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.folio {
		justify-self: end;
		font-variant-numeric: tabular-nums;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.folio .sep {
		margin: 0 0.2rem;
		opacity: 0.5;
	}

	.stage {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-behavior: smooth;
	}
	.page {
		max-width: 56rem;
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1.1rem, 5vw, 4rem) 5rem;
	}

	.head {
		text-align: center;
		padding-bottom: 1.1rem;
		margin-bottom: 1.6rem;
		border-bottom: 1px solid var(--border);
	}
	.kicker {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.head h1 {
		font-family: var(--font-serif);
		font-weight: 800;
		line-height: 1.08;
		letter-spacing: -0.018em;
		text-wrap: balance;
		margin: 0.5rem 0 0;
		color: var(--text);
	}
	.byline {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0.7rem 0 0;
	}

	/* Article body — shared base, then per-kind treatment. {@html} content needs
	   :global selectors since it carries no Svelte scope attributes. */
	.fr-body {
		font-family: var(--font-serif);
		color: var(--text);
		font-size: 1.06rem;
		line-height: 1.7;
	}
	.fr-body :global(p) {
		margin: 0 0 1em;
	}
	.fr-body :global(h2),
	.fr-body :global(h3) {
		font-family: var(--font-serif);
		line-height: 1.2;
		margin: 1.4em 0 0.4em;
	}
	.fr-body :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.fr-body :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius);
	}
	.fr-body :global(figure) {
		margin: 1.2em 0;
	}
	.fr-body :global(figcaption) {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-align: center;
		margin-top: 0.4em;
	}
	.fr-body :global(blockquote) {
		margin: 1.2em 0;
		padding-left: 1em;
		border-left: 3px solid var(--border-strong);
		color: var(--text-muted);
		font-style: italic;
	}
	.fr-body :global(pre) {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: var(--bg-sunken);
		padding: 0.9em 1em;
		border-radius: var(--radius);
		overflow-x: auto;
		white-space: pre;
	}

	/* Newspaper — justified serif columns with hairline rules. */
	.flip.newspaper .head h1 {
		font-size: clamp(1.7rem, 4vw, 2.6rem);
	}
	.flip.newspaper .fr-body {
		columns: 19rem;
		column-gap: 2.4rem;
		column-rule: 1px solid var(--border);
		text-align: justify;
		hyphens: auto;
	}
	/* Media + headings span the columns so the flow stays readable. */
	.flip.newspaper .fr-body :global(figure),
	.flip.newspaper .fr-body :global(img),
	.flip.newspaper .fr-body :global(pre),
	.flip.newspaper .fr-body :global(table),
	.flip.newspaper .fr-body :global(h2) {
		column-span: all;
	}
	.flip.newspaper .fr-body :global(p:first-of-type)::first-letter {
		float: left;
		font-weight: 800;
		font-size: 3.1em;
		line-height: 0.72;
		padding: 0.06em 0.08em 0 0;
	}

	/* Magazine — a single generous measure with a feature drop cap. */
	.flip.magazine .head {
		text-align: left;
		border-bottom: 0;
	}
	.flip.magazine .head h1 {
		font-size: clamp(2rem, 5vw, 3.2rem);
	}
	.flip.magazine .page {
		max-width: 42rem;
	}
	.flip.magazine .fr-body {
		font-size: 1.12rem;
		line-height: 1.75;
	}
	.flip.magazine .fr-body :global(p:first-of-type)::first-letter {
		float: left;
		font-weight: 800;
		font-size: 3.4em;
		line-height: 0.7;
		padding: 0.04em 0.1em 0 0;
		color: var(--accent);
	}

	.open-full {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 2rem;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.open-full :global(svg) {
		transform: scaleX(-1);
	}
	.open-full:hover {
		color: var(--accent);
	}

	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-top: 0.5rem;
	}
	.skeleton span {
		height: 0.85rem;
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, var(--surface-alt), var(--bg-sunken), var(--surface-alt));
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
	.error {
		color: var(--text-muted);
		font-family: var(--font-ui);
	}
	.error a {
		color: var(--accent);
	}

	/* Page-turn controls pinned to the screen edges. */
	.turn {
		position: fixed;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.8rem;
		height: 2.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text-muted);
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}
	.turn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.turn:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.turn.prev {
		left: clamp(0.5rem, 2vw, 1.5rem);
	}
	.turn.next {
		right: clamp(0.5rem, 2vw, 1.5rem);
	}
	.flip-x {
		display: inline-flex;
		transform: scaleX(-1);
	}

	@media (max-width: 700px) {
		.turn {
			top: auto;
			bottom: calc(0.8rem + env(safe-area-inset-bottom));
			transform: none;
		}
	}
</style>
