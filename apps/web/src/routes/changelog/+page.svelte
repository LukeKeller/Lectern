<script lang="ts">
	import { APP_VERSION } from '$lib/version';
	import { releases, KIND_LABEL } from '$lib/changelog';
</script>

<div class="page changelog">
	<header class="intro">
		<h1>What’s new</h1>
		<p class="sub">
			Recent releases, newest first. You’re running <code>{APP_VERSION}</code>.
		</p>
	</header>

	<ol class="releases">
		{#each releases as r (r.version)}
			<li class="release">
				<div class="rail">
					<span class="ver">{r.version}</span>
					<time datetime={r.date}>
						{new Date(r.date).toLocaleDateString(undefined, {
							year: 'numeric',
							month: 'short',
							day: 'numeric'
						})}
					</time>
				</div>
				<div class="body">
					<h2>{r.title}</h2>
					<ul class="changes">
						{#each r.changes as c (c.text)}
							<li>
								<span class="tag {c.kind}">{KIND_LABEL[c.kind]}</span>
								<span class="text">{c.text}</span>
							</li>
						{/each}
					</ul>
				</div>
			</li>
		{/each}
	</ol>
</div>

<style>
	.changelog {
		max-width: 46rem;
	}
	.intro {
		margin-bottom: 2rem;
	}
	h1 {
		font-family: var(--font-serif);
		font-size: var(--text-2xl);
		margin: 0 0 0.4rem;
	}
	.sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
		margin: 0;
	}
	.sub code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--surface-alt);
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
	}

	.releases {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.release {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 1.5rem;
		padding: 1.4rem 0;
		border-top: 1px solid var(--border);
	}
	.rail {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		position: sticky;
		top: 1rem;
		align-self: start;
	}
	.ver {
		font-family: var(--font-serif);
		font-weight: 700;
		font-size: var(--text-lg);
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	time {
		font-size: var(--text-2xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.body h2 {
		font-family: var(--font-serif);
		font-size: var(--text-md);
		margin: 0 0 0.8rem;
	}
	.changes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.changes li {
		display: grid;
		grid-template-columns: 5rem 1fr;
		gap: 0.7rem;
		align-items: baseline;
	}
	.tag {
		justify-self: start;
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.03em;
		padding: 0.1rem 0.45rem;
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
	.text {
		color: var(--text);
		line-height: 1.5;
	}

	@media (max-width: 640px) {
		.release {
			grid-template-columns: 1fr;
			gap: 0.6rem;
		}
		.rail {
			position: static;
			flex-direction: row;
			align-items: baseline;
			gap: 0.6rem;
		}
		.changes li {
			grid-template-columns: 1fr;
			gap: 0.2rem;
		}
	}
</style>
