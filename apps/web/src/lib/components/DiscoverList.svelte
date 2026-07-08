<script lang="ts">
	/**
	 * The Discover candidate list. Adapts CardList's magazine-index row (cover
	 * thumb, serif title, byline) for discovered articles, which are NOT library
	 * documents — the title links out to the original in a new tab rather than to
	 * the reader. Each row carries a relevance score, its source fetcher, and three
	 * actions: upvote (signal only, keeps the row), downvote (dismisses it), and
	 * Save (pulls it into Readeck). This component is presentational: it renders the
	 * `candidates` it's given and reports intent through callbacks, so the page can
	 * own the optimistic list via the pure reducer in `$lib/discover`.
	 */
	import type { DiscoveryCandidate, VoteValue } from '@lectern/shared';
	import { SvelteSet } from 'svelte/reactivity';
	import Icon from './Icon.svelte';
	import SourceAvatar from './SourceAvatar.svelte';

	let {
		candidates,
		busyIds,
		onvote,
		onsave
	}: {
		candidates: DiscoveryCandidate[];
		/** Ids with an action in flight, to disable their buttons. */
		busyIds?: ReadonlySet<string>;
		onvote?: (id: string, value: VoteValue) => void;
		onsave?: (id: string) => void;
	} = $props();

	const FETCHER_LABEL: Record<string, string> = {
		searxng: 'SearXNG',
		brave: 'Brave',
		crawl: 'Crawl'
	};

	function hostname(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	/** Byline: author · publication (de-duplicated), like CardList. */
	function meta(c: DiscoveryCandidate): string {
		const pub = c.siteName ?? hostname(c.url);
		const parts: string[] = [];
		if (c.author) parts.push(c.author);
		if (pub && pub !== c.author) parts.push(pub);
		return parts.join('  ·  ');
	}

	// Cover thumbnails fall back to text-only rows when absent or on load error,
	// mirroring CardList: images earn visual weight, they're not a forced rail.
	let failedCovers = new SvelteSet<string>();
	const hasCover = (c: DiscoveryCandidate) => !!c.imageUrl && !failedCovers.has(c.id);

	const isBusy = (id: string) => busyIds?.has(id) ?? false;
</script>

<ul class="cards">
	{#each candidates as c (c.id)}
		<li class="row">
			<article class="card" class:saved={c.status === 'saved'}>
				{#if hasCover(c)}
					<span class="media">
						<img
							class="cover"
							src={c.imageUrl}
							alt=""
							loading="lazy"
							onerror={() => failedCovers.add(c.id)}
						/>
					</span>
				{/if}

				<div class="body">
					<!-- Discovered items live off-site; the title opens the original. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a class="title" href={c.url} target="_blank" rel="noreferrer noopener">
						{c.title || hostname(c.url)}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{#if c.excerpt}<p class="snippet">{c.excerpt}</p>{/if}
					<p class="meta">
						<SourceAvatar url={c.url} siteName={c.siteName} size={16} />
						<span class="byline">{meta(c)}</span>
						<span class="badges">
							<span class="score" title="Relevance to your interests"
								>{Math.round(c.score * 100)}%</span
							>
							<span class="source">{FETCHER_LABEL[c.fetcher] ?? c.fetcher}</span>
							{#if c.status === 'saved'}<span class="saved-badge">Saved</span>{/if}
						</span>
					</p>
				</div>

				<div class="trail">
					<button
						type="button"
						class="round"
						class:on={c.vote === 'up'}
						title="More like this"
						aria-label="More like this"
						aria-pressed={c.vote === 'up'}
						disabled={isBusy(c.id)}
						onclick={() => onvote?.(c.id, 'up')}
					>
						<span class="glyph">▲</span>
					</button>
					<button
						type="button"
						class="round"
						title="Not interested"
						aria-label="Not interested"
						disabled={isBusy(c.id)}
						onclick={() => onvote?.(c.id, 'down')}
					>
						<span class="glyph">▼</span>
					</button>
					<button
						type="button"
						class="round save"
						title="Save to library"
						aria-label="Save to library"
						disabled={isBusy(c.id) || c.status === 'saved'}
						onclick={() => onsave?.(c.id)}
					>
						<Icon name="bookmark" size={16} />
					</button>
				</div>
			</article>
		</li>
	{/each}
</ul>

<style>
	/* Adapted from CardList: a flat magazine-index list at rest, each row over a
	   hairline rule with an inset hover plane. */
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		border-bottom: 1px solid var(--border);
	}
	.row:last-child {
		border-bottom: 0;
	}
	.card {
		position: relative;
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		padding: 0.95rem 0.55rem 1.05rem 0.7rem;
		border-radius: var(--radius-lg);
		transition:
			background var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}
	.card:hover {
		background: color-mix(in srgb, var(--surface-alt) 55%, transparent);
		box-shadow: var(--shadow-sm);
	}
	.card.saved {
		opacity: 0.6;
	}

	.media {
		flex-shrink: 0;
	}
	.cover {
		width: 58px;
		height: 58px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface-alt);
		object-fit: cover;
		display: block;
	}

	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		display: block;
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 600;
		line-height: 1.25;
		color: var(--text);
		letter-spacing: -0.005em;
		transition: color var(--dur-fast) var(--ease);
	}
	.card:hover .title {
		color: var(--accent);
	}
	.snippet {
		margin: 0.3rem 0 0;
		font-size: var(--text-base);
		line-height: 1.5;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.byline {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.badges {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}
	/* The score reads as a confident accent pill; the fetcher is a quieter neutral
	   tag, matching the settings "derivation" badge convention. */
	.score {
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		background: var(--accent-soft);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.source {
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-muted);
		background: var(--surface-alt);
		border: 1px solid var(--border);
	}
	.saved-badge {
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--ok) 40%, transparent);
	}

	.trail {
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
	}
	.round {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		font-size: var(--text-sm);
		line-height: 1;
		transition:
			border-color var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.round:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.round.on {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.round:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.glyph {
		font-size: 0.7rem;
		line-height: 1;
	}

	@media (hover: none) {
		.round {
			min-width: 2.5rem;
			min-height: 2.5rem;
		}
	}
	@media (max-width: 640px) {
		.card {
			gap: 0.7rem;
			padding: 0.75rem 0.4rem 0.8rem 0.55rem;
		}
		.title {
			font-size: var(--text-md);
		}
		.cover {
			width: 48px;
			height: 48px;
		}
	}
</style>
