<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';
	import { getSync } from '$lib/sync';
	import { buildMagazines, magazineTitle, type Magazine } from '$lib/magazine';
	import Icon from '$lib/components/Icon.svelte';
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';
	import MagazineReader from '$lib/components/MagazineReader.svelte';

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

	// A stable two-digit issue number per publication, so each cover wears a
	// consistent "No." the way a real magazine masthead would.
	function issueNo(tag: string): number {
		let h = 7;
		for (let i = 0; i < tag.length; i++) h = (h * 17 + tag.charCodeAt(i)) % 90;
		return h + 9;
	}
	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}
	function plural(n: number, word: string): string {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}
	// The first few titles double as cover lines / teaser blurbs.
	function coverLines(list: Card[]): Card[] {
		return list.slice(0, 3);
	}
	// The cover art is the first article in the issue that carries an image.
	function coverArt(list: Card[]): string | null {
		for (const c of list) if (c.coverImage) return c.coverImage;
		return null;
	}
	// Tags whose cover image failed to load — fall back to the gradient-only cover.
	const failedArt = new SvelteSet<string>();
	// Synthetic folios: front matter fills the opening leaves, then each article
	// spans a couple of pages, giving the contents real ascending page numbers.
	function folios(list: Card[]): number[] {
		const out: number[] = [];
		let page = 11;
		for (const c of list) {
			out.push(page);
			const span = c.readingTimeMinutes ?? Math.max(1, Math.round((c.wordCount ?? 700) / 220));
			page += Math.max(2, Math.ceil(span / 3) * 2);
		}
		return out;
	}

	let opened = $state<{ magazine: Magazine; startId?: string } | null>(null);
	// Plain left-click opens the focused magazine reader (all articles in sequence
	// with a contents list); modified clicks fall through to the href so the full
	// single-article reader still opens in a new tab.
	function openMagazine(e: MouseEvent, magazine: Magazine, startId?: string) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		opened = { magazine, startId };
		window.scrollTo(0, 0);
	}

	onMount(() => {
		void getSync().pull();
	});
</script>

