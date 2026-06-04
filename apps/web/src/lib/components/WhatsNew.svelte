<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { APP_VERSION } from '$lib/version';
	import { releases, releaseVersion, KIND_LABEL, type Release } from '$lib/changelog';

	const SEEN_KEY = 'lectern.whatsnew.seen';
	const FIRST_RUN_LIMIT = 5;

	let open = $state(false);
	let items = $state<Release[]>([]);

	function dismiss() {
		open = false;
		try {
			// Record the newest known release so the overlay only returns after the
			// next version that adds entries to the changelog.
			if (releases[0]) localStorage.setItem(SEEN_KEY, releases[0].version);
		} catch {
			/* private mode / storage disabled — just close */
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') dismiss();
	}

	onMount(() => {
		let seen: string | null = null;
		try {
			seen = localStorage.getItem(SEEN_KEY);
		} catch {
			return;
		}
		// Releases are newest-first: everything before the last-seen version is new.
		// On a first run (nothing seen) show the most recent handful once.
		const seenIdx = seen ? releases.findIndex((r) => r.version === seen) : -1;
		const fresh = seenIdx >= 0 ? releases.slice(0, seenIdx) : releases.slice(0, FIRST_RUN_LIMIT);
		if (fresh.length === 0) return;
		items = fresh;
		open = true;
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#if open}
	<div class="scrim" role="presentation" onclick={dismiss}></div>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="What’s new">
		<header>
			<div>
				<h2>What’s new</h2>
				<p class="run">You’re on <code>{releaseVersion(APP_VERSION)}</code></p>
			</div>
			<button type="button" class="x" onclick={dismiss} aria-label="Close">×</button>
		</header>

		<div class="scroll">
			{#each items as r (r.version)}
				<section class="rel">
					<div class="rel-head">
						<span class="ver">{r.version}</span>
						<span class="rel-title">{r.title}</span>
					</div>
					<ul>
						{#each r.changes as c (c.text)}
							<li>
								<span class="tag {c.kind}">{KIND_LABEL[c.kind]}</span>
								<span>{c.text}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>

		<footer>
			<a href={resolve('/changelog')} onclick={dismiss}>Full changelog →</a>
			<button type="button" class="ok" onclick={dismiss}>Got it</button>
		</footer>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(2px);
		border: 0;
	}
	.sheet {
		position: fixed;
		z-index: 71;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(34rem, calc(100vw - 2rem));
		max-height: min(80vh, 44rem);
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.2rem 0.8rem;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		margin: 0;
	}
	.run {
		margin: 0.2rem 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.run code {
		font-family: var(--font-mono);
	}
	.x {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-muted);
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
	}
	.x:hover {
		background: var(--surface-alt);
		color: var(--text);
	}

	.scroll {
		overflow-y: auto;
		padding: 0.4rem 1.2rem;
	}
	.rel {
		padding: 0.9rem 0;
		border-bottom: 1px solid var(--border);
	}
	.rel:last-child {
		border-bottom: 0;
	}
	.rel-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-bottom: 0.55rem;
	}
	.ver {
		font-family: var(--font-serif);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.rel-title {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	li {
		display: grid;
		grid-template-columns: 4.6rem 1fr;
		gap: 0.6rem;
		align-items: baseline;
		font-size: var(--text-sm);
		line-height: 1.45;
	}
	.tag {
		justify-self: start;
		font-size: var(--text-2xs);
		font-weight: 600;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
		white-space: nowrap;
	}
	.tag.added {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.tag.improved {
		background: color-mix(in srgb, var(--ok) 18%, transparent);
		color: var(--ok);
	}
	.tag.fixed {
		background: var(--surface-alt);
		color: var(--text-muted);
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 1.2rem;
		border-top: 1px solid var(--border);
	}
	footer a {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	footer a:hover {
		color: var(--accent);
	}
	.ok {
		padding: 0.45rem 1rem;
		border: 0;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--accent-contrast);
		font-weight: 600;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.ok:hover {
		background: color-mix(in srgb, var(--accent) 88%, black);
	}
</style>
