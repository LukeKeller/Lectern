<script lang="ts">
	import type { ImportReadwiseResponse } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { getApiUrl, getClient, getToken, setToken } from '$lib/config';
	import { getSync } from '$lib/sync';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import type { FontFamily, ThemeMode } from '$lib/typography';
	import { buildBookmarklet } from '$lib/bookmarklet';

	let token = $state('');
	let saved = $state(false);
	let copied = $state(false);
	const apiUrl = getApiUrl();

	const bookmarklet = $derived(buildBookmarklet(apiUrl, token.trim()));

	let importing = $state(false);
	let importResult = $state<ImportReadwiseResponse | undefined>(undefined);
	let importError = $state<string | undefined>(undefined);

	async function copyBookmarklet() {
		await navigator.clipboard.writeText(bookmarklet);
		copied = true;
	}

	const FONTS: { value: FontFamily; label: string }[] = [
		{ value: 'serif', label: 'Serif' },
		{ value: 'sans', label: 'Sans' },
		{ value: 'mono', label: 'Mono' }
	];
	const THEMES: { value: ThemeMode; label: string }[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'auto', label: 'Auto' }
	];

	onMount(() => {
		token = getToken() ?? '';
	});

	function save(event: SubmitEvent) {
		event.preventDefault();
		setToken(token.trim());
		saved = true;
	}

	// Read a Readwise Reader CSV export and import it, then refresh the mirror so
	// the imported documents appear in the lists immediately.
	async function importReadwise(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		importError = undefined;
		importResult = undefined;
		try {
			const csv = await file.text();
			importResult = await getClient().importReadwise({ csv });
			await getSync().pull();
		} catch (err) {
			importError = err instanceof Error ? err.message : 'Import failed.';
		} finally {
			importing = false;
			input.value = '';
		}
	}
</script>

<div class="page">
	<h1>Settings</h1>

	<section>
		<h2>Account</h2>
		<form class="stack" onsubmit={save}>
			<label>
				<span>API URL</span>
				<input type="text" value={apiUrl} readonly />
			</label>
			<label>
				<span>Bearer token</span>
				<input type="password" bind:value={token} placeholder="paste token" autocomplete="off" />
			</label>
			<div class="row">
				<button type="submit" class="btn">Save token</button>
				{#if saved}<span class="ok">Saved.</span>{/if}
			</div>
		</form>
	</section>

	<section>
		<h2>Import library</h2>
		<p class="hint">
			Import a Readwise Reader CSV export. Your documents, locations, and tags are added to your
			library.
		</p>
		<div class="row">
			<label class="file-btn" class:busy={importing}>
				{importing ? 'Importing…' : 'Choose CSV file'}
				<input type="file" accept=".csv,text/csv" onchange={importReadwise} disabled={importing} />
			</label>
		</div>
		{#if importResult}
			<dl class="summary">
				<div>
					<dt>Total</dt>
					<dd>{importResult.total}</dd>
				</div>
				<div>
					<dt>Imported</dt>
					<dd class="ok">{importResult.imported}</dd>
				</div>
				<div>
					<dt>Failed</dt>
					<dd class:err={importResult.failed > 0}>{importResult.failed}</dd>
				</div>
			</dl>
		{/if}
		{#if importError}<p class="err">{importError}</p>{/if}
	</section>

	<section>
		<h2>Save bookmarklet</h2>
		<p class="hint">
			Drag this link to your bookmarks bar to save the current page to Lectern from any browser. It
			embeds your personal token, so keep it private.
		</p>
		<div class="row">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="bm-link" href={bookmarklet} draggable="true" onclick={(e) => e.preventDefault()}>
				Save to Lectern
			</a>
			<button type="button" class="btn" onclick={copyBookmarklet}>Copy</button>
			{#if copied}<span class="ok">Copied.</span>{/if}
		</div>
		{#if !token.trim()}<p class="hint">Save a bearer token above first.</p>{/if}
	</section>

	<section>
		<h2>Reading</h2>
		<div class="stack">
			<div class="field">
				<span class="flabel">Theme</span>
				<div class="seg">
					{#each THEMES as t (t.value)}
						<button
							type="button"
							class:active={readerSettings.current.theme === t.value}
							onclick={() => readerSettings.update({ theme: t.value })}
						>
							{t.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="field">
				<span class="flabel">Typeface</span>
				<div class="seg">
					{#each FONTS as f (f.value)}
						<button
							type="button"
							class:active={readerSettings.current.fontFamily === f.value}
							onclick={() => readerSettings.update({ fontFamily: f.value })}
						>
							{f.label}
						</button>
					{/each}
				</div>
			</div>
			<label class="slider">
				<span>Text size <em>{readerSettings.current.fontSize}px</em></span>
				<input
					type="range"
					min="12"
					max="28"
					value={readerSettings.current.fontSize}
					oninput={(e) => readerSettings.update({ fontSize: Number(e.currentTarget.value) })}
				/>
			</label>
			<label class="slider">
				<span>Line height <em>{readerSettings.current.lineHeight}</em></span>
				<input
					type="range"
					min="1.2"
					max="2.2"
					step="0.1"
					value={readerSettings.current.lineHeight}
					oninput={(e) => readerSettings.update({ lineHeight: Number(e.currentTarget.value) })}
				/>
			</label>
			<label class="slider">
				<span>Max width <em>{readerSettings.current.maxWidth}px</em></span>
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
		<button type="button" class="btn ghost reset" onclick={() => readerSettings.reset()}>
			Reset to defaults
		</button>
	</section>
</div>

<style>
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 1.6rem;
	}
	section {
		margin-bottom: 2.4rem;
	}
	h2 {
		font-size: var(--text-md);
		margin-bottom: 0.6rem;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 26rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	label span,
	.flabel {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	input[type='text'],
	input[type='password'] {
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-base);
		background: var(--surface);
		color: var(--text);
		transition: border-color var(--dur-fast) var(--ease);
	}
	input[type='text']:focus,
	input[type='password']:focus {
		border-color: var(--accent);
		outline: none;
	}
	input[readonly] {
		color: var(--text-muted);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.7rem;
	}
	.btn {
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
	}
	.reset {
		margin-top: 1rem;
		color: var(--text-muted);
	}

	.file-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.95rem;
		border: 1px dashed var(--border-strong);
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
	.file-btn:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.file-btn.busy {
		opacity: 0.6;
		cursor: default;
	}
	.file-btn input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.summary {
		display: flex;
		gap: 2rem;
		margin: 1rem 0 0;
	}
	.summary div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.summary dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.summary dd {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.seg {
		display: flex;
		gap: 0.25rem;
		padding: 0.2rem;
		background: var(--surface-alt);
		border-radius: var(--radius);
		max-width: 18rem;
	}
	.seg button {
		flex: 1;
		padding: 0.36rem 0.4rem;
		border: 0;
		border-radius: calc(var(--radius) - 3px);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.seg button:hover {
		color: var(--text);
	}
	.seg button.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.slider {
		gap: 0.45rem;
	}
	.slider span {
		display: flex;
		justify-content: space-between;
	}
	.slider em {
		font-style: normal;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.slider input {
		width: 100%;
		accent-color: var(--accent);
	}

	.ok {
		color: var(--ok);
		font-size: var(--text-sm);
	}
	.err {
		color: var(--error);
		font-size: var(--text-sm);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--text-muted);
		max-width: 30rem;
		margin: 0 0 0.7rem;
	}
	.bm-link {
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
		cursor: grab;
	}
</style>
