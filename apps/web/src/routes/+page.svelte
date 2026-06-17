<script lang="ts">
	import { FINISHED_THRESHOLD, type Card } from '@lectern/shared';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { liveCards } from '$lib/live.svelte';
	import { buildEdition, latestIssueKey, yesterdayKey } from '$lib/newspaper';
	import Icon from '$lib/components/Icon.svelte';

	// A calm reading-room landing: where did I leave off, what's waiting to be
	// triaged, and what's in today's edition. Derived entirely from the offline
	// mirror so it works without a backend; no network, no algorithmic feed.
	const all = liveCards(() => db.cards.toArray());
	const cards = $derived((all.value ?? []) as Card[]);

	const now = new Date();
	const dateline = new Intl.DateTimeFormat(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	}).format(now);
	const greeting =
		now.getHours() < 5
			? 'Good evening'
			: now.getHours() < 12
				? 'Good morning'
				: now.getHours() < 18
					? 'Good afternoon'
					: 'Good evening';

	// Pick up where you left off: saved (non-feed) items part-way through, most
	// recently touched first. Capped so the page stays a quiet column.
	const continueReading = $derived(
		cards
			.filter(
				(c) =>
					c.location !== 'feed' && c.readingProgress > 0 && c.readingProgress < FINISHED_THRESHOLD
			)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, 4)
	);

	const inboxCount = $derived(cards.filter((c) => c.location === 'inbox').length);
	const edition = $derived(buildEdition(cards, latestIssueKey(cards, yesterdayKey())));

	function pct(p: number): number {
		return Math.round(p * 100);
	}
	function dek(c: Card): string {
		return c.siteName ?? c.author ?? 'Saved';
	}
</script>

<section class="home page">
	<header class="masthead">
		<p class="dateline">{dateline}</p>
		<h1>{greeting}.</h1>
	</header>

	{#if continueReading.length}
		<section class="block">
			<h2>Continue reading</h2>
			<ul class="resume">
				{#each continueReading as card (card.id)}
					<li>
						<a href={resolve('/read/[id]', { id: card.id })}>
							<span class="r-title">{card.title || dek(card)}</span>
							<span class="r-meta">{dek(card)} · {pct(card.readingProgress)}% read</span>
							<span class="r-bar" style="--p: {pct(card.readingProgress)}%"></span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="block">
		<h2>Jump in</h2>
		<ul class="dests">
			<li>
				<a href={resolve('/inbox')}>
					<span class="d-icon"><Icon name="inbox" /></span>
					<span class="d-text">
						<span class="d-title">Triage your inbox</span>
						<span class="d-sub"
							>{inboxCount ? `${inboxCount} to sort` : 'Inbox zero — all clear'}</span
						>
					</span>
					{#if inboxCount}<span class="d-count">{inboxCount}</span>{/if}
				</a>
			</li>
			<li>
				<a href={resolve('/newspaper')}>
					<span class="d-icon"><Icon name="newspaper" /></span>
					<span class="d-text">
						<span class="d-title">Today's edition</span>
						<span class="d-sub">
							{edition.total
								? `${edition.total} ${edition.total === 1 ? 'story' : 'stories'}`
								: 'No new stories'}
						</span>
					</span>
					{#if edition.total}<span class="d-count">{edition.total}</span>{/if}
				</a>
			</li>
		</ul>
	</section>
</section>

<style>
	.home {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.masthead {
		padding-bottom: var(--space-2);
	}
	.dateline {
		margin: 0 0 0.2rem;
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.masthead h1 {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.block h2 {
		margin: 0 0 0.2rem;
		font-size: var(--text-md);
		font-weight: 650;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* Continue reading: hairline-divided rows with a thin progress rule. */
	.resume li {
		border-top: 1px solid var(--border);
	}
	.resume li:last-child {
		border-bottom: 1px solid var(--border);
	}
	.resume a {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.5rem 0.8rem;
		border-radius: var(--radius);
		color: var(--text);
		transition: background var(--dur-fast) var(--ease);
	}
	.resume a:hover {
		background: var(--surface-alt);
	}
	.r-title {
		font-size: var(--text-base);
		font-weight: 600;
		line-height: 1.3;
	}
	.r-meta {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.r-bar {
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		bottom: 0.35rem;
		height: 2px;
		border-radius: var(--radius-full);
		background: var(--border-strong);
	}
	.r-bar::after {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--p);
		border-radius: inherit;
		background: var(--accent);
	}

	/* Destinations: quiet navigational rows, never metric tiles. */
	.dests li {
		border-top: 1px solid var(--border);
	}
	.dests li:last-child {
		border-bottom: 1px solid var(--border);
	}
	.dests a {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 0.5rem;
		border-radius: var(--radius);
		color: var(--text);
		transition: background var(--dur-fast) var(--ease);
	}
	.dests a:hover {
		background: var(--surface-alt);
	}
	.d-icon {
		display: inline-flex;
		color: var(--text-muted);
	}
	.d-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.d-title {
		font-size: var(--text-base);
		font-weight: 600;
		line-height: 1.2;
	}
	.d-sub {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.d-count {
		margin-left: auto;
		flex-shrink: 0;
		font-size: var(--text-2xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: var(--radius-full);
		padding: 0.1rem 0.45rem;
	}
</style>
