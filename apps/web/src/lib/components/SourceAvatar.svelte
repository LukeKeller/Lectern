<script lang="ts">
	/**
	 * Source mark for list rows: the site's real favicon when reachable, with a
	 * neutral monogram fallback rendered underneath so it still shows offline or
	 * when the icon 404s. DuckDuckGo's icon service needs no key and does not
	 * profile the user, keeping the offline-first app honest.
	 */
	let {
		url,
		siteName = null,
		size = 30
	}: { url: string; siteName?: string | null; size?: number } = $props();

	function host(u: string): string {
		try {
			return new URL(u).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	}

	const hostname = $derived(host(url));
	const letter = $derived((siteName?.trim()?.[0] ?? hostname[0] ?? '?').toUpperCase());
	const iconSrc = $derived(hostname ? `https://icons.duckduckgo.com/ip3/${hostname}.ico` : '');

	let failed = $state(false);
</script>

<span class="avatar" style={`--sz:${size}px`} aria-hidden="true">
	<span class="mono">{letter}</span>
	{#if iconSrc && !failed}
		<img src={iconSrc} alt="" loading="lazy" onerror={() => (failed = true)} />
	{/if}
</span>

<style>
	.avatar {
		position: relative;
		flex-shrink: 0;
		width: var(--sz);
		height: var(--sz);
		border-radius: var(--radius-sm);
		overflow: hidden;
		display: grid;
		place-items: center;
		background: var(--surface-alt);
		border: 1px solid var(--border);
	}
	.mono {
		font-size: calc(var(--sz) * 0.45);
		font-weight: 600;
		color: var(--text-muted);
		line-height: 1;
		user-select: none;
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		background: var(--surface);
	}
</style>
