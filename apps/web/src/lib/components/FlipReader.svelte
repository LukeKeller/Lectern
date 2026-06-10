<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { getArticleHtml, prefetchArticles } from '$lib/content';
	import { getSync } from '$lib/sync';
	import Icon from '$lib/components/Icon.svelte';
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';

	// Newspaper reading flows DOWN one column then UP for the next when the whole
	// article is one tall balanced block. To keep scrolling essentially downward,
	// break the article into short stacked bands: each band is a bounded 2-column
	// block, and headings/media/quotes/tables become full-width dividers between
	// bands. Magazine never calls this — it keeps its single-measure flow.
	type Band = { kind: 'flow' | 'full'; html: string };
	function splitBands(raw: string): Band[] {
		if (typeof DOMParser === 'undefined' || !raw) return [{ kind: 'flow', html: raw }];
		const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html');
		// Headings, media, quotes, tables and preformatted blocks must break to
		// full width so they read as section dividers. Lists are left to flow with
		// the surrounding paragraphs (they're usually short and read fine in column).
		const FULL = new Set([
			'FIGURE',
			'IMG',
			'TABLE',
			'PRE',
			'BLOCKQUOTE',
			'H1',
			'H2',
			'H3',
			'H4',
			'HR',
			'VIDEO',
			'IFRAME'
		]);
		const out: Band[] = [];
		let buf: string[] = [];
		let words = 0;
		const flush = () => {
			if (buf.length) {
				out.push({ kind: 'flow', html: buf.join('') });
				buf = [];
				words = 0;
			}
		};
		for (const node of Array.from(doc.body.childNodes)) {
			const el = node.nodeType === 1 ? (node as Element) : null;
			if (!el && !(node.textContent ?? '').trim()) continue;
			const tag = el?.tagName ?? '';
			if (el && FULL.has(tag)) {
				flush();
				out.push({ kind: 'full', html: el.outerHTML });
				continue;
			}
			const piece = el ? el.outerHTML : (node.textContent ?? '');
			const w = (node.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
			buf.push(piece);
			words += w;
			// ~130 words ≈ 6-8 lines per column, so the up-scroll per band is small.
			if (words >= 130) flush();
		}
		flush();
		return out.length ? out : [{ kind: 'flow', html: raw }];
	}

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

	// Snapshot the cards once. Marking a story read mutates the live edition, which
	// would otherwise reshuffle this array under the reader mid-flip — the reading
	// session is fixed to the issue you opened.
	const pages = untrack(() => cards.slice());

	let index = $state(untrack(() => Math.max(0, Math.min(start, pages.length - 1))));
	let dir = $state(1);
	let html = $state('');
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	let stageEl = $state<HTMLElement | null>(null);

	// Read state we apply locally for instant feedback; the markRead mutation is
	// also queued to sync. Seeded from anything already finished.
	const readIds = new SvelteSet(
		untrack(() => pages.filter((c) => c.readState === 'finished').map((c) => c.id))
	);

	const current = $derived(pages[index]);
	const total = $derived(pages.length);
	const currentRead = $derived(current ? readIds.has(current.id) : false);
	const bands = $derived(
		kind === 'newspaper' && !loading && !error && html ? splitBands(html) : null
	);
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
		prefetchArticles([pages[index + 1]?.id, pages[index - 1]?.id]);
		return () => {
			cancelled = true;
		};
	});

	// Mark a story read/unread: optimistic local set + queued sync mutation.
	function setRead(card: Card | undefined, read: boolean) {
		if (!card) return;
		if (read) readIds.add(card.id);
		else readIds.delete(card.id);
		const sync = getSync();
		void sync.enqueue({ type: 'markRead', id: card.id, read }).then(() => sync.flush());
	}

	function go(delta: number) {
		const next = index + delta;
		if (next < 0 || next >= total) return;
		// Turning forward marks the story you're leaving as read — the natural
		// "I've read this" signal. Turning back never un-reads.
		if (delta > 0) setRead(pages[index], true);
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
		<div class="rightset">
			<button
				type="button"
				class="readtoggle"
				class:active={currentRead}
				aria-pressed={currentRead}
				title={currentRead ? 'Marked read — undo' : 'Mark as read'}
				aria-label={currentRead ? 'Mark as unread' : 'Mark as read'}
				onclick={() => setRead(current, !currentRead)}
			>
				<Icon name="check" size={15} />
				<span class="readtoggle-label">{currentRead ? 'Read' : 'Mark read'}</span>
			</button>
			<span class="folio" aria-label={`Page ${index + 1} of ${total}`}>
				{index + 1}<span class="sep">/</span>{total}
			</span>
		</div>
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
					{:else if bands}
						<div class="fr-body fr-bands">
							{#each bands as band, i (i)}
								{#if i > 0 && band.kind === 'flow' && bands[i - 1].kind === 'flow'}
									<div class="fr-break" aria-hidden="true">❧</div>
								{/if}
								{#if band.kind === 'full'}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-full">{@html band.html}</div>
								{:else}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-band">{@html band.html}</div>
								{/if}
							{/each}
						</div>
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body">{@html html}</div>
					{/if}

					{#if !loading && !error}
						<p class="endmark" aria-hidden="true">∎</p>
					{/if}

					<a class="open-full" href={resolve('/read/[id]', { id: current.id })}>
						Open in full reader <Icon name="back" size={13} />
					</a>

					<footer class="runfoot" aria-hidden="true">{index + 1}</footer>
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
		/* A faint reading-light wash at the top fading into the warm ground gives the
		   full-bleed surface some depth before the grain is even applied. */
		background:
			radial-gradient(
				135% 90% at 50% -5%,
				color-mix(in srgb, var(--surface) 70%, transparent),
				transparent 58%
			),
			var(--bg);
		padding-top: env(safe-area-inset-top);
		padding-bottom: env(safe-area-inset-bottom);
	}
	/* A paper grain laid over the whole reading surface — tactile, not glassy.
	   Static, theme-agnostic via a soft-light blend, and never intercepts input. */
	.flip::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background-image: var(--grain);
		background-size: 180px 180px;
		opacity: var(--grain-strength);
		mix-blend-mode: soft-light;
	}
	/* Keep the chrome and reading column above the grain. */
	.flipbar,
	.stage {
		position: relative;
		z-index: 1;
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
		font-variant-caps: small-caps;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rightset {
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}
	/* Read toggle in the running head — reflects (and overrides) the auto-mark that
	   fires when you turn the page. Mirrors the pill controls elsewhere. */
	.readtoggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.26rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text-muted);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.readtoggle:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.readtoggle.active {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: var(--accent);
	}
	.folio {
		font-variant-numeric: tabular-nums;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	@media (max-width: 560px) {
		.readtoggle-label {
			display: none;
		}
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
		margin: 1.4em 0;
		padding-left: 1.1em;
		border-left: 1px solid var(--border-strong);
		color: var(--text);
		font-style: italic;
		font-size: 1.06em;
		line-height: 1.5;
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

	/* Newspaper — short stacked bands so reading flows downward instead of all the
	   way down one tall column and back up to the top of the next. */
	.flip.newspaper .head h1 {
		font-size: clamp(1.7rem, 4vw, 2.6rem);
	}
	/* The bands wrapper is a plain vertical stack; columns live inside each band. */
	.fr-bands {
		display: flex;
		flex-direction: column;
	}
	/* Each band is a short, bounded 2-column block. The `2 17rem` form caps at two
	   columns and collapses to a single column on narrow screens. Ragged-right:
	   greedy line-breaking justified ~31ch columns into rivers, so keep the left
	   axis and let hyphenation + pretty wrapping tidy the rag. */
	.fr-band {
		columns: 2 17rem;
		column-gap: 2.4rem;
		column-rule: 1px solid var(--border);
		text-align: left;
		hyphens: auto;
		hyphenate-limit-chars: 6 3 2;
		text-wrap: pretty;
	}
	/* Breathing room between consecutive bands; the floret rule (.fr-break) carries
	   the visible separation, so no border is needed when bands sit back-to-back. */
	.fr-band + .fr-band {
		margin-top: 1.6em;
	}
	/* An editorial floret between two flowing bands — a centered ornament flanked by
	   hairlines, reading as a quiet section break rather than a hard rule. */
	.fr-break {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		margin: 1.8em 0;
		color: var(--text-muted);
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		line-height: 1;
		user-select: none;
	}
	.fr-break::before,
	.fr-break::after {
		content: '';
		width: 2.5rem;
		height: 1px;
		background: var(--border);
	}
	/* Full-width dividers: headings, media, quotes, tables. Generous margins make
	   them read as section breaks between the column bands. */
	.fr-full {
		margin: 1.8em 0;
	}
	.fr-full :global(img),
	.fr-full :global(figure),
	.fr-full :global(video),
	.fr-full :global(iframe),
	.fr-full :global(table),
	.fr-full :global(pre) {
		max-width: 100%;
	}
	/* Drop cap on the very first paragraph of the first band only. */
	.flip.newspaper .fr-bands > .fr-band:first-child :global(p:first-of-type)::first-letter {
		float: left;
		font-family: var(--font-serif);
		font-weight: 800;
		font-size: 3.1em;
		line-height: 0.72;
		padding: 0.06em 0.08em 0 0;
	}
	/* Small-caps lead-in on the opening line — the classic newspaper entry. */
	.flip.newspaper .fr-bands > .fr-band:first-child :global(p:first-of-type)::first-line {
		font-variant-caps: small-caps;
		letter-spacing: 0.03em;
	}

	/* End-of-article mark and a running foot folio give each page a printed
	   beginning-middle-end, the depth a real leaf carries. */
	.endmark {
		margin: 1.6rem 0 0;
		text-align: right;
		color: var(--text-muted);
		font-size: 1.15rem;
		line-height: 1;
	}
	.runfoot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		margin-top: 2.4rem;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		letter-spacing: 0.12em;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.runfoot::before,
	.runfoot::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
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
	.flip.magazine .fr-body :global(p:first-of-type)::first-line {
		font-variant-caps: small-caps;
		letter-spacing: 0.02em;
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
		z-index: 2;
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
