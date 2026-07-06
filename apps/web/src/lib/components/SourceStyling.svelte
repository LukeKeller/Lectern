<script lang="ts">
	/**
	 * Source styling inspector: shows the theming Lectern has saved for the current
	 * article's publication — colour swatches (labelled with their real hex) and font
	 * previews rendered in the real face. Presentational only; the reader page owns
	 * the fetch, the font-stylesheet loading, and the open/close plumbing.
	 */
	import type { SourceThemeResponse } from '@lectern/shared';
	import Icon from '$lib/components/Icon.svelte';

	let {
		theme,
		host,
		loading = false,
		refreshing = false,
		onRefresh,
		onClose
	}: {
		/** The resolved source theme tokens (nullable fields), or null when none saved. */
		theme: SourceThemeResponse | null;
		/** The article's hostname — the fallback name when the source exposed none. */
		host: string;
		/** True while the on-demand fetch is in flight. */
		loading?: boolean;
		/** True while a bypass-cache refresh is in flight. */
		refreshing?: boolean;
		/** Re-fetch this source's theme from its site. */
		onRefresh: () => void;
		/** Dismiss the inspector. */
		onClose: () => void;
	} = $props();

	const name = $derived(theme?.siteName || host);

	// Every colour token the source exposed, in reading order. Null tokens are
	// dropped — a source rarely exposes all six.
	const colours = $derived(
		(
			[
				{ label: 'Accent', value: theme?.accent },
				{ label: 'Accent (dark)', value: theme?.accentDark },
				{ label: 'Background', value: theme?.background },
				{ label: 'Background (dark)', value: theme?.backgroundDark },
				{ label: 'Text', value: theme?.text },
				{ label: 'Link', value: theme?.link }
			] as { label: string; value: string | null | undefined }[]
		).filter((c): c is { label: string; value: string } => !!c.value)
	);

	const fonts = $derived([
		{ label: 'Body font', value: theme?.bodyFont ?? null },
		{ label: 'Display font', value: theme?.displayFont ?? null }
	]);

	// The derivation badge copy + a title explaining what "saved theming" means here.
	const badge = $derived.by(() => {
		switch (theme?.derivation) {
			case 'literal':
				return {
					label: 'Literal',
					title: 'Parsed directly from this source’s own CSS.'
				};
			case 'derived':
				return {
					label: 'Derived',
					title: 'Synthesized from the source’s brand colour when its CSS was unreadable.'
				};
			default:
				return {
					label: 'No palette',
					title: 'Lectern couldn’t extract or derive a palette for this source.'
				};
		}
	});
</script>

<div class="ss-head">
	{#if theme?.faviconUrl}
		<img
			class="ss-favicon"
			src={theme.faviconUrl}
			alt=""
			aria-hidden="true"
			loading="lazy"
			referrerpolicy="no-referrer"
			onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
		/>
	{/if}
	<div class="ss-id">
		<span class="ss-name">{name}</span>
		<span class="ss-host">{host}</span>
	</div>
	<span
		class="ss-badge"
		class:derived={theme?.derivation === 'derived'}
		class:none={!theme?.derivation}
		title={badge.title}
	>
		{badge.label}
	</span>
</div>

{#if loading}
	<div class="ss-loading" aria-live="polite">
		<Icon name="refresh" size={15} />
		<span>Reading saved styling…</span>
	</div>
{:else}
	<section class="ss-section">
		<p class="ss-section-label">Colours</p>
		{#if colours.length}
			<div class="ss-swatches">
				{#each colours as c (c.label)}
					<div class="ss-swatch">
						<span class="ss-chip" style={`background:${c.value}`} aria-hidden="true"></span>
						<span class="ss-swatch-label">{c.label}</span>
						<span class="ss-value">{c.value}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="ss-none">No colours detected for this source.</p>
		{/if}
	</section>

	<section class="ss-section">
		<p class="ss-section-label">Fonts</p>
		<div class="ss-fonts">
			{#each fonts as f (f.label)}
				<div class="ss-font">
					<div class="ss-font-head">
						<span class="ss-swatch-label">{f.label}</span>
						{#if f.value}
							<span class="ss-value">{f.value}</span>
						{:else}
							<span class="ss-value muted">{f.label === 'Body font' ? 'Uses your reader font' : '—'}</span>
						{/if}
					</div>
					{#if f.value}
						<p class="ss-preview" style={`font-family: '${f.value}', serif`}>
							The quick brown fox jumps over the lazy dog
						</p>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

<div class="ss-footer">
	<button type="button" class="ss-refresh" onclick={onRefresh} disabled={refreshing}>
		<Icon name="refresh" size={14} />
		<span>{refreshing ? 'Refreshing…' : 'Refresh this source'}</span>
	</button>
	<button type="button" class="ss-close" onclick={onClose}>Close</button>
</div>
<p class="ss-note">Refreshing re-fetches the theme from the site, bypassing the cache.</p>

<style>
	.ss-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ss-favicon {
		width: 1.6rem;
		height: 1.6rem;
		border-radius: var(--radius-sm);
		object-fit: contain;
		flex: none;
	}
	.ss-id {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}
	.ss-name {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--text);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ss-host {
		font-size: var(--text-2xs);
		color: var(--text-muted);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ss-badge {
		flex: none;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--accent);
		background: var(--accent-soft);
		cursor: help;
	}
	.ss-badge.derived {
		color: var(--text-muted);
		background: var(--surface-alt);
	}
	.ss-badge.none {
		color: var(--text-muted);
		background: var(--surface-alt);
	}
	.ss-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.ss-loading :global(svg) {
		animation: ss-spin 0.9s linear infinite;
	}
	@keyframes ss-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ss-loading :global(svg) {
			animation: none;
		}
	}
	.ss-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.ss-section-label {
		margin: 0;
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ss-swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
		gap: 0.5rem;
	}
	.ss-swatch {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		column-gap: 0.5rem;
		align-items: center;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-alt);
	}
	.ss-chip {
		grid-row: 1 / 3;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
	}
	.ss-swatch-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text);
		line-height: 1.2;
	}
	.ss-value {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--text-muted);
		user-select: all;
	}
	.ss-value.muted {
		user-select: none;
		font-family: inherit;
	}
	.ss-none {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.ss-fonts {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.ss-font {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.ss-font-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.ss-preview {
		margin: 0;
		font-size: 1.15rem;
		line-height: 1.3;
		color: var(--text);
	}
	.ss-footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}
	.ss-refresh {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1;
		min-height: 2.5rem;
		padding: 0.45rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.ss-refresh:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.ss-refresh:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ss-refresh :global(svg) {
		color: var(--text-muted);
		flex-shrink: 0;
	}
	.ss-refresh:disabled :global(svg) {
		animation: ss-spin 0.9s linear infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.ss-refresh:disabled :global(svg) {
			animation: none;
		}
	}
	.ss-close {
		min-height: 2.5rem;
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.ss-close:hover {
		color: var(--text);
		background: var(--surface-alt);
	}
	.ss-note {
		margin: 0;
		font-size: var(--text-2xs);
		line-height: 1.4;
		color: var(--text-muted);
	}
</style>
