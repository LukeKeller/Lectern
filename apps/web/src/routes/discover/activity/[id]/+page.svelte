<script lang="ts">
	/**
	 * Discovery run detail: the forensic view of a single run. Unlike the Activity
	 * page (which polls live state), this loads one run WITH its full `trace` once
	 * and renders what each searcher/crawler did and how every candidate scored.
	 * Runs are worker-side state, not library documents, so this reads the client
	 * directly into local `$state`.
	 */
	import type { DiscoveryRun } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import Icon from '$lib/components/Icon.svelte';

	const id = $derived(page.params.id ?? '');

	let run = $state<DiscoveryRun | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state<string | undefined>(undefined);

	onMount(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = undefined;
		notFound = false;
		try {
			const res = await getClient().getDiscoveryRun(id);
			if (res.run) {
				run = res.run;
			} else {
				notFound = true;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load this run.';
		} finally {
			loading = false;
		}
	}

	const STAT_LABELS: {
		key: 'fetched' | 'deduped' | 'scored' | 'extracted' | 'inserted';
		label: string;
	}[] = [
		{ key: 'fetched', label: 'Fetched' },
		{ key: 'deduped', label: 'Deduped' },
		{ key: 'scored', label: 'Scored' },
		{ key: 'extracted', label: 'Extracted' },
		{ key: 'inserted', label: 'Inserted' }
	];

	function statusLabel(s: DiscoveryRun['status']): string {
		return s === 'running' ? 'Running' : s === 'succeeded' ? 'Succeeded' : 'Failed';
	}

	function stamp(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		const now = new Date();
		const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		if (d.toDateString() === now.toDateString()) return time;
		return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
	}

	function duration(r: DiscoveryRun): string {
		const start = Date.parse(r.startedAt);
		const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.parse(r.updatedAt);
		if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
		const secs = Math.round((end - start) / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		return `${mins}m ${secs % 60}s`;
	}

	function ms(v: number | null): string {
		if (v == null) return '—';
		if (v < 1000) return `${Math.round(v)}ms`;
		return `${(v / 1000).toFixed(1)}s`;
	}

	/** Score to 3 decimals; keep null readable. */
	function num3(v: number | null): string {
		return v == null ? '—' : v.toFixed(3);
	}

	const CRAWL_SUMMARY = [
		{ key: 'depthReached', label: 'Depth reached' },
		{ key: 'pagesFetched', label: 'Pages fetched' },
		{ key: 'pagesSkipped', label: 'Pages skipped' },
		{ key: 'linksEnqueued', label: 'Links enqueued' },
		{ key: 'emitted', label: 'Emitted' }
	] as const;

	const EXTRACT_LABELS: Record<string, string> = {
		ok: 'Full text',
		failed: 'Extract failed',
		skipped: 'Snippet only'
	};
</script>

<div class="page">
	<header class="head">
		<div>
			<a class="back" href={resolve('/discover/activity')}
				><Icon name="back" size={16} /> Activity</a
			>
			<h1>Run detail</h1>
		</div>
		<button type="button" class="btn ghost" onclick={load}>
			<Icon name="refresh" size={16} /> Refresh
		</button>
	</header>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if loading}
		<div class="card skeleton">
			<span class="sk-line sk-title"></span><span class="sk-line"></span><span class="sk-line"></span>
		</div>
	{:else if notFound}
		<div class="empty">
			<span class="empty-mark"><Icon name="compass" size={24} /></span>
			<p class="empty-title">Run not found</p>
			<p class="empty-hint">
				It may have expired. Back to <a class="link" href={resolve('/discover/activity')}>Activity</a>.
			</p>
		</div>
	{:else if run}
		<section class="current card" class:running={run.status === 'running'}>
			<div class="current-head">
				<span class="status" data-status={run.status}>
					{#if run.status === 'running'}<span class="spinner" aria-hidden="true"></span>{/if}
					{statusLabel(run.status)}
				</span>
				<span class="trigger">{run.trigger === 'cron' ? 'Scheduled' : 'Manual'}</span>
				<span class="when">{stamp(run.startedAt)} · {duration(run)}</span>
			</div>

			<p class="runid" title={run.id}>{run.id}</p>
			<p class="stage">{run.stage}</p>
			{#if run.error}<p class="err">{run.error}</p>{/if}

			<dl class="stats">
				{#each STAT_LABELS as s (s.key)}
					<div>
						<dt>{s.label}</dt>
						<dd>{run.stats[s.key]}</dd>
					</div>
				{/each}
			</dl>
		</section>

		{#if !run.trace}
			<p class="hint no-trace">No detailed trace for this run.</p>
		{:else}
			{@const trace = run.trace}
			<!-- Queries + profile -->
			<h2 class="section">Queries</h2>
			<div class="card">
				{#if trace.queries.length}
					<div class="chips">
						{#each trace.queries as q, i (i)}
							<span class="chip">{q}</span>
						{/each}
					</div>
				{:else}
					<p class="hint">No queries recorded.</p>
				{/if}

				{#if trace.profileTerms.length}
					<div class="terms">
						<span class="sub-label">Top profile terms</span>
						<ul>
							{#each trace.profileTerms as t (t.term)}
								<li>
									<span class="term-name">{t.term}</span>
									<span class="term-weight">{t.weight.toFixed(3)}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<!-- Sources -->
			<h2 class="section">Sources</h2>
			{#if trace.fetchers.length}
				<div class="fetchers">
					{#each trace.fetchers as f (f.name)}
						<div class="card fetcher" class:disabled={!f.enabled}>
							<div class="fetcher-head">
								<span class="fname">{f.name}</span>
								{#if !f.enabled}
									<span class="badge muted">Disabled</span>
								{:else if f.ok}
									<span class="badge ok">OK</span>
								{:else}
									<span class="badge fail">Error</span>
								{/if}
								<span class="fmeta">{f.count} results · {ms(f.durationMs)}</span>
							</div>
							{#if f.error}<p class="err small">{f.error}</p>{/if}
							{#if f.results.length}
								<ul class="results scroll">
									{#each f.results as r, i (i)}
										<li>
											<a class="rtitle" href={r.url} target="_blank" rel="noopener noreferrer">
												{r.title || r.url}
												<Icon name="external" size={12} />
											</a>
											<span class="rurl">{r.url}</span>
										</li>
									{/each}
								</ul>
							{:else if f.enabled}
								<p class="hint small">No results returned.</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="hint">No source diagnostics.</p>
			{/if}

			<!-- Crawler -->
			{#if trace.crawl}
				{@const crawl = trace.crawl}
				<h2 class="section">Crawler</h2>
				<div class="card">
					<div class="crawl-summary">
						<div class="cs-item">
							<span class="cs-label">Stop reason</span>
							<span class="cs-val">{crawl.stopReason}</span>
						</div>
						{#each CRAWL_SUMMARY as c (c.key)}
							<div class="cs-item">
								<span class="cs-label">{c.label}</span>
								<span class="cs-val">{crawl[c.key]}</span>
							</div>
						{/each}
					</div>

					{#if crawl.seeds.length}
						<div class="terms">
							<span class="sub-label">Seeds</span>
							<div class="chips">
								{#each crawl.seeds as s, i (i)}
									<span class="chip">{s}</span>
								{/each}
							</div>
						</div>
					{/if}

					{#if crawl.hosts.length}
						<div class="tbl-wrap scroll">
							<table class="tbl">
								<thead>
									<tr>
										<th>Host</th>
										<th class="r">Visited</th>
										<th>Robots</th>
										<th class="r">Blocked</th>
										<th>Cap</th>
									</tr>
								</thead>
								<tbody>
									{#each crawl.hosts as h (h.host)}
										<tr>
											<td class="host">{h.host}</td>
											<td class="r">{h.visited}</td>
											<td>
												<span
													class="badge"
													class:ok={h.robots === 'allow-all'}
													class:warn={h.robots === 'restricted'}
													class:fail={h.robots === 'unreachable'}>{h.robots}</span
												>
											</td>
											<td class="r">{h.robotsBlocked}</td>
											<td>{h.capHit ? 'yes' : '—'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					{#if crawl.rejections.length}
						<div class="terms">
							<span class="sub-label">Rejections ({crawl.rejections.length})</span>
							<ul class="rejections scroll">
								{#each crawl.rejections as rej, i (i)}
									<li>
										<span class="chip reason" data-reason={rej.reason}>{rej.reason}</span>
										<span class="rurl">{rej.url}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Scoring -->
			<h2 class="section">Scoring</h2>
			<div class="card">
				<p class="score-summary">
					<span><strong>{trace.dedupeDropped}</strong> dropped as duplicate URLs</span>
					{#if trace.mutedDropped.length}
						<span
							>· <strong>{trace.mutedDropped.length}</strong> dropped from muted hosts
							<span class="muted-list">({trace.mutedDropped.join(', ')})</span></span
						>
					{/if}
				</p>

				{#if trace.candidates.length}
					<div class="tbl-wrap scroll tall">
						<table class="tbl">
							<thead>
								<tr>
									<th class="r">#</th>
									<th>Title</th>
									<th>Source</th>
									<th class="r">Cosine</th>
									<th class="r">Recency</th>
									<th class="r">Final</th>
									<th>Extract</th>
									<th>Snippet → Full</th>
									<th>Matched</th>
								</tr>
							</thead>
							<tbody>
								{#each [...trace.candidates].sort((a, b) => a.rank - b.rank) as c (c.url)}
									<tr class:selected={c.selected}>
										<td class="r rank">
											{c.rank}{#if c.selected}<span class="dot" title="Inserted"></span>{/if}
										</td>
										<td class="ctitle">
											<a href={c.url} target="_blank" rel="noopener noreferrer"
												>{c.title || c.url}</a
											>
										</td>
										<td class="src">{c.fetcher}</td>
										<td class="r nums">{num3(c.cosine)}</td>
										<td class="r nums">{c.recency.toFixed(2)}</td>
										<td class="r nums strong">{num3(c.finalScore)}</td>
										<td>
											<span
												class="badge"
												class:ok={c.extracted === 'ok'}
												class:fail={c.extracted === 'failed'}
												class:muted={c.extracted === 'skipped'}
												>{EXTRACT_LABELS[c.extracted] ?? c.extracted}</span
											>
										</td>
										<td class="nums">
											{#if c.snippetCosine != null && c.fullTextCosine != null}
												{num3(c.snippetCosine)} → {num3(c.fullTextCosine)}
											{:else}
												—
											{/if}
										</td>
										<td class="matched">
											{#if c.matchedTerms.length}
												<span class="chips tight">
													{#each c.matchedTerms as m (m)}
														<span class="chip xs">{m}</span>
													{/each}
												</span>
											{:else}
												—
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="hint">No scored candidates.</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 1.4rem;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.back:hover {
		color: var(--accent);
	}
	h1 {
		font-size: var(--text-2xl);
		margin-top: 0.2rem;
	}
	.section {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 2rem 0 0.7rem;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.btn:hover {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.ghost {
		background: transparent;
		color: var(--text-muted);
	}

	.card {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		padding: 1.1rem 1.2rem;
	}
	.current.running {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}
	.current-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.7rem;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		font-weight: 600;
		border: 1px solid var(--border);
	}
	.status[data-status='running'] {
		color: var(--accent);
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.status[data-status='succeeded'] {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		border-color: color-mix(in srgb, var(--ok) 40%, transparent);
	}
	.status[data-status='failed'] {
		color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
	}
	.spinner {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-top-color: var(--accent);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
	.trigger {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.when {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.runid {
		margin: 0.8rem 0 0;
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
		color: var(--text-muted);
		word-break: break-all;
	}
	.stage {
		margin: 0.35rem 0 0;
		font-size: var(--text-base);
		color: var(--text);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem 2rem;
		margin: 1.1rem 0 0;
	}
	.stats > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.stats dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.stats dd {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	/* Chips + term lists */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chips.tight {
		gap: 0.25rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		font-size: var(--text-sm);
		color: var(--text);
	}
	.chip.xs {
		font-size: var(--text-2xs);
		padding: 0.1rem 0.45rem;
	}
	.sub-label {
		display: block;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin-bottom: 0.4rem;
	}
	.terms {
		margin-top: 1rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}
	.terms ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.terms li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		font-size: var(--text-sm);
	}
	.term-name {
		color: var(--text);
	}
	.term-weight {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* Badges */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		border: 1px solid var(--border);
		color: var(--text-muted);
		text-transform: capitalize;
	}
	.badge.ok {
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		border-color: color-mix(in srgb, var(--ok) 40%, transparent);
	}
	.badge.warn {
		color: var(--warning);
		background: color-mix(in srgb, var(--warning) 14%, transparent);
		border-color: color-mix(in srgb, var(--warning) 40%, transparent);
	}
	.badge.fail {
		color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
	}
	.badge.muted {
		color: var(--text-muted);
		background: var(--surface-alt);
	}

	/* Sources */
	.fetchers {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.fetcher.disabled {
		opacity: 0.6;
	}
	.fetcher-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.fname {
		font-weight: 600;
		text-transform: capitalize;
	}
	.fmeta {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.results {
		list-style: none;
		margin: 0.8rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.results li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.rtitle {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-sm);
		color: var(--text);
	}
	.rtitle:hover {
		color: var(--accent);
	}
	.rurl {
		font-size: var(--text-xs);
		color: var(--text-muted);
		word-break: break-all;
	}

	/* Crawler summary */
	.crawl-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem 1.8rem;
	}
	.cs-item {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.cs-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.cs-val {
		font-size: var(--text-lg);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-transform: capitalize;
	}

	/* Tables */
	.tbl-wrap {
		margin-top: 1rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.tbl-wrap.tall {
		max-height: 32rem;
	}
	.tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.tbl th,
	.tbl td {
		padding: 0.5rem 0.7rem;
		text-align: left;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}
	.tbl thead th {
		position: sticky;
		top: 0;
		background: var(--surface-alt);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		font-weight: 600;
		z-index: 1;
	}
	.tbl tbody tr:last-child td {
		border-bottom: 0;
	}
	.tbl .r {
		text-align: right;
	}
	.tbl .nums {
		font-variant-numeric: tabular-nums;
	}
	.tbl .nums.strong {
		font-weight: 600;
	}
	.tbl .host {
		font-family: var(--font-mono, monospace);
		font-size: var(--text-xs);
	}
	.tbl tr.selected {
		background: var(--accent-soft);
	}
	.rank {
		font-variant-numeric: tabular-nums;
		position: relative;
	}
	.dot {
		display: inline-block;
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 0.3rem;
		vertical-align: middle;
	}
	.ctitle {
		max-width: 22rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ctitle a {
		color: var(--text);
	}
	.ctitle a:hover {
		color: var(--accent);
	}
	.src {
		color: var(--text-muted);
		text-transform: capitalize;
	}
	.matched {
		white-space: normal;
		max-width: 16rem;
	}

	/* Rejections */
	.rejections {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.rejections li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.chip.reason {
		font-size: var(--text-2xs);
		padding: 0.1rem 0.45rem;
		text-transform: capitalize;
	}
	.chip.reason[data-reason='robots'],
	.chip.reason[data-reason='host-cap'] {
		color: var(--warning);
		border-color: color-mix(in srgb, var(--warning) 40%, transparent);
	}
	.chip.reason[data-reason='http-error'],
	.chip.reason[data-reason='fetch-error'] {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
	}

	.score-summary {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.score-summary strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.muted-list {
		color: var(--text-muted);
	}

	/* Scrollable regions */
	.scroll {
		max-height: 18rem;
		overflow: auto;
	}

	.err {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0.6rem 0 0;
	}
	.err.small {
		font-size: var(--text-xs);
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.hint.small {
		font-size: var(--text-xs);
		margin: 0.5rem 0 0;
	}
	.no-trace {
		margin-top: 1rem;
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.sk-line {
		height: 0.9rem;
		width: 55%;
		border-radius: var(--radius-sm);
		background: linear-gradient(
			90deg,
			var(--surface-alt) 25%,
			color-mix(in srgb, var(--surface-alt) 55%, transparent) 50%,
			var(--surface-alt) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.3s linear infinite;
	}
	.sk-title {
		height: 1.2rem;
		width: 40%;
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk-line {
			animation: none;
		}
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 4rem 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.empty-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
	}
	.empty-title {
		margin: 0.2rem 0 0;
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text);
	}
	.empty-hint {
		margin: 0;
		font-size: var(--text-base);
	}
	.link {
		color: var(--accent);
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