{#snippet tocEntry(magazine: Magazine, index: number, num: number, folio: number)}
	{@const card = magazine.cards[index]}
	{#if card}
		<li>
			<a
				class="entry"
				href={resolve('/read/[id]', { id: card.id })}
				onclick={(e) => openMagazine(e, magazine, card.id)}
			>
				<span class="num">{pad(num)}</span>
				<span class="entry-main">
					<span class="entry-row">
						<span class="entry-title">{card.title}</span>
						<span class="folio">{folio}</span>
					</span>
					{#if meta(card)}<span class="entry-by">{meta(card)}</span>{/if}
				</span>
			</a>
		</li>
	{/if}
{/snippet}

{#snippet coverArtLayers(list: Card[], tag: string, eager = false)}
	{@const art = coverArt(list)}
	{#if art && !failedArt.has(tag)}
		<img
			class="cover-art"
			src={art}
			alt=""
			aria-hidden="true"
			loading={eager ? 'eager' : 'lazy'}
			onerror={() => failedArt.add(tag)}
		/>
		<div class="cover-tint" aria-hidden="true"></div>
	{/if}
{/snippet}

{#if opened}
	<MagazineReader
		magazine={opened.magazine}
		startId={opened.startId}
		onclose={() => (opened = null)}
	/>
{:else}
	<section class="page">
		<header class="head">
			<h1>Magazines</h1>
			<p class="lede">
				Your saved library, bound into themed issues. Each tag shared by two or more articles
				becomes a collection of related reading.
			</p>
		</header>

		{#if issues.length === 0}
			<div class="empty">
				<span class="empty-mark"><Icon name="magazine" size={28} /></span>
				<p>No magazines yet — tag a few saved articles with the same topic to bind an issue.</p>
			</div>
		{:else}
			{@const featured = issues[0]}
			{@const lead = featured.cards[0]}
			{@const featFolios = folios(featured.cards)}
			{@const rest = issues.slice(1)}

			<section class="hero" style={`--hue:${hue(featured.tag)}`}>
				<div class="cover hero-cover">
					{@render coverArtLayers(featured.cards, featured.tag, true)}
					<span class="masthead">Lectern</span>
					<h2 class="cover-title">{magazineTitle(featured.tag)}</h2>
					<p class="cover-no">Issue No. {pad(issueNo(featured.tag))}</p>
					<p class="cover-count">{plural(featured.cards.length, 'article')}</p>
					<ul class="cover-lines" aria-hidden="true">
						{#each coverLines(featured.cards) as card (card.id)}
							<li>{card.title}</li>
						{/each}
					</ul>
					<div class="cover-foot">
						<span class="foil"></span>
						<span class="cover-foot-row">
							<span>Lectern Press</span>
							<span>Self-hosted</span>
						</span>
					</div>
				</div>

				<div class="spread">
					<p class="kicker">In this issue</p>
					<a
						class="feature"
						href={resolve('/read/[id]', { id: lead.id })}
						onclick={(e) => openMagazine(e, featured, lead.id)}
					>
						<span class="feature-kicker">Lead story</span>
						<h3 class="feature-title">{lead.title}</h3>
						<span class="feature-by">
							<SourceAvatar url={lead.url} siteName={lead.siteName} size={22} />
							{#if meta(lead)}<span>{meta(lead)}</span>{/if}
						</span>
					</a>
					{#if featured.cards.length > 1}
						<p class="kicker also">Also inside</p>
						<ol class="toc">
							{#each featured.cards.slice(1) as card, i (card.id)}
								{@render tocEntry(featured, i + 1, i + 1, featFolios[i + 1])}
							{/each}
						</ol>
					{/if}
				</div>
			</section>

			<div class="shelf">
				{#each rest as issue (issue.tag)}
					<article class="zine" style={`--hue:${hue(issue.tag)}`}>
						<button class="cover cover-btn" type="button" onclick={(e) => openMagazine(e, issue)}>
							{@render coverArtLayers(issue.cards, issue.tag)}
							<span class="masthead">Lectern</span>
							<h2 class="cover-title">{magazineTitle(issue.tag)}</h2>
							<p class="cover-no">Issue No. {pad(issueNo(issue.tag))}</p>
							<p class="cover-count">{plural(issue.cards.length, 'article')}</p>
							<ul class="cover-lines" aria-hidden="true">
								{#each coverLines(issue.cards) as card (card.id)}
									<li>{card.title}</li>
								{/each}
							</ul>
							<div class="cover-foot">
								<span class="foil"></span>
								<span class="cover-foot-row">
									<span class="open-hint">Open issue</span>
									<span>Lectern</span>
								</span>
							</div>
						</button>
					</article>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	.page {
		position: relative;
		max-width: 72rem;
		margin: 0 auto;
	}
	/* A faint grain over the whole rack so the paper has tooth behind the covers. */
	.page::before {
		content: '';
		position: absolute;
		inset: -1rem -1.5rem;
		z-index: 0;
		pointer-events: none;
		background-image: var(--grain);
		background-size: 180px 180px;
		opacity: var(--grain-strength);
		mix-blend-mode: soft-light;
	}
	.page > * {
		position: relative;
		z-index: 1;
	}
	.head {
		margin-bottom: 1.8rem;
		padding-bottom: 1.1rem;
		border-bottom: 1px solid var(--border);
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

	.kicker {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0 0 0.85rem;
	}
	.kicker.also {
		margin-top: 1.4rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	/* ---- featured hero spread ---- */
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 22rem) 1fr;
		gap: clamp(1.2rem, 2.8vw, 2.2rem);
		align-items: stretch;
		margin-bottom: clamp(2rem, 5vw, 3.5rem);
	}

	/* ---- covers (the hero cover and the grid covers share .cover) ---- */
	.cover {
		position: relative;
		display: flex;
		flex-direction: column;
		aspect-ratio: 3 / 4;
		padding: clamp(1rem, 2.2vw, 1.5rem);
		border-radius: var(--radius-lg);
		overflow: hidden;
		color: color-mix(in srgb, white 94%, transparent);
		background: linear-gradient(
			158deg,
			hsl(var(--hue) 58% 40%),
			hsl(calc(var(--hue) + 32) 60% 24%)
		);
	}
	/* Cover art: the issue's first article image, desaturated so the brand hue
	   (applied by .cover-tint above it) can tint it into a cohesive duotone and
	   white cover text stays legible over any photo. Clipped to the cover shape
	   by the parent's overflow:hidden + border-radius. Sits behind everything. */
	.cover > .cover-art {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: grayscale(1) contrast(1.04) brightness(0.95);
	}
	/* Brand-hue duotone wash: multiplies the publication's color over the
	   desaturated photo so each cover reads in its own brand color. */
	.cover > .cover-tint {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(
			158deg,
			hsl(var(--hue) 58% 42%),
			hsl(calc(var(--hue) + 32) 62% 26%)
		);
		mix-blend-mode: multiply;
		pointer-events: none;
	}
	/* Functional scrims — keep masthead/title and the foot row legible over the
	   cover art. Top + bottom darkening so text reads even on a bright photo.
	   No glossy highlight (Flat-At-Rest: no decorative sheen); resting covers
	   carry no shadow, the clickable ones lift on hover (.cover-btn). */
	.cover::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 2;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.32) 0%,
			transparent 30%,
			transparent 50%,
			rgba(0, 0, 0, 0.42) 100%
		);
		pointer-events: none;
	}
	.cover > * {
		position: relative;
		z-index: 3;
	}
	.masthead {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		font-weight: 700;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: color-mix(in srgb, white 92%, transparent);
	}
	.cover-title {
		font-family: var(--font-serif);
		font-weight: 800;
		line-height: 1.02;
		letter-spacing: -0.015em;
		text-transform: capitalize;
		word-break: break-word;
		margin: 0.4rem 0 0.55rem;
		text-shadow: 0 1px 18px rgba(0, 0, 0, 0.28);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.cover-no {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		margin: 0;
		color: color-mix(in srgb, white 80%, hsl(var(--hue) 45% 30%));
	}
	.cover-count {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		margin: 0.22rem 0 0;
		color: color-mix(in srgb, white 70%, hsl(var(--hue) 45% 30%));
	}
	.cover-lines {
		list-style: none;
		margin: auto 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.cover-lines li {
		font-family: var(--font-serif);
		font-size: clamp(0.95rem, 1.4vw, 1.1rem);
		line-height: 1.22;
		padding-left: 0.6rem;
		border-left: 2px solid color-mix(in srgb, white 55%, transparent);
		color: color-mix(in srgb, white 88%, hsl(var(--hue) 50% 28%));
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.zine .cover-lines li {
		-webkit-line-clamp: 1;
		line-clamp: 1;
		font-size: clamp(0.9rem, 1.3vw, 1rem);
	}
	.cover-foot {
		margin-top: 0.9rem;
	}
	.foil {
		display: block;
		height: 2px;
		border-radius: var(--radius-full);
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in srgb, white 78%, transparent),
			color-mix(in srgb, white 30%, transparent),
			transparent
		);
	}
	.cover-foot-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-top: 0.55rem;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: color-mix(in srgb, white 74%, transparent);
	}
	.hero-cover .cover-title {
		font-size: clamp(2rem, 4.5vw, 3rem);
	}
	.zine .cover-title {
		font-size: clamp(1.45rem, 4vw, 1.95rem);
	}

	/* ---- featured "in this issue" column ----
	   The contents sit on a paper leaf beside the cover, so the hero reads as an
	   open magazine: glossy cover on the left, printed contents page on the right. */
	.spread {
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: clamp(1.1rem, 2.2vw, 1.9rem) clamp(1.2rem, 2.4vw, 2.1rem);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--edge-hi), var(--shadow-paper);
	}
	.feature {
		display: block;
	}
	.feature-kicker {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.feature-title {
		font-family: var(--font-serif);
		font-weight: 800;
		font-size: clamp(1.7rem, 3.4vw, 2.6rem);
		line-height: 1.08;
		letter-spacing: -0.02em;
		color: var(--text);
		margin: 0.4rem 0 0.65rem;
		transition: color var(--dur-fast) var(--ease);
	}
	.feature:hover .feature-title {
		color: var(--accent);
	}
	.feature-by {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	/* ---- table of contents ---- */
	.toc {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.entry {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.5rem 0.45rem;
		border-radius: var(--radius);
		transition: background var(--dur-fast) var(--ease);
	}
	.entry:hover {
		background: var(--surface-alt);
	}
	.num {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.entry-main {
		min-width: 0;
	}
	.entry-row {
		display: flex;
		align-items: baseline;
	}
	.entry-title {
		order: 0;
		flex: 0 1 auto;
		font-family: var(--font-serif);
		font-size: var(--text-md);
		line-height: 1.3;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color var(--dur-fast) var(--ease);
	}
	.entry:hover .entry-title {
		color: var(--accent);
	}
	.entry-row::after {
		content: '';
		order: 1;
		flex: 1 1 0.75rem;
		min-width: 0.75rem;
		margin: 0 0.5rem;
		border-bottom: 1px dotted var(--border-strong);
		transform: translateY(-0.28em);
	}
	.folio {
		order: 2;
		flex: none;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.entry-by {
		display: block;
		margin-top: 0.12rem;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ---- shelf grid of covers ---- */
	.shelf {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
		gap: clamp(1.2rem, 2.5vw, 1.8rem);
		align-items: start;
	}
	.zine {
		min-width: 0;
	}
	/* Shelf cover is now a button that opens the focused reader. */
	.cover-btn {
		width: 100%;
		border: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			transform var(--dur) var(--ease),
			box-shadow var(--dur) var(--ease);
	}
	.cover-btn:hover {
		transform: translateY(-3px);
		box-shadow: var(--shadow);
	}
	.cover-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	.open-hint {
		display: inline-flex;
		align-items: center;
	}
	.open-hint::after {
		content: '▸';
		margin-left: 0.4rem;
	}

	/* ---- empty state ---- */
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

	@media (max-width: 820px) {
		.hero {
			grid-template-columns: 1fr;
		}
		.hero-cover {
			max-width: 24rem;
		}
	}
</style>
