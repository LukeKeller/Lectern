<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';
	import { getSync } from '$lib/sync';
	import {
		buildEdition,
		latestIssueKey,
		parseDateKey,
		shiftDateKey,
		todayKey,
		yesterdayKey
	} from '$lib/newspaper';
	import Icon from '$lib/components/Icon.svelte';
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';

	const all = liveCards(() => db.cards.toArray());
	const cards = $derived((all.value ?? []) as Card[]);

	// The issue on screen. Null until the reader picks a day, so the masthead can
	// open to the most recent non-empty issue (≤ yesterday) by default.
	let picked = $state<string | null>(null);
	const issueKey = $derived(picked ?? latestIssueKey(cards, yesterdayKey()));
	const edition = $derived(buildEdition(cards, issueKey));

	const dateLabel = $derived(
		new Intl.DateTimeFormat(undefined, {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		}).format(parseDateKey(issueKey))
	);
	const atToday = $derived(issueKey >= todayKey());

	function step(days: number) {
		picked = shiftDateKey(issueKey, days);
	}
	function jumpLatest() {
		picked = latestIssueKey(cards, yesterdayKey());
	}

	function markIssueRead() {
		const sync = getSync();
		let queued = false;
		for (const c of [edition.lead, ...edition.sections.flatMap((s) => s.cards)]) {
			if (!c) continue;
			void sync.enqueue({
				type: 'setReadingProgress',
				id: c.id,
				readingProgress: 1,
				readAnchor: null
			});
			queued = true;
		}
		if (queued) void sync.flush();
	}

	function dek(card: Card): string {
		const parts: string[] = [];
		if (card.author) parts.push(card.author);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min read`);
		return parts.join(' · ');
	}

	onMount(() => {
		void getSync().pull();
	});
</script>

<section class="paper">
	<header class="masthead">
		<p class="kicker">Lectern Daily · your unread feed, set in print</p>
		<h1>The Daily Lectern</h1>
		<div class="dateline">
			<button type="button" class="nav" onclick={() => step(-1)} aria-label="Previous day">
				<Icon name="back" size={16} />
			</button>
			<span class="date">{dateLabel}</span>
			<button
				type="button"
				class="nav"
				onclick={() => step(1)}
				disabled={atToday}
				aria-label="Next day"
			>
				<span class="flip"><Icon name="back" size={16} /></span>
			</button>
		</div>
		<p class="edition">
			{#if edition.total > 0}
				{edition.total}
				{edition.total === 1 ? 'story' : 'stories'} across {edition.sections.length +
					(edition.lead ? 1 : 0)}
				{edition.sections.length + (edition.lead ? 1 : 0) === 1 ? 'section' : 'sections'}
			{:else}
				No edition
			{/if}
		</p>
		{#if edition.total > 0}
			<div class="tools">
				<button type="button" class="ghost" onclick={markIssueRead}>
					<Icon name="check" size={15} /> Mark issue read
				</button>
			</div>
		{/if}
	</header>

	{#if edition.total === 0}
		<div class="empty">
			<span class="empty-mark"><Icon name="newspaper" size={28} /></span>
			<p>Nothing was filed for {dateLabel}.</p>
			<button type="button" class="link" onclick={jumpLatest}>Jump to the latest edition</button>
		</div>
	{:else}
		{#if edition.lead}
			<a class="lead" href={resolve('/read/[id]', { id: edition.lead.id })}>
				<span class="section-tag">{edition.lead.siteName ?? 'Front page'}</span>
				<h2>{edition.lead.title}</h2>
				{#if edition.lead.note}<p class="standfirst">{edition.lead.note}</p>{/if}
				<p class="byline">{dek(edition.lead)}</p>
			</a>
		{/if}

		<div class="sections">
			{#each edition.sections as section (section.name)}
				<section class="col">
					<h3 class="section-head">
						<SourceAvatar url={section.cards[0]?.url ?? ''} siteName={section.name} size={18} />
						<span>{section.name}</span>
						<span class="ct">{section.cards.length}</span>
					</h3>
					<ul>
						{#each section.cards as card (card.id)}
							<li>
								<a href={resolve('/read/[id]', { id: card.id })}>
									<span class="hl">{card.title}</span>
									{#if dek(card)}<span class="meta">{dek(card)}</span>{/if}
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</section>

<style>
	.paper {
		max-width: 70rem;
		margin: 0 auto;
	}

	/* Masthead — the only place we lean fully into the print metaphor. */
	.masthead {
		text-align: center;
		padding-bottom: 1.1rem;
		border-bottom: 3px double var(--border-strong);
		margin-bottom: 1.6rem;
	}
	.kicker {
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0 0 0.5rem;
	}
	h1 {
		font-family: var(--font-serif);
		font-size: clamp(2.4rem, 6vw, 3.6rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1;
		margin: 0;
	}
	.dateline {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		margin: 0.7rem 0 0.2rem;
	}
	.date {
		font-family: var(--font-serif);
		font-size: var(--text-base);
		font-style: italic;
		color: var(--text-muted);
		min-width: 16rem;
	}
	.nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.nav:hover:not(:disabled) {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.nav:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.flip {
		display: inline-flex;
		transform: scaleX(-1);
	}
	.edition {
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0.3rem 0 0;
	}
	.tools {
		margin-top: 0.7rem;
	}
	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.32rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.ghost:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}

	/* Lead story — the front-page splash. */
	.lead {
		display: block;
		padding: 0 0 1.6rem;
		margin-bottom: 1.6rem;
		border-bottom: 1px solid var(--border);
		text-align: center;
		max-width: 46rem;
		margin-inline: auto;
	}
	.section-tag {
		font-size: var(--text-2xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
		font-weight: 700;
	}
	.lead h2 {
		font-family: var(--font-serif);
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 800;
		line-height: 1.08;
		letter-spacing: -0.02em;
		margin: 0.4rem 0 0;
		color: var(--text);
		transition: color var(--dur-fast) var(--ease);
	}
	.lead:hover h2 {
		color: var(--accent);
	}
	.standfirst {
		font-family: var(--font-serif);
		font-size: var(--text-md);
		line-height: 1.5;
		color: var(--text-muted);
		margin: 0.6rem auto 0;
		max-width: 34rem;
	}
	.byline {
		font-size: var(--text-xs);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0.7rem 0 0;
	}

	/* Sections — newspaper columns that reflow with the viewport. */
	.sections {
		columns: 3 16rem;
		column-gap: 2.2rem;
	}
	.col {
		break-inside: avoid;
		margin-bottom: 1.6rem;
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.6rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px solid var(--text);
		font-family: var(--font-serif);
		font-size: var(--text-md);
		font-weight: 700;
	}
	.section-head span:first-of-type {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.section-head .ct {
		margin-left: auto;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.col ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.col li {
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border);
	}
	.col li:last-child {
		border-bottom: 0;
	}
	.col a {
		display: block;
	}
	.hl {
		display: block;
		font-family: var(--font-serif);
		font-size: var(--text-base);
		font-weight: 600;
		line-height: 1.32;
		color: var(--text);
		transition: color var(--dur-fast) var(--ease);
	}
	.col a:hover .hl {
		color: var(--accent);
	}
	.meta {
		display: block;
		margin-top: 0.2rem;
		font-size: var(--text-xs);
		color: var(--text-muted);
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
		font-size: var(--text-base);
	}
	.link {
		border: 0;
		background: transparent;
		color: var(--accent);
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
	}
</style>
