<script lang="ts">
	/**
	 * Discovery Activity: the live view of the current (or most-recent) run plus a
	 * short history. While a run is `running` we poll the latest-run endpoint every
	 * 2s and stop the moment it reaches a terminal state or the page unmounts. Runs
	 * are worker-side state, not library documents, so this reads the client
	 * directly into local `$state`.
	 */
	import type { DiscoveryRun } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getClient } from '$lib/config';
	import Icon from '$lib/components/Icon.svelte';

	let latest = $state<DiscoveryRun | null>(null);
	let runs = $state<DiscoveryRun[]>([]);
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);

	onMount(() => {
		void loadAll();
	});

	async function loadAll() {
		loading = true;
		error = undefined;
		try {
			const [latestRes, runsRes] = await Promise.all([
				getClient().getLatestDiscoveryRun(),
				getClient().listDiscoveryRuns(20)
			]);
			latest = latestRes.run;
			runs = runsRes.runs;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load discovery activity.';
		} finally {
			loading = false;
		}
	}

	async function refreshLatest() {
		try {
			const res = await getClient().getLatestDiscoveryRun();
			latest = res.run;
			// Keep the history in step so a finished run shows its final counters.
			if (res.run) {
				runs = runs.some((r) => r.id === res.run!.id)
					? runs.map((r) => (r.id === res.run!.id ? res.run! : r))
					: [res.run, ...runs];
			}
		} catch {
			/* transient: keep the last good snapshot and let the next tick retry */
		}
	}

	// Poll only while the latest run is active; the effect re-subscribes whenever
	// the status changes, so it tears the interval down on the terminal tick and
	// on unmount.
	$effect(() => {
		if (latest?.status !== 'running') return;
		const id = setInterval(() => void refreshLatest(), 2000);
		return () => clearInterval(id);
	});

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

	function duration(run: DiscoveryRun): string {
		const start = Date.parse(run.startedAt);
		const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.parse(run.updatedAt);
		if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
		const secs = Math.round((end - start) / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		return `${mins}m ${secs % 60}s`;
	}

	const perFetcherEntries = (run: DiscoveryRun) => Object.entries(run.stats.perFetcher);
</script>

<div class="page">
	<header class="head">
		<div>
			<a class="back" href={resolve('/discover')}><Icon name="back" size={16} /> Discover</a>
			<h1>Activity</h1>
		</div>
		<button type="button" class="btn ghost" onclick={loadAll}>
			<Icon name="refresh" size={16} /> Refresh
		</button>
	</header>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if loading}
		<div class="card skeleton">
			<span class="sk-line sk-title"></span><span class="sk-line"></span>
		</div>
	{:else if !latest}
		<div class="empty">
			<span class="empty-mark"><Icon name="compass" size={24} /></span>
			<p class="empty-title">No runs yet</p>
			<p class="empty-hint">
				Start one from <a class="link" href={resolve('/discover')}>Discover</a> with “Discover now”.
			</p>
		</div>
	{:else}
		<section class="current card" class:running={latest.status === 'running'}>
			<div class="current-head">
				<span class="status" data-status={latest.status}>
					{#if latest.status === 'running'}<span class="spinner" aria-hidden="true"></span>{/if}
					{statusLabel(latest.status)}
				</span>
				<span class="trigger">{latest.trigger === 'cron' ? 'Scheduled' : 'Manual'}</span>
				<span class="when">{stamp(latest.startedAt)} · {duration(latest)}</span>
				<a class="details" href={resolve('/discover/activity/[id]', { id: latest.id })}
					>View details</a
				>
			</div>

			<p class="stage">{latest.stage}</p>
			{#if latest.error}<p class="err">{latest.error}</p>{/if}

			<dl class="stats">
				{#each STAT_LABELS as s (s.key)}
					<div>
						<dt>{s.label}</dt>
						<dd>{latest.stats[s.key]}</dd>
					</div>
				{/each}
			</dl>

			{#if perFetcherEntries(latest).length}
				<div class="per-fetcher">
					<span class="pf-label">Per source</span>
					<ul>
						{#each perFetcherEntries(latest) as [name, count] (name)}
							<li><span class="pf-name">{name}</span><span class="pf-count">{count}</span></li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>

		<h2 class="section">Recent runs</h2>
		{#if runs.length === 0}
			<p class="hint">No history yet.</p>
		{:else}
			<ul class="history">
				{#each runs as run (run.id)}
					<li>
						<a class="hrow" href={resolve('/discover/activity/[id]', { id: run.id })}>
							<span class="status status-sm" data-status={run.status}>{statusLabel(run.status)}</span>
							<span class="htrigger">{run.trigger === 'cron' ? 'Scheduled' : 'Manual'}</span>
							<span class="hwhen">{stamp(run.startedAt)}</span>
							<span class="hdur">{duration(run)}</span>
							<span class="hinserted">+{run.stats.inserted}</span>
							{#if run.status === 'failed' && run.error}
								<span class="herror" title={run.error}>{run.error}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
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
	.details {
		font-size: var(--text-sm);
		color: var(--accent);
	}
	.details:hover {
		text-decoration: underline;
	}
	.stage {
		margin: 0.9rem 0 0;
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

	.per-fetcher {
		margin-top: 1.1rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}
	.pf-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.per-fetcher ul {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.per-fetcher li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		font-size: var(--text-sm);
	}
	.pf-name {
		color: var(--text-muted);
	}
	.pf-count {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.history {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hrow {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.65rem 0.3rem;
		border-bottom: 1px solid var(--border);
		font-size: var(--text-sm);
		color: var(--text);
		border-radius: var(--radius-sm);
		transition: background var(--dur-fast) var(--ease);
	}
	.hrow:hover {
		background: var(--surface-alt);
	}
	.history li:last-child .hrow {
		border-bottom: 0;
	}
	.status-sm {
		font-size: var(--text-2xs);
		padding: 0.1rem 0.5rem;
	}
	.htrigger {
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.hwhen {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.hdur {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}
	.hinserted {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}
	.herror {
		flex-basis: 100%;
		color: var(--error);
		font-size: var(--text-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.err {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0.6rem 0 0;
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
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
