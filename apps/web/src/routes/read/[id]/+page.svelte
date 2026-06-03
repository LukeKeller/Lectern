<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount, tick } from 'svelte';
	import DOMPurify from 'dompurify';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import { liveCards } from '$lib/live.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { readerCssVars, type FontFamily } from '$lib/typography';
	import {
		childSelector,
		computePercent,
		nearestAnchor,
		type AnchorCandidate
	} from '$lib/progress';
	import TagEditor from '$lib/components/TagEditor.svelte';

	const id = page.params.id;

	const liveCard = liveCards(() => (id ? db.cards.get(id) : Promise.resolve(undefined)));
	const card = $derived<Card | undefined>(liveCard.value);

	let html = $state('');
	let error = $state<string | undefined>(undefined);
	let loading = $state(true);
	let articleEl = $state<HTMLElement | null>(null);
	let ready = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const styleVars = $derived(
		Object.entries(readerCssVars(readerSettings.current))
			.map(([k, v]) => `${k}:${v}`)
			.join(';')
	);

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

	function candidates(): AnchorCandidate[] {
		if (!articleEl) return [];
		const out: AnchorCandidate[] = [];
		const kids = articleEl.children;
		for (let i = 0; i < kids.length; i++) {
			const rect = (kids[i] as HTMLElement).getBoundingClientRect();
			out.push({ selector: childSelector(i), top: rect.top + window.scrollY });
		}
		return out;
	}

	function scrollMetrics() {
		const el = document.scrollingElement ?? document.documentElement;
		return {
			scrollTop: window.scrollY,
			scrollHeight: el.scrollHeight,
			clientHeight: window.innerHeight
		};
	}

	/** Persist the current scroll position as reading progress + a stable anchor. */
	function capture() {
		if (!ready || !articleEl || !id) return;
		const m = scrollMetrics();
		const percent = computePercent(m.scrollTop, m.scrollHeight, m.clientHeight);
		const anchor = nearestAnchor(candidates(), m.scrollTop);
		const sync = getSync();
		void sync
			.enqueue({ type: 'setReadingProgress', id, readingProgress: percent, readAnchor: anchor })
			.then(() => sync.flush());
	}

	function onScroll() {
		if (!ready) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(capture, 300);
	}

	/** Restore scroll to the saved anchor, or the saved percent as a fallback. */
	function restore(initial: Card | undefined) {
		if (!articleEl || !initial) return;
		let target = 0;
		if (initial.readAnchor) {
			const el = articleEl.querySelector<HTMLElement>(initial.readAnchor);
			if (el) target = el.getBoundingClientRect().top + window.scrollY - 8;
		}
		if (target <= 0 && initial.readingProgress > 0) {
			const el = document.scrollingElement ?? document.documentElement;
			target = initial.readingProgress * (el.scrollHeight - window.innerHeight);
		}
		if (target > 0) window.scrollTo(0, target);
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			const initial = id ? await db.cards.get(id) : undefined;
			try {
				if (!id) throw new Error('Missing document id');
				const content = await getClient().getContent(id);
				// Sanitize before rendering untrusted article HTML on the client.
				html = DOMPurify.sanitize(content.html);
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
			} finally {
				loading = false;
			}
			await tick();
			if (cancelled || error) return;
			restore(initial);
			ready = true;
			window.addEventListener('scroll', onScroll, { passive: true });
		})();
		return () => {
			cancelled = true;
			capture();
			if (timer) clearTimeout(timer);
			window.removeEventListener('scroll', onScroll);
		};
	});
</script>

<nav class="bar">
	<a class="back" href={resolve('/')}>← Back</a>
	{#if card}
		<!-- card.url is an external absolute URL, not an internal route -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="orig" href={card.url} target="_blank" rel="noopener noreferrer">Original ↗</a>
	{/if}
	<details class="display">
		<summary>Display</summary>
		<div class="panel">
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
				Font
				<select
					value={readerSettings.current.fontFamily}
					onchange={(e) =>
						readerSettings.update({ fontFamily: e.currentTarget.value as FontFamily })}
				>
					{#each FONTS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
				</select>
			</label>
			<label>
				Size {readerSettings.current.fontSize}px
				<input
					type="range"
					min="12"
					max="28"
					value={readerSettings.current.fontSize}
					oninput={(e) => readerSettings.update({ fontSize: Number(e.currentTarget.value) })}
				/>
			</label>
			<label>
				Leading {readerSettings.current.lineHeight}
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
				Width {readerSettings.current.maxWidth}px
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
	</details>
</nav>

{#if card}
	<h1>{card.title}</h1>
	<p class="meta">{card.siteName ?? card.author ?? new URL(card.url).hostname}</p>
	<TagEditor id={card.id} tags={card.tags} />
{/if}

{#if loading}
	<p class="muted">Loading…</p>
{:else if error}
	<p class="error">Could not load article: {error}</p>
{:else}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<article bind:this={articleEl} style={styleVars}>{@html html}</article>
{/if}

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.back,
	.orig {
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}
	.display {
		margin-left: auto;
		font-size: 0.85rem;
	}
	.display summary {
		cursor: pointer;
		color: var(--text-muted);
		list-style: none;
	}
	.panel {
		position: absolute;
		right: 1rem;
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
		z-index: 10;
	}
	.panel label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: var(--text-muted);
	}
	.panel select,
	.panel input {
		accent-color: var(--accent);
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.meta {
		color: var(--text-muted);
		margin-top: 0;
		margin-bottom: 0.5rem;
	}
	.muted {
		color: var(--text-muted);
	}
	.error {
		color: var(--error);
	}
	article {
		margin: 1rem auto 0;
		max-width: var(--reader-width);
		font-family: var(--reader-font);
		font-size: var(--reader-size);
		line-height: var(--reader-leading);
	}
	article :global(img) {
		max-width: 100%;
		height: auto;
	}
</style>
