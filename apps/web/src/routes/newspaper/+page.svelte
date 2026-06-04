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
	import FlipReader from '$lib/components/FlipReader.svelte';

	const all = liveCards(() => db.cards.toArray());
	const cards = $derived((all.value ?? []) as Card[]);

	// The issue on screen. Null until the reader picks a day, so the masthead can
	// open to the most recent non-empty issue (≤ yesterday) by default.
	let picked = $state<string | null>(null);
	const issueKey = $derived(picked ?? latestIssueKey(cards, yesterdayKey()));
	const edition = $derived(buildEdition(cards, issueKey));

	// Reading order for the flip-through reader: the lead first, then each section
	// in the order it prints (matches markIssueRead's ordering).
	const reading = $derived(
		[edition.lead, ...edition.sections.flatMap((s) => s.cards)].filter(Boolean) as Card[]
	);
	let flipStart = $state<number | null>(null);

	// Plain left-click flips through the edition; modified clicks fall through to
	// the href so the full reader still opens in a new tab.
	function openFlip(e: MouseEvent, card: Card | undefined) {
		if (!card || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		flipStart = reading.findIndex((c) => c.id === card.id);
	}

	const dateLabel = $derived(
		new Intl.DateTimeFormat(undefined, {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		}).format(parseDateKey(issueKey))
	);
	const atToday = $derived(issueKey >= todayKey());

	// Folio numerals, derived deterministically from the issue date so a given day
	// always prints the same volume and number, like a real paper of record.
	const issueDate = $derived(parseDateKey(issueKey));
	const volume = $derived(toRoman(issueDate.getFullYear() - 2024));
	const issueNo = $derived(dayOfYear(issueDate));
	const editionLabel = $derived(editionName(issueDate));
	const weekdayLabel = $derived(
		new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(issueDate)
	);

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
			// Edition items are RSS entries; markRead flips MiniFlux read state so the
			// edition actually empties (setReadingProgress alone never did).
			void sync.enqueue({ type: 'markRead', id: c.id, read: true });
			queued = true;
		}
		if (queued) void sync.flush();
	}

	// Subtle per-story dismissal: flips one RSS entry's read state so it drops out
	// of the edition (buildEdition only prints unread items).
	function markStoryRead(card: Card) {
		const sync = getSync();
		void sync.enqueue({ type: 'markRead', id: card.id, read: true }).then(() => sync.flush());
	}

	function dek(card: Card): string {
		const parts: string[] = [];
		if (card.author) parts.push(card.author);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min read`);
		return parts.join(' · ');
	}

	// Roman numerals for the masthead volume — small and pure.
	function toRoman(n: number): string {
		const table: [number, string][] = [
			[1000, 'M'],
			[900, 'CM'],
			[500, 'D'],
			[400, 'CD'],
			[100, 'C'],
			[90, 'XC'],
			[50, 'L'],
			[40, 'XL'],
			[10, 'X'],
			[9, 'IX'],
			[5, 'V'],
			[4, 'IV'],
			[1, 'I']
		];
		let out = '';
		let rem = n;
		for (const [value, sym] of table) {
			while (rem >= value) {
				out += sym;
				rem -= value;
			}
		}
		return out || 'I';
	}

	// 1-based day of the year — a stable per-date issue counter.
	function dayOfYear(d: Date): number {
		const start = Date.UTC(d.getFullYear(), 0, 1);
		const here = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
		return Math.round((here - start) / 86400000) + 1;
	}

	// A touch of flavour: weekends get their own edition name.
	function editionName(d: Date): string {
		const wd = d.getDay();
		return wd === 0 || wd === 6 ? 'Weekend Edition' : 'Late Edition';
	}

	onMount(() => {
		void getSync().pull();
	});
</script>

<section class="paper">
	<header class="masthead">
		<h1 class="nameplate">The Daily Lectern</h1>

		<div class="folio">
			<span class="folio-left">{editionLabel} · {weekdayLabel}</span>
			<span class="folio-motto">“All the feeds fit to read”</span>
			<span class="folio-right">Vol. {volume} · No. {issueNo}</span>
		</div>

		<div class="controls">
			<p class="count">
				{#if edition.total > 0}
					{edition.total}
					{edition.total === 1 ? 'story' : 'stories'} · {edition.sections.length +
						(edition.lead ? 1 : 0)}
					{edition.sections.length + (edition.lead ? 1 : 0) === 1 ? 'section' : 'sections'}
				{:else}
					No edition
				{/if}
			</p>
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
			{#if edition.total > 0}
				<div class="tools">
					<button type="button" class="ghost" onclick={() => (flipStart = 0)}>
						<Icon name="book" size={15} /> Read edition
					</button>
					<button type="button" class="ghost" onclick={markIssueRead}>
						<Icon name="check" size={15} /> Mark issue read
					</button>
				</div>
			{:else}
				<span class="tools-spacer" aria-hidden="true"></span>
			{/if}
		</div>
	</header>

	{#if edition.total === 0}
		<div class="empty">
			<span class="empty-mark"><Icon name="newspaper" size={28} /></span>
			<p>Nothing was filed for {dateLabel}.</p>
			<button type="button" class="link" onclick={jumpLatest}>Jump to the latest edition</button>
		</div>
	{:else}
		{#if edition.lead}
			<div class="lead-wrap">
				<a
					class="lead"
					href={resolve('/read/[id]', { id: edition.lead.id })}
					onclick={(e) => openFlip(e, edition.lead)}
				>
					<span class="section-tag">{edition.lead.siteName ?? 'Front page'}</span>
					<h2>{edition.lead.title}</h2>
					{#if edition.lead.note}<p class="standfirst">{edition.lead.note}</p>{/if}
					<p class="byline">{dek(edition.lead)}</p>
				</a>
				<button
					type="button"
					class="mark"
					title="Mark as read"
					aria-label="Mark as read"
					onclick={() => markStoryRead(edition.lead!)}
				>
					<Icon name="check" size={15} />
				</button>
			</div>
		{/if}

		<div class="sections">
			{#each edition.sections as section (section.name)}
				<section class="col">
					<h3 class="section-head">
						<SourceAvatar url={section.cards[0]?.url ?? ''} siteName={section.name} size={18} />
						<span class="name">{section.name}</span>
						<span class="ct">{section.cards.length}</span>
					</h3>
					<ul>
						{#each section.cards as card, i (card.id)}
							<li class:sublead={i === 0}>
								<a href={resolve('/read/[id]', { id: card.id })} onclick={(e) => openFlip(e, card)}>
									<span class="hl">{card.title}</span>
									{#if i === 0 && card.note}<span class="deck">{card.note}</span>{/if}
									{#if dek(card)}<span class="meta">{dek(card)}</span>{/if}
								</a>
								<button
									type="button"
									class="mark"
									title="Mark as read"
									aria-label="Mark as read"
									onclick={() => markStoryRead(card)}
								>
									<Icon name="check" size={14} />
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</section>

{#if flipStart !== null}
	<FlipReader
		cards={reading}
		start={flipStart}
		kind="newspaper"
		label={`The Daily Lectern · ${dateLabel}`}
		onclose={() => (flipStart = null)}
	/>
{/if}

<style>
	.paper {
		max-width: 70rem;
		margin: 0 auto;
	}

	/* Masthead — a hairline over the nameplate, a heavy double rule under it, then
	   the folio line and the reader's date controls. */
	.masthead {
		margin-bottom: 1.8rem;
	}
	.nameplate {
		font-family: var(--font-serif);
		font-size: clamp(2.2rem, 9vw, 4.5rem);
		font-weight: 900;
		font-stretch: condensed;
		letter-spacing: -0.02em;
		line-height: 0.95;
		text-align: center;
		color: var(--text);
		margin: 0;
		padding: 0.45rem 0 0.55rem;
		border-top: 1px solid var(--border-strong);
		border-bottom: 4px double var(--text);
	}

	/* Folio — edition (left), motto (centre), volume/number (right). */
	.folio {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: baseline;
		gap: 0.4rem 1.2rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-strong);
	}
	.folio-left,
	.folio-right {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.folio-left {
		justify-self: start;
	}
	.folio-right {
		justify-self: end;
		text-align: right;
	}
	.folio-motto {
		justify-self: center;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: var(--text-base);
		color: var(--text);
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.7rem 1rem;
		margin-top: 0.9rem;
	}
	.count {
		justify-self: start;
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.dateline {
		justify-self: center;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
	}
	.date {
		font-family: var(--font-serif);
		font-size: var(--text-base);
		font-style: italic;
		color: var(--text-muted);
		text-align: center;
		min-width: 14rem;
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
	.tools {
		justify-self: end;
	}
	.tools-spacer {
		display: block;
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
		font-family: var(--font-ui);
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

	/* Per-story "mark as read": a subtle check that surfaces on hover/touch. */
	.lead-wrap {
		position: relative;
	}
	.col li {
		position: relative;
	}
	.mark {
		position: absolute;
		top: 0.4rem;
		right: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.lead-wrap .mark {
		top: 0;
		right: 0;
	}
	.lead-wrap:hover .mark,
	.col li:hover .mark {
		opacity: 0.55;
	}
	.mark:hover {
		opacity: 1 !important;
		background: var(--accent-soft);
		color: var(--accent);
	}
	@media (hover: none) {
		.mark {
			opacity: 0.5;
		}
	}
	/* Lead story — the front-page splash, centred above a parting rule. */
	.lead {
		display: block;
		max-width: 48rem;
		margin: 1.8rem auto;
		padding-bottom: 1.7rem;
		border-bottom: 3px double var(--border-strong);
		text-align: center;
	}
	.section-tag {
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent);
		font-weight: 700;
	}
	.lead h2 {
		font-family: var(--font-serif);
		font-size: clamp(1.9rem, 5vw, 3.4rem);
		font-weight: 800;
		line-height: 1.04;
		letter-spacing: -0.02em;
		text-wrap: balance;
		margin: 0.5rem 0 0;
		color: var(--text);
		transition: color var(--dur-fast) var(--ease);
	}
	.lead:hover h2 {
		color: var(--accent);
	}
	.standfirst {
		font-family: var(--font-serif);
		font-size: var(--text-md);
		line-height: 1.45;
		color: var(--text-muted);
		margin: 0.7rem auto 0;
		max-width: 36rem;
		hyphens: auto;
	}
	.byline {
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0.7rem 0 0;
	}

	/* Sections — ruled newspaper columns that reflow with the viewport. */
	.sections {
		columns: 3 15rem;
		column-gap: 2.4rem;
		column-rule: 1px solid var(--border-strong);
	}
	.col {
		break-inside: avoid;
		margin-bottom: 1.8rem;
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.7rem;
		padding-bottom: 0.35rem;
		border-bottom: 2px solid var(--text);
	}
	.section-head .name {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
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
		padding: 0.6rem 1.6rem 0.6rem 0;
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
		line-height: 1.28;
		color: var(--text);
		text-wrap: pretty;
		transition: color var(--dur-fast) var(--ease);
	}
	.sublead .hl {
		font-size: var(--text-lg);
		font-weight: 700;
		line-height: 1.16;
	}
	.col a:hover .hl {
		color: var(--accent);
	}
	.deck {
		display: block;
		margin-top: 0.35rem;
		font-family: var(--font-serif);
		font-size: var(--text-sm);
		line-height: 1.42;
		color: var(--text-muted);
		text-align: justify;
		hyphens: auto;
	}
	.meta {
		display: block;
		margin-top: 0.25rem;
		font-family: var(--font-ui);
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

	@media (max-width: 820px) {
		.sections {
			columns: 1;
			column-rule: 0;
		}
		.folio,
		.controls {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
			gap: 0.6rem;
		}
		.folio-left,
		.folio-right,
		.count,
		.dateline,
		.tools {
			justify-self: center;
		}
		.folio-right {
			text-align: center;
		}
		.tools-spacer {
			display: none;
		}
	}
</style>
