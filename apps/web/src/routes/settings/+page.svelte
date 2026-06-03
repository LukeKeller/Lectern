<script lang="ts">
	import { onMount } from 'svelte';
	import { getApiUrl, getToken, setToken } from '$lib/config';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import type { FontFamily } from '$lib/typography';
	import { buildBookmarklet } from '$lib/bookmarklet';

	let token = $state('');
	let saved = $state(false);
	let copied = $state(false);
	const apiUrl = getApiUrl();

	const bookmarklet = $derived(buildBookmarklet(apiUrl, token.trim()));

	async function copyBookmarklet() {
		await navigator.clipboard.writeText(bookmarklet);
		copied = true;
	}

	const FONTS: { value: FontFamily; label: string }[] = [
		{ value: 'serif', label: 'Serif' },
		{ value: 'sans', label: 'Sans' },
		{ value: 'mono', label: 'Mono' }
	];
	const THEMES = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'auto', label: 'Auto' }
	] as const;

	onMount(() => {
		token = getToken() ?? '';
	});

	function save(event: SubmitEvent) {
		event.preventDefault();
		setToken(token.trim());
		saved = true;
	}
</script>

<h1>Settings</h1>

<section>
	<h2>Account</h2>
	<form onsubmit={save}>
		<label>
			API URL
			<input type="text" value={apiUrl} readonly />
		</label>
		<label>
			Bearer token
			<input type="password" bind:value={token} placeholder="paste token" autocomplete="off" />
		</label>
		<button type="submit">Save token</button>
		{#if saved}<span class="ok">Saved.</span>{/if}
	</form>
</section>

<section>
	<h2>Save bookmarklet</h2>
	<p class="hint">
		Drag this link to your bookmarks bar to save the current page to Lectern from any browser. It
		embeds your personal token, so keep it private.
	</p>
	<div class="bookmarklet">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="bm-link" href={bookmarklet} draggable="true" onclick={(e) => e.preventDefault()}>
			Save to Lectern
		</a>
		<button type="button" onclick={copyBookmarklet}>Copy</button>
		{#if copied}<span class="ok">Copied.</span>{/if}
	</div>
	{#if !token.trim()}<p class="hint">Save a bearer token above first.</p>{/if}
</section>

<section>
	<h2>Reading</h2>
	<div class="grid">
		<label>
			Theme
			<select
				value={readerSettings.current.theme}
				onchange={(e) => readerSettings.update({ theme: e.currentTarget.value as 'light' })}
			>
				{#each THEMES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
			</select>
		</label>
		<label>
			Font family
			<select
				value={readerSettings.current.fontFamily}
				onchange={(e) => readerSettings.update({ fontFamily: e.currentTarget.value as FontFamily })}
			>
				{#each FONTS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
			</select>
		</label>
		<label>
			Font size {readerSettings.current.fontSize}px
			<input
				type="range"
				min="12"
				max="28"
				value={readerSettings.current.fontSize}
				oninput={(e) => readerSettings.update({ fontSize: Number(e.currentTarget.value) })}
			/>
		</label>
		<label>
			Line height {readerSettings.current.lineHeight}
			<input
				type="range"
				min="1.2"
				max="2.2"
				step="0.1"
				value={readerSettings.current.lineHeight}
				oninput={(e) => readerSettings.update({ lineHeight: Number(e.currentTarget.value) })}
			/>
		</label>
		<label>
			Max width {readerSettings.current.maxWidth}px
			<input
				type="range"
				min="480"
				max="1000"
				step="20"
				value={readerSettings.current.maxWidth}
				oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
			/>
		</label>
	</div>
	<button type="button" class="reset" onclick={() => readerSettings.reset()}
		>Reset to defaults</button
	>
</section>

<style>
	section {
		margin-bottom: 2rem;
	}
	h2 {
		font-size: 1rem;
		color: var(--text-muted);
	}
	form,
	.grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 420px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}
	input,
	select {
		padding: 0.4rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 1rem;
		background: var(--surface);
		color: var(--text);
	}
	input[type='range'] {
		padding: 0;
		accent-color: var(--accent);
	}
	button {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-alt);
		color: var(--text);
		cursor: pointer;
	}
	.reset {
		margin-top: 0.75rem;
	}
	.ok {
		color: var(--ok);
		font-size: 0.85rem;
	}
	.hint {
		font-size: 0.85rem;
		color: var(--text-muted);
		max-width: 420px;
	}
	.bookmarklet {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.bm-link {
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-alt);
		color: var(--text);
		text-decoration: none;
		cursor: grab;
	}
</style>
