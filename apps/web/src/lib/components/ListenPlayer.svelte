<script lang="ts">
	import Icon from './Icon.svelte';
	import { ttsPlayer } from '$lib/tts-player.svelte';

	let queueOpen = $state(false);

	function fmt(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	const playing = $derived(ttsPlayer.status === 'playing');
	const loading = $derived(ttsPlayer.status === 'loading');
</script>

{#if ttsPlayer.hasQueue || ttsPlayer.status === 'error'}
	<div class="player" class:expanded={queueOpen}>
		{#if queueOpen}
			<div class="queue">
				<div class="queue-head">
					<span>Up next · {ttsPlayer.queue.length}</span>
					<button type="button" class="text-btn" onclick={() => ttsPlayer.clear()}>Clear</button>
				</div>
				<ul>
					{#each ttsPlayer.queue as item, i (item.id)}
						<li class:current={i === ttsPlayer.index}>
							<button
								type="button"
								class="track"
								title="Play"
								onclick={() => ttsPlayer.playIndex(i)}
							>
								{#if i === ttsPlayer.index && playing}
									<Icon name="pause" size={14} />
								{:else}
									<Icon name="play" size={14} />
								{/if}
								<span class="track-title">{item.title || 'Untitled'}</span>
							</button>
							<div class="track-actions">
								<button
									type="button"
									aria-label="Move up"
									disabled={i === 0}
									onclick={() => ttsPlayer.move(i, i - 1)}
								>
									<Icon name="chevron" size={13} />
								</button>
								<button
									type="button"
									aria-label="Move down"
									disabled={i === ttsPlayer.queue.length - 1}
									onclick={() => ttsPlayer.move(i, i + 1)}
								>
									<Icon name="chevron" size={13} />
								</button>
								<button type="button" aria-label="Remove" onclick={() => ttsPlayer.remove(i)}>
									<Icon name="trash" size={14} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="bar">
			<div class="now">
				<Icon name="headphones" size={18} />
				<div class="now-text">
					<span class="now-title">{ttsPlayer.current?.title ?? 'Listen'}</span>
					{#if ttsPlayer.error}
						<span class="now-sub error">{ttsPlayer.error}</span>
					{:else}
						<span class="now-sub">{fmt(ttsPlayer.currentTime)} / {fmt(ttsPlayer.duration)}</span>
					{/if}
				</div>
			</div>

			<div class="controls">
				<button
					type="button"
					aria-label="Previous"
					disabled={ttsPlayer.index <= 0 && ttsPlayer.currentTime <= 3}
					onclick={() => ttsPlayer.prev()}
				>
					<Icon name="prev" size={18} />
				</button>
				<button
					type="button"
					class="play"
					aria-label={playing ? 'Pause' : 'Play'}
					disabled={loading}
					onclick={() => ttsPlayer.togglePlay()}
				>
					{#if loading}
						<span class="spinner"></span>
					{:else if playing}
						<Icon name="pause" size={20} />
					{:else}
						<Icon name="play" size={20} />
					{/if}
				</button>
				<button
					type="button"
					aria-label="Next"
					disabled={ttsPlayer.index >= ttsPlayer.queue.length - 1}
					onclick={() => ttsPlayer.next()}
				>
					<Icon name="next" size={18} />
				</button>
			</div>

			<input
				class="seek"
				type="range"
				min="0"
				max={ttsPlayer.duration || 0}
				step="1"
				value={ttsPlayer.currentTime}
				aria-label="Seek"
				disabled={!ttsPlayer.duration}
				oninput={(e) => ttsPlayer.seek(Number(e.currentTarget.value))}
			/>

			<button
				type="button"
				class="queue-toggle"
				class:active={queueOpen}
				aria-label="Queue"
				aria-expanded={queueOpen}
				onclick={() => (queueOpen = !queueOpen)}
			>
				<Icon name="list" size={18} />
				{#if ttsPlayer.queue.length > 1}<span class="badge">{ttsPlayer.queue.length}</span>{/if}
			</button>
			<button type="button" aria-label="Close player" onclick={() => ttsPlayer.clear()}>
				<Icon name="close" size={18} />
			</button>
		</div>
	</div>
{/if}

<style>
	.player {
		position: fixed;
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
		width: min(720px, calc(100% - 1.5rem));
		z-index: 60;
		background: var(--surface);
		border: 1px solid var(--border);
		border-bottom: 0;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: 0 -8px 30px rgb(0 0 0 / 0.16);
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
	}
	.now {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 1 1 12rem;
		color: var(--text-muted);
	}
	.now-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.now-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.now-sub {
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.now-sub.error {
		color: var(--danger, #d23);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.controls button,
	.queue-toggle,
	.bar > button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		position: relative;
	}
	.controls button:hover,
	.queue-toggle:hover,
	.bar > button:hover {
		background: var(--surface-alt);
	}
	.controls button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.play {
		width: 2.4rem !important;
		height: 2.4rem !important;
		background: var(--accent) !important;
		color: var(--accent-contrast, #fff) !important;
	}
	.play:disabled {
		opacity: 0.6;
	}
	.seek {
		flex: 2 1 8rem;
		accent-color: var(--accent);
		min-width: 4rem;
	}
	.queue-toggle.active {
		background: var(--surface-alt);
		color: var(--accent);
	}
	.badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 1rem;
		height: 1rem;
		padding: 0 0.2rem;
		border-radius: 0.5rem;
		background: var(--accent);
		color: var(--accent-contrast, #fff);
		font-size: 0.6rem;
		line-height: 1rem;
		text-align: center;
	}
	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.queue {
		max-height: 40vh;
		overflow-y: auto;
		border-bottom: 1px solid var(--border);
		padding: 0.5rem;
	}
	.queue-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.25rem 0.4rem 0.5rem;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.text-btn {
		border: 0;
		background: transparent;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.queue ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.queue li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: var(--radius);
		padding-right: 0.25rem;
	}
	.queue li.current {
		background: var(--surface-alt);
	}
	.track {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		padding: 0.45rem 0.4rem;
		text-align: left;
	}
	.track-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}
	.track-actions {
		display: flex;
		gap: 0.05rem;
		flex-shrink: 0;
	}
	.track-actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.track-actions button:hover:not(:disabled) {
		background: var(--surface);
		color: var(--text);
	}
	.track-actions button:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.track-actions button:first-child :global(svg) {
		transform: rotate(-90deg);
	}
	.track-actions button:nth-child(2) :global(svg) {
		transform: rotate(90deg);
	}
</style>
