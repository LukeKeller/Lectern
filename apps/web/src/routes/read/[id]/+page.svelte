<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount, tick } from 'svelte';
	import DOMPurify from 'dompurify';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import type { Location, Highlight, NewHighlight } from '@lectern/shared';
	import { serializeRange, renderHighlights } from '$lib/highlight';
	import { liveCards } from '$lib/live.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import { readerCssVars, type FontFamily, type ThemeMode } from '$lib/typography';
	import {
		childSelector,
		computePercent,
		nearestAnchor,
		type AnchorCandidate
	} from '$lib/progress';
	import TagEditor from '$lib/components/TagEditor.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const id = page.params.id;

	const liveCard = liveCards(() => (id ? db.cards.get(id) : Promise.resolve(undefined)));
	const card = $derived<Card | undefined>(liveCard.value);

	let html = $state('');
	let error = $state<string | undefined>(undefined);
	let loading = $state(true);
	let articleEl = $state<HTMLElement | null>(null);
	let progress = $state(0);
	let showDisplay = $state(false);
	let ready = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let raf = 0;
	let docEl = $state<HTMLElement | null>(null);
	let focusIndex = $state(-1);
	let barTop = $state(0);
	let barH = $state(0);
	let blocks: HTMLElement[] = [];
	let tocOpen = $state(loadBool('lectern.reader.toc', false));
	let panelOpen = $state(loadBool('lectern.reader.panel', true));
	let headings = $state<{ id: string; text: string; level: number }[]>([]);
	let activeHeading = $state('');
	let highlights = $state<Highlight[]>([]);
	let panelTab = $state<'info' | 'notebook'>('info');
	let selRect = $state<{ x: number; y: number } | null>(null);
	let pendingHighlight: NewHighlight | null = null;
	let noteDraft = $state('');
	let noteReady = false;
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('lectern.reader.toc', tocOpen ? '1' : '0');
		localStorage.setItem('lectern.reader.panel', panelOpen ? '1' : '0');
	});

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

	const THEMES: { value: ThemeMode; label: string }[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'auto', label: 'Auto' }
	];

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
		// Smooth visual bar via rAF; persistence stays debounced to limit writes.
		if (!raf) {
			raf = requestAnimationFrame(() => {
				raf = 0;
				const m = scrollMetrics();
				progress = computePercent(m.scrollTop, m.scrollHeight, m.clientHeight);
				// Scroll-spy: the last heading scrolled above the top band is "active".
				let cur = '';
				for (const h of headings) {
					const el = document.getElementById(h.id);
					if (el && el.getBoundingClientRect().top <= 120) cur = h.id;
				}
				activeHeading = cur;
			});
		}
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

	/** Send the open document back to the previous list (Readwise's default). */
	function goBack() {
		if (history.length > 1) history.back();
		else void goto(resolve('/'));
	}

	// Paragraph focus: an accent bar tracks the "current" block; Space / arrows move
	// it and auto-scroll it to center, for keyboard-driven reading.
	const BLOCK_SEL = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, figure';

	function collectBlocks() {
		blocks = articleEl
			? Array.from(articleEl.querySelectorAll<HTMLElement>(BLOCK_SEL)).filter(
					(b) => (b.textContent?.trim().length ?? 0) > 0 || !!b.querySelector('img')
				)
			: [];
	}

	/** Block nearest the top third of the viewport — where focus starts on first move. */
	function nearestBlock(): number {
		const probe = window.innerHeight * 0.3;
		let best = 0;
		let bestDist = Infinity;
		for (let i = 0; i < blocks.length; i++) {
			const d = Math.abs(blocks[i].getBoundingClientRect().top - probe);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return best;
	}

	function updateBar() {
		const block = blocks[focusIndex];
		if (!block || !docEl) return;
		const dr = docEl.getBoundingClientRect();
		const r = block.getBoundingClientRect();
		// Offset within .doc is scroll-invariant (both rects move together).
		barTop = r.top - dr.top;
		barH = r.height;
	}

	function focusBlock(i: number) {
		focusIndex = Math.max(0, Math.min(blocks.length - 1, i));
		updateBar();
		blocks[focusIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	/** Move the paragraph focus; returns false when there are no blocks yet. */
	function advance(delta: number): boolean {
		if (!blocks.length) return false;
		focusBlock(focusIndex < 0 ? nearestBlock() : focusIndex + delta);
		return true;
	}

	function isEditable(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
		if (e.key === ' ') {
			// Space advances a paragraph (Shift+Space goes back).
			if (advance(e.shiftKey ? -1 : 1)) e.preventDefault();
		} else if (e.key === '[') {
			tocOpen = !tocOpen;
			e.preventDefault();
		} else if (e.key === ']') {
			panelOpen = !panelOpen;
			e.preventDefault();
		} else if ((e.key === 'h' || e.key === 'H') && articleEl && blocks[focusIndex]) {
			// Highlight the focused paragraph.
			const r = document.createRange();
			r.selectNodeContents(blocks[focusIndex]);
			const nh = serializeRange(articleEl, r);
			if (nh) {
				e.preventDefault();
				void addHighlight(nh);
			}
		}
	}

	function loadBool(key: string, dflt: boolean): boolean {
		if (typeof localStorage === 'undefined') return dflt;
		const v = localStorage.getItem(key);
		return v === null ? dflt : v === '1';
	}

	/** Build the table of contents from the article's headings, assigning ids. */
	function buildToc() {
		if (!articleEl) {
			headings = [];
			return;
		}
		headings = Array.from(articleEl.querySelectorAll<HTMLElement>('h2, h3'))
			.map((el, i) => {
				if (!el.id) el.id = `h-${i}`;
				return {
					id: el.id,
					text: el.textContent?.trim() ?? '',
					level: el.tagName === 'H3' ? 3 : 2
				};
			})
			.filter((h) => h.text);
	}

	function jumpTo(e: MouseEvent, hid: string) {
		e.preventDefault();
		document.getElementById(hid)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	async function addHighlight(nh: NewHighlight) {
		if (!id || !articleEl) return;
		try {
			const created = await getClient().createHighlight(id, nh);
			highlights = [...highlights, created];
			renderHighlights(articleEl, highlights);
		} catch {
			/* offline / failed: leave the selection so the user can retry */
		}
		selRect = null;
		pendingHighlight = null;
		window.getSelection()?.removeAllRanges();
	}

	async function removeHighlight(hid: string) {
		if (!articleEl) return;
		try {
			await getClient().deleteHighlight(hid);
		} catch {
			return;
		}
		highlights = highlights.filter((h) => h.id !== hid);
		renderHighlights(articleEl, highlights);
	}

	/** Capture a text selection inside the article and position the highlight button. */
	function onMouseUp() {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !articleEl) {
			selRect = null;
			pendingHighlight = null;
			return;
		}
		const range = sel.getRangeAt(0);
		const nh = articleEl.contains(range.commonAncestorContainer)
			? serializeRange(articleEl, range)
			: null;
		if (!nh) {
			selRect = null;
			return;
		}
		const rect = range.getBoundingClientRect();
		pendingHighlight = nh;
		selRect = { x: rect.left + rect.width / 2, y: rect.top };
	}

	function saveNote() {
		if (!id) return;
		const sync = getSync();
		void sync
			.enqueue({ type: 'setNote', id, note: noteDraft.trim() || null })
			.then(() => sync.flush());
	}

	$effect(() => {
		// Seed the note editor once the card loads, without clobbering edits.
		if (card && !noteReady) {
			noteDraft = card.note ?? '';
			noteReady = true;
		}
	});

	// Keyboard control while reading: j/k (and arrows) scroll, e/l/s/i triage the
	// current document and return to the list, Esc just goes back. Wired through
	// the same global key layer the lists use, so the whole app stays navigable.
	const controller: ListController = {
		move(delta) {
			// j/k and arrows move the paragraph focus; fall back to scrolling pre-render.
			if (!advance(delta)) {
				window.scrollBy({ top: delta * Math.round(window.innerHeight * 0.1), behavior: 'smooth' });
			}
		},
		open() {},
		triage(location: Location) {
			if (!card) return;
			const sync = getSync();
			void sync.enqueue({ type: 'setLocation', id: card.id, location }).then(() => sync.flush());
			goBack();
		},
		back: goBack
	};

	onMount(() => {
		let cancelled = false;
		activeList.set(controller);
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
			const m = scrollMetrics();
			progress = computePercent(m.scrollTop, m.scrollHeight, m.clientHeight);
			ready = true;
			window.addEventListener('scroll', onScroll, { passive: true });
			collectBlocks();
			buildToc();
			if (id) {
				try {
					highlights = (await getClient().listHighlights(id)).highlights;
					renderHighlights(articleEl as HTMLElement, highlights);
				} catch {
					/* offline: highlights load on the next visit */
				}
			}
			window.addEventListener('keydown', onKey);
			window.addEventListener('resize', updateBar);
			document.addEventListener('mouseup', onMouseUp);
		})();
		return () => {
			cancelled = true;
			activeList.clear(controller);
			capture();
			if (timer) clearTimeout(timer);
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', updateBar);
			document.removeEventListener('mouseup', onMouseUp);
		};
	});
</script>

<div class="progress" aria-hidden="true" style={`--p:${Math.round(progress * 100)}%`}></div>

<nav class="bar">
	<a class="back" href={resolve('/')} aria-label="Back to inbox">
		<Icon name="back" size={18} />
		<span>Back</span>
	</a>
	<div class="bar-right">
		<button
			type="button"
			class="rail-btn"
			class:on={tocOpen}
			aria-pressed={tocOpen}
			onclick={() => (tocOpen = !tocOpen)}
			title="Contents ( [ )"
			aria-label="Toggle contents"
		>
			<Icon name="list" size={16} />
		</button>
		<button
			type="button"
			class="rail-btn"
			class:on={panelOpen}
			aria-pressed={panelOpen}
			onclick={() => (panelOpen = !panelOpen)}
			title="Info ( ] )"
			aria-label="Toggle info panel"
		>
			<Icon name="info" size={16} />
		</button>
		{#if card}
			<!-- card.url is an external absolute URL, not an internal route -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="orig" href={card.url} target="_blank" rel="noopener noreferrer">
				<span>Original</span>
				<Icon name="external" size={15} />
			</a>
		{/if}
		<button
			type="button"
			class="display-btn"
			class:on={showDisplay}
			aria-expanded={showDisplay}
			onclick={() => (showDisplay = !showDisplay)}
		>
			<Icon name="sliders" size={16} />
			<span>Display</span>
		</button>
	</div>

	{#if showDisplay}
		<button
			type="button"
			class="display-scrim"
			aria-label="Close display settings"
			onclick={() => (showDisplay = false)}
		></button>
		<div class="panel" role="dialog" aria-label="Display settings">
			<div class="field">
				<span class="field-label">Theme</span>
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
				<span class="field-label">Typeface</span>
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
				<span>Width <em>{readerSettings.current.maxWidth}px</em></span>
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
	{/if}
</nav>

<div class="reader" class:toc-open={tocOpen} class:panel-open={panelOpen}>
	<aside class="rail toc">
		<p class="rail-head">Contents</p>
		{#if headings.length}
			<nav class="toc-list">
				{#each headings as h (h.id)}
					<a
						href={`#${h.id}`}
						class:lvl3={h.level === 3}
						class:active={activeHeading === h.id}
						onclick={(e) => jumpTo(e, h.id)}>{h.text}</a
					>
				{/each}
			</nav>
		{:else}
			<p class="rail-empty">No headings.</p>
		{/if}
	</aside>
	<div class="doc" style={styleVars} bind:this={docEl}>
		{#if focusIndex >= 0}
			<div class="focus-bar" style={`--top:${barTop}px;--h:${barH}px`} aria-hidden="true"></div>
		{/if}
		{#if card}
			<h1>{card.title}</h1>
			<p class="byline">
				{card.siteName ?? card.author ?? new URL(card.url).hostname}
				{#if card.readingTimeMinutes}<span class="dot">·</span>{card.readingTimeMinutes} min read{/if}
			</p>
			<div class="tageditor"><TagEditor id={card.id} tags={card.tags} /></div>
		{/if}

		{#if loading}
			<p class="state">Loading…</p>
		{:else if error}
			<p class="state err">Could not load article: {error}</p>
		{:else}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<article bind:this={articleEl}>{@html html}</article>
		{/if}
	</div>
	<aside class="rail panel">
		<div class="rail-tabs">
			<button type="button" class:active={panelTab === 'info'} onclick={() => (panelTab = 'info')}
				>Info</button
			>
			<button
				type="button"
				class:active={panelTab === 'notebook'}
				onclick={() => (panelTab = 'notebook')}
				>Notebook{#if highlights.length}
					· {highlights.length}{/if}</button
			>
		</div>
		{#if card && panelTab === 'info'}
			<dl class="meta">
				<div>
					<dt>Source</dt>
					<dd>{card.siteName ?? new URL(card.url).hostname}</dd>
				</div>
				{#if card.author}<div>
						<dt>Author</dt>
						<dd>{card.author}</dd>
					</div>{/if}
				<div>
					<dt>Type</dt>
					<dd>{card.category}</dd>
				</div>
				{#if card.wordCount}
					<div>
						<dt>Length</dt>
						<dd>
							{card.wordCount.toLocaleString()} words{#if card.readingTimeMinutes}
								· {card.readingTimeMinutes}
								min{/if}
						</dd>
					</div>
				{/if}
				<div>
					<dt>Progress</dt>
					<dd>{Math.round(card.readingProgress * 100)}%</dd>
				</div>
				<div>
					<dt>Saved</dt>
					<dd>
						{new Date(card.savedAt).toLocaleDateString(undefined, {
							month: 'short',
							day: 'numeric',
							year: 'numeric'
						})}
					</dd>
				</div>
			</dl>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="meta-orig" href={card.url} target="_blank" rel="noopener noreferrer"
				>Open original <Icon name="external" size={13} /></a
			>
		{/if}
		{#if panelTab === 'notebook'}
			<label class="nb-note">
				<span>Note</span>
				<textarea
					bind:value={noteDraft}
					onblur={saveNote}
					placeholder="Add a note for this document…"
					rows="3"
				></textarea>
			</label>
			<p class="rail-head">Highlights</p>
			{#if highlights.length}
				<ul class="hl-list">
					{#each highlights as h (h.id)}
						<li class="hl-item" data-color={h.color}>
							<button
								type="button"
								class="hl-text"
								onclick={() =>
									document
										.querySelector(`mark[data-hl="${h.id}"]`)
										?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>{h.text}</button
							>
							{#if h.note}<p class="hl-note">{h.note}</p>{/if}
							<button
								type="button"
								class="hl-del"
								aria-label="Remove highlight"
								onclick={() => removeHighlight(h.id)}
							>
								<Icon name="close" size={13} />
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="rail-empty">Select text or press <kbd>H</kbd> to highlight.</p>
			{/if}
		{/if}
	</aside>
</div>

{#if selRect}
	<button
		type="button"
		class="hl-popover"
		style={`--x:${selRect.x}px;--y:${selRect.y}px`}
		onmousedown={(e) => e.preventDefault()}
		onclick={() => pendingHighlight && addHighlight(pendingHighlight)}
	>
		<Icon name="highlight" size={15} /> Highlight
	</button>
{/if}

<style>
	.progress {
		position: fixed;
		top: 0;
		left: var(--sidebar-w);
		right: 0;
		height: 3px;
		z-index: 50;
		pointer-events: none;
	}
	.progress::after {
		content: '';
		display: block;
		height: 100%;
		width: var(--p);
		background: var(--accent);
		transition: width 80ms linear;
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin: -0.4rem 0 1.4rem;
		padding: 0.5rem 0;
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: blur(8px);
	}
	.back,
	.orig,
	.display-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-muted);
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius);
		border: 0;
		background: transparent;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.back:hover,
	.orig:hover,
	.display-btn:hover,
	.display-btn.on {
		color: var(--text);
		background: var(--surface-alt);
	}
	.bar-right {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.display-scrim {
		position: fixed;
		inset: 0;
		z-index: 24;
		border: 0;
		background: transparent;
		cursor: default;
	}
	.panel {
		position: absolute;
		top: calc(100% + 0.3rem);
		right: 0;
		z-index: 25;
		width: min(20rem, 90vw);
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field-label,
	.slider span {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.slider em {
		font-style: normal;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.seg {
		display: flex;
		gap: 0.25rem;
		padding: 0.2rem;
		background: var(--surface-alt);
		border-radius: var(--radius);
	}
	.seg button {
		flex: 1;
		padding: 0.34rem 0.4rem;
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
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.slider span {
		display: flex;
		justify-content: space-between;
	}
	.slider input {
		width: 100%;
		accent-color: var(--accent);
	}

	.doc {
		position: relative;
		flex: 0 1 var(--reader-width);
		max-width: var(--reader-width);
		min-width: 0;
	}
	.focus-bar {
		position: absolute;
		left: -0.9rem;
		top: var(--top);
		height: var(--h);
		width: 3px;
		border-radius: var(--radius-full);
		background: var(--accent);
		transition:
			top 180ms var(--ease),
			height 180ms var(--ease);
		pointer-events: none;
	}
	@media (max-width: 760px) {
		.focus-bar {
			left: -0.3rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.focus-bar {
			transition: none;
		}
	}
	h1 {
		font-family: var(--font-serif);
		font-size: clamp(1.7rem, 1.2rem + 2vw, 2.4rem);
		line-height: 1.15;
		letter-spacing: -0.015em;
		margin: 0.5rem 0 0.5rem;
	}
	.byline {
		margin: 0 0 1.1rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.dot {
		margin: 0 0.4rem;
	}
	.tageditor {
		margin-bottom: 1.8rem;
		padding-bottom: 1.4rem;
		border-bottom: 1px solid var(--border);
	}
	.state {
		color: var(--text-muted);
	}
	.err {
		color: var(--error);
	}

	article {
		font-family: var(--reader-font);
		font-size: var(--reader-size);
		line-height: var(--reader-leading);
		color: var(--text);
	}
	article :global(p),
	article :global(ul),
	article :global(ol),
	article :global(blockquote),
	article :global(pre),
	article :global(figure),
	article :global(table) {
		margin: 0 0 1.15em;
	}
	article :global(h2),
	article :global(h3),
	article :global(h4) {
		font-family: var(--font-serif);
		line-height: 1.25;
		margin: 1.8em 0 0.6em;
	}
	article :global(h2) {
		font-size: 1.45em;
	}
	article :global(h3) {
		font-size: 1.2em;
	}
	article :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.16em;
	}
	article :global(img),
	article :global(video) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius);
	}
	article :global(figure) {
		margin-inline: 0;
	}
	article :global(figcaption) {
		margin-top: 0.5em;
		font-size: 0.82em;
		color: var(--text-muted);
		text-align: center;
	}
	article :global(blockquote) {
		padding-left: 1.1em;
		border-left: 3px solid var(--accent);
		color: var(--text-muted);
		font-style: italic;
	}
	article :global(ul),
	article :global(ol) {
		padding-left: 1.4em;
	}
	article :global(li) {
		margin-bottom: 0.4em;
	}
	article :global(hr) {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 2.2em 0;
	}
	article :global(code) {
		font-family: var(--font-mono);
		font-size: 0.88em;
		padding: 0.12em 0.36em;
		border-radius: var(--radius-sm);
		background: var(--surface-alt);
	}
	article :global(pre) {
		padding: 1em 1.1em;
		border-radius: var(--radius);
		background: var(--surface-alt);
		overflow-x: auto;
	}
	article :global(pre code) {
		padding: 0;
		background: transparent;
		font-size: 0.85em;
	}
	article :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92em;
	}
	article :global(th),
	article :global(td) {
		padding: 0.5em 0.7em;
		border: 1px solid var(--border);
		text-align: left;
	}

	@media (max-width: 820px) {
		.progress {
			left: 0;
		}
		.bar {
			position: static;
		}
	}
	.rail-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.rail-btn:hover {
		color: var(--text);
		background: var(--surface-alt);
	}
	.rail-btn.on {
		color: var(--accent);
		background: var(--accent-soft);
	}

	.reader {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		gap: 2rem;
	}
	.rail {
		display: none;
	}
	.rail-head {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0 0 0.6rem;
	}
	.rail-empty {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.toc-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.toc-list a {
		display: block;
		padding: 0.28rem 0.5rem;
		border-radius: var(--radius);
		color: var(--text-muted);
		text-decoration: none;
		line-height: 1.35;
		border-left: 2px solid transparent;
	}
	.toc-list a.lvl3 {
		padding-left: 1.2rem;
		font-size: var(--text-2xs);
	}
	.toc-list a:hover {
		color: var(--text);
		background: var(--surface-alt);
	}
	.toc-list a.active {
		color: var(--accent);
		border-left-color: var(--accent);
	}
	.meta {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.meta > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.meta dt {
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.meta dd {
		margin: 0;
		color: var(--text);
	}
	.meta-orig {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 1rem;
		font-size: var(--text-sm);
		color: var(--accent);
		text-decoration: none;
	}
	.meta-orig:hover {
		text-decoration: underline;
	}
	@media (max-width: 979px) {
		.rail-btn {
			display: none;
		}
	}
	@media (min-width: 980px) {
		.reader.toc-open .rail.toc,
		.reader.panel-open .rail.panel {
			display: block;
		}
		.rail {
			position: sticky;
			top: 3.4rem;
			max-height: calc(100vh - 4.5rem);
			overflow-y: auto;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			box-shadow: var(--shadow-md), var(--edge-hi);
			padding: 1rem 0.9rem;
		}
		.rail.toc {
			flex: 0 0 13rem;
		}
		.rail.panel {
			flex: 0 0 17rem;
		}
	}
	.rail-tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.8rem;
	}
	.rail-tabs button {
		flex: 1;
		padding: 0.3rem 0.5rem;
		font-size: var(--text-sm);
		font-weight: 500;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.rail-tabs button:hover {
		color: var(--text);
		background: var(--surface-alt);
	}
	.rail-tabs button.active {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.nb-note {
		display: block;
		margin-bottom: 1.2rem;
	}
	.nb-note span {
		display: block;
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 0.4rem;
	}
	.nb-note textarea {
		width: 100%;
		resize: vertical;
		padding: 0.5rem 0.6rem;
		font: inherit;
		font-size: var(--text-sm);
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.nb-note textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.hl-list {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.hl-item {
		position: relative;
		padding: 0.5rem 1.6rem 0.5rem 0.7rem;
		border-radius: var(--radius);
		background: var(--surface-alt);
		border-left: 3px solid var(--hl, var(--accent));
	}
	.hl-item[data-color='yellow'] {
		--hl: #e0b341;
	}
	.hl-item[data-color='blue'] {
		--hl: #4f8edc;
	}
	.hl-item[data-color='green'] {
		--hl: #5fae6a;
	}
	.hl-item[data-color='pink'] {
		--hl: #d97aa6;
	}
	.hl-item[data-color='orange'] {
		--hl: #e08a3c;
	}
	.hl-text {
		display: block;
		text-align: left;
		border: 0;
		background: transparent;
		padding: 0;
		font: inherit;
		font-size: var(--text-sm);
		line-height: 1.4;
		color: var(--text);
		cursor: pointer;
	}
	.hl-note {
		margin: 0.35rem 0 0;
		font-size: var(--text-2xs);
		color: var(--text-muted);
	}
	.hl-del {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		display: inline-flex;
		border: 0;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.15rem;
		border-radius: var(--radius-sm);
	}
	.hl-del:hover {
		color: var(--error);
		background: var(--surface);
	}
	.hl-popover {
		position: fixed;
		left: var(--x);
		top: var(--y);
		transform: translate(-50%, calc(-100% - 8px));
		z-index: 40;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--bg);
		background: var(--text);
		border: 0;
		border-radius: var(--radius-full);
		box-shadow: var(--shadow);
		cursor: pointer;
	}
	.doc :global(mark.lectern-hl) {
		background: color-mix(in srgb, var(--hl, #e0b341) 38%, transparent);
		color: inherit;
		border-radius: 2px;
		padding: 0.05em 0;
	}
	.doc :global(mark.lectern-hl[data-color='blue']) {
		--hl: #4f8edc;
	}
	.doc :global(mark.lectern-hl[data-color='green']) {
		--hl: #5fae6a;
	}
	.doc :global(mark.lectern-hl[data-color='pink']) {
		--hl: #d97aa6;
	}
	.doc :global(mark.lectern-hl[data-color='orange']) {
		--hl: #e08a3c;
	}
</style>
