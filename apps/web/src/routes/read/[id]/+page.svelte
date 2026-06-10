<script lang="ts">
	import type { Card } from '@lectern/shared';
	import { onMount, tick } from 'svelte';
	import DOMPurify from 'dompurify';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto, afterNavigate, beforeNavigate } from '$app/navigation';
	import { db } from '$lib/db';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import { activeList, type ListController } from '$lib/list-controller.svelte';
	import type { Location, Highlight, NewHighlight } from '@lectern/shared';
	import { serializeRange, renderHighlights } from '$lib/highlight';
	import { cleanArticleHtml } from '$lib/article-html';
	import { liveQuery } from 'dexie';
	import { readingQueue } from '$lib/reading-queue.svelte';
	import { ttsPlayer } from '$lib/tts-player.svelte';
	import { readerSettings } from '$lib/reader-settings.svelte';
	import {
		readerCssVars,
		readerThemeAttr,
		FONT_LABELS,
		THEME_SWATCHES,
		type FontFamily,
		type ThemeMode
	} from '$lib/typography';
	import {
		childSelector,
		computePercent,
		nearestAnchor,
		type AnchorCandidate
	} from '$lib/progress';
	import { displayAuthor } from '$lib/author';
	import TagEditor from '$lib/components/TagEditor.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { scrollIntoViewMotion, scrollBehavior } from '$lib/motion';

	const id = $derived(page.params.id);

	// Re-subscribe a liveQuery per document so `card` stays reactive to optimistic
	// mutations AND switches when the route id changes (reader→reader nav). The
	// effect's cleanup tears down the previous subscription.
	let card = $state<Card | undefined>(undefined);
	$effect(() => {
		const current = id;
		if (!current) {
			card = undefined;
			return;
		}
		const sub = liveQuery(() => db.cards.get(current)).subscribe({
			next: (v) => {
				card = v;
			}
		});
		return () => sub.unsubscribe();
	});

	// Adaptive accent: when enabled, fetch this document's cover-derived accent
	// (computed + cached server-side) and tint the reader pane with it. Best-effort
	// — any failure (offline, no cover, no usable colour) just leaves the theme
	// accent in place.
	let accentColor = $state<string | null>(null);
	$effect(() => {
		const current = id;
		accentColor = null;
		if (!current || !readerSettings.current.adaptiveAccent) return;
		let cancelled = false;
		void getClient()
			.getDocumentAccent(current)
			.then((r) => {
				if (!cancelled) accentColor = r.color;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});
	// Override the pane's accent custom properties when an adaptive colour is live.
	const accentStyle = $derived(
		readerSettings.current.adaptiveAccent && accentColor
			? `--accent:${accentColor};--accent-soft:color-mix(in srgb, ${accentColor} 16%, transparent)`
			: ''
	);

	let html = $state('');
	let error = $state<string | undefined>(undefined);
	let loading = $state(true);
	let refetching = $state(false);
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
	let panelOpen = $state(loadBool('lectern.reader.panel', false));
	let focusMode = $state(loadBool('lectern.reader.focus', false));
	let headings = $state<{ id: string; text: string; level: number }[]>([]);
	let activeHeading = $state('');
	let highlights = $state<Highlight[]>([]);
	let panelTab = $state<'info' | 'notebook'>('info');
	let selRect = $state<{ x: number; y: number } | null>(null);
	let pendingHighlight: NewHighlight | null = null;
	let hlError = $state<NewHighlight | null>(null);
	let noteDraft = $state('');
	let noteSeededFor: string | undefined = undefined;
	let findOpen = $state(false);
	let findQuery = $state('');
	let findHits = $state<HTMLElement[]>([]);
	let findIndex = $state(0);
	let findTimer: ReturnType<typeof setTimeout> | undefined;
	let findInputEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('lectern.reader.toc', tocOpen ? '1' : '0');
		localStorage.setItem('lectern.reader.panel', panelOpen ? '1' : '0');
		localStorage.setItem('lectern.reader.focus', focusMode ? '1' : '0');
	});

	const styleVars = $derived(
		Object.entries(readerCssVars(readerSettings.current))
			.map(([k, v]) => `${k}:${v}`)
			.join(';')
	);

	const FONTS = (Object.keys(FONT_LABELS) as FontFamily[]).map((value) => ({
		value,
		label: FONT_LABELS[value].label
	}));

	const THEMES = (Object.keys(THEME_SWATCHES) as ThemeMode[]).map((value) => ({
		value,
		label: THEME_SWATCHES[value].label
	}));

	// Reader-pane theme: the explicit override, or the app theme when matching.
	const readerThemeValue = $derived(
		readerThemeAttr(readerSettings.current.theme, readerSettings.current.readerTheme)
	);

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
		applyFocusClass();
		scrollIntoViewMotion(blocks[focusIndex], { block: 'center' });
	}

	// Focus mode dims every block but the focused one; the class drives the CSS.
	function applyFocusClass() {
		for (let i = 0; i < blocks.length; i++)
			blocks[i].classList.toggle('lectern-focus', focusMode && i === focusIndex);
	}

	function toggleFocusMode() {
		focusMode = !focusMode;
		// Anchor focus to the block nearest the top so dimming has a subject, but
		// don't scroll — keep the reader where they are.
		if (focusMode && focusIndex < 0 && blocks.length) {
			focusIndex = nearestBlock();
			updateBar();
		}
		applyFocusClass();
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
		// Space / Shift+Space (paragraph advance) and j/k flow through the global key
		// layer to this view's controller.move — handled there, not here, so they stay
		// unified with the lists and never double-fire.
		if (e.key === '[') {
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
		} else if (e.key === 'f' || e.key === 'F') {
			toggleFocusMode();
			e.preventDefault();
		} else if (e.key === 'r' || e.key === 'R') {
			// Re-extract the article from the original source (incomplete/broken capture).
			void refetchContent();
			e.preventDefault();
		}
	}

	// Layered Escape: close the topmost reader overlay (Display popover, find bar,
	// highlight popover) instead of leaving the reader. Capture phase so it runs
	// before the layout's bubble-phase Escape-goes-back shortcut.
	function onEscapeCapture(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (showDisplay) {
			showDisplay = false;
		} else if (findOpen) {
			closeFind();
		} else if (selRect) {
			selRect = null;
			pendingHighlight = null;
			window.getSelection()?.removeAllRanges();
		} else {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
	}

	// In-document find (Cmd/Ctrl+F). Matches are wrapped in <mark.find-hit> by
	// walking the article's text nodes; clearFind() fully unwraps them so the
	// article (and the existing mark.lectern-hl highlights) are never corrupted.
	function onFindKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && !isEditable(e.target)) {
			e.preventDefault();
			void openFind();
		}
	}

	async function openFind() {
		findOpen = true;
		await tick();
		findInputEl?.focus();
		findInputEl?.select();
	}

	function closeFind() {
		findOpen = false;
		findQuery = '';
		clearFind();
		findHits = [];
		findIndex = 0;
	}

	/** Unwrap every find mark, restoring the original text + node structure. */
	function clearFind() {
		if (!articleEl) return;
		for (const m of Array.from(articleEl.querySelectorAll('mark.find-hit'))) {
			const parent = m.parentNode;
			if (!parent) continue;
			while (m.firstChild) parent.insertBefore(m.firstChild, m);
			parent.removeChild(m);
			parent.normalize();
		}
	}

	function onFindInput() {
		if (findTimer) clearTimeout(findTimer);
		findTimer = setTimeout(runFind, 120);
	}

	function onFindKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFind();
		} else if (e.key === 'Enter' || e.key === 'ArrowDown') {
			e.preventDefault();
			findStep(e.key === 'Enter' && e.shiftKey ? -1 : 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			findStep(-1);
		}
	}

	/** Wrap every case-insensitive occurrence of `q` in one text node. */
	function wrapMatches(node: Text, q: string): HTMLElement[] {
		const lower = node.data.toLowerCase();
		const offsets: number[] = [];
		for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) offsets.push(i);
		const marks: HTMLElement[] = [];
		// Split from the last match back so earlier offsets stay valid.
		for (let i = offsets.length - 1; i >= 0; i--) {
			const after = node.splitText(offsets[i]);
			after.splitText(q.length);
			const mark = document.createElement('mark');
			mark.className = 'find-hit';
			after.parentNode?.insertBefore(mark, after);
			mark.appendChild(after);
			marks.unshift(mark);
		}
		return marks;
	}

	function runFind() {
		clearFind();
		findIndex = 0;
		const q = findQuery.trim().toLowerCase();
		if (!articleEl || !q) {
			findHits = [];
			return;
		}
		const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) =>
				n.nodeValue && n.nodeValue.trim() && !n.parentElement?.closest('mark.lectern-hl')
					? NodeFilter.FILTER_ACCEPT
					: NodeFilter.FILTER_REJECT
		});
		const nodes: Text[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
		const hits: HTMLElement[] = [];
		for (const node of nodes) hits.push(...wrapMatches(node, q));
		findHits = hits;
		markCurrent(true);
	}

	function markCurrent(scroll: boolean) {
		findHits.forEach((m, i) => m.classList.toggle('current', i === findIndex));
		if (scroll) findHits[findIndex]?.scrollIntoView({ block: 'center' });
	}

	function findStep(delta: number) {
		if (!findHits.length) return;
		findIndex = (findIndex + delta + findHits.length) % findHits.length;
		markCurrent(true);
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
		scrollIntoViewMotion(document.getElementById(hid), { block: 'start' });
	}

	async function addHighlight(nh: NewHighlight) {
		if (!id || !articleEl) return;
		try {
			const created = await getClient().createHighlight(id, nh);
			highlights = [...highlights, created];
			renderHighlights(articleEl, highlights);
			hlError = null;
		} catch {
			// Direct API call (not sync-queued), so the global sync chip won't cover
			// it. Surface an inline retry instead of failing silently.
			hlError = nh;
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
		// Seed the note editor once per document (keyed on the card id), so a
		// reader→reader switch re-seeds with the new doc's note without clobbering
		// an in-progress edit on the same doc.
		if (card && noteSeededFor !== card.id) {
			noteDraft = card.note ?? '';
			noteSeededFor = card.id;
		}
	});

	// Keyboard control while reading: j/k (and arrows) scroll, e/l/s/i triage the
	// current document and (per setting) advance to the next queued doc or go
	// back. Wired through the same global key layer the lists use.
	const controller: ListController = {
		move(delta) {
			// j/k and arrows move the paragraph focus; fall back to scrolling pre-render.
			if (!advance(delta)) {
				window.scrollBy({
					top: delta * Math.round(window.innerHeight * 0.1),
					behavior: scrollBehavior()
				});
			}
		},
		open() {},
		triage(location: Location) {
			if (!card) return;
			const fromId = card.id;
			const sync = getSync();
			void sync.enqueue({ type: 'setLocation', id: fromId, location }).then(() => sync.flush());
			advanceOrBack(fromId);
		},
		back: goBack
	};

	/** After triaging, jump to the next queued document (if enabled) else go back. */
	function advanceOrBack(fromId: string) {
		if (readerSettings.current.autoAdvance) {
			const next = readingQueue.nextAfter(fromId);
			if (next && next !== fromId) {
				void goto(resolve('/read/[id]', { id: next }));
				return;
			}
		}
		goBack();
	}

	/**
	 * Load (or reload) the document for the current route id. The reader is a
	 * single reused component across reader→reader navigation, so this resets all
	 * per-document state. The `docId !== id` guards bail out of a stale load when
	 * the user navigates again before this one resolves.
	 */
	/** Re-extract the current article from its original source, replacing the cached
	 *  copy. For when the stored capture is partial or mis-rendered. */
	async function refetchContent() {
		if (refetching || !id) return;
		refetching = true;
		try {
			await loadDoc(true);
		} finally {
			refetching = false;
		}
	}

	/** Publish this article to the podcast feed: renders audio server-side and adds
	 *  an episode. Deliberately does NOT start playback — feedback is the rail button
	 *  flipping to a check on success. */
	let podcastState = $state<'idle' | 'busy' | 'done' | 'error'>('idle');
	let podcastMsg = $state<string | undefined>(undefined);
	async function addToPodcast() {
		if (!card || podcastState === 'busy') return;
		podcastState = 'busy';
		podcastMsg = 'Rendering audio for your podcast feed…';
		try {
			await getClient().addToPodcast(card.id, card.title);
			podcastState = 'done';
			podcastMsg = 'Added to your podcast feed.';
		} catch (err) {
			podcastState = 'error';
			podcastMsg = err instanceof Error ? err.message : 'Could not add to the podcast feed.';
		}
	}

	async function loadDoc(refresh = false) {
		const docId = id;
		if (!docId) {
			error = 'Missing document id';
			loading = false;
			return;
		}
		loading = true;
		error = undefined;
		ready = false;
		html = '';
		progress = 0;
		focusIndex = -1;
		blocks = [];
		headings = [];
		activeHeading = '';
		highlights = [];
		selRect = null;
		pendingHighlight = null;
		if (findOpen) closeFind();
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
		window.scrollTo(0, 0);

		const initial = await db.cards.get(docId);
		if (docId !== id) return;
		// Mark RSS items seen on open (Readwise behaviour): flip MiniFlux read
		// state so the item leaves the unread feed / newspaper edition.
		if (initial && initial.source === 'miniflux' && initial.readState !== 'finished') {
			const seen = getSync();
			void seen.enqueue({ type: 'markRead', id: initial.id, read: true }).then(() => seen.flush());
		}
		try {
			const content = await getClient().getContent(docId, refresh ? { refresh: true } : undefined);
			if (docId !== id) return;
			// Sanitize before rendering untrusted article HTML on the client, then
			// drop the duplicated leading h1 / demote in-content h1s.
			html = cleanArticleHtml(DOMPurify.sanitize(content.html), initial?.title);
		} catch (err) {
			if (docId !== id) return;
			error = err instanceof Error ? err.message : String(err);
		} finally {
			if (docId === id) loading = false;
		}
		await tick();
		if (docId !== id || error) return;
		restore(initial);
		const m = scrollMetrics();
		progress = computePercent(m.scrollTop, m.scrollHeight, m.clientHeight);
		ready = true;
		collectBlocks();
		buildToc();
		try {
			const hl = (await getClient().listHighlights(docId)).highlights;
			if (docId !== id) return;
			highlights = hl;
			renderHighlights(articleEl as HTMLElement, highlights);
		} catch {
			/* offline: highlights load on the next visit */
		}
	}

	onMount(() => {
		activeList.set(controller);
		// Global listeners live for the component's whole life; they no-op while
		// !ready, so they stay attached across reader→reader reloads.
		window.addEventListener('keydown', onEscapeCapture, true);
		window.addEventListener('keydown', onFindKey);
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('keydown', onKey);
		window.addEventListener('resize', updateBar);
		document.addEventListener('mouseup', onMouseUp);
		return () => {
			activeList.clear(controller);
			capture();
			if (timer) clearTimeout(timer);
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener('keydown', onEscapeCapture, true);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', updateBar);
			document.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('keydown', onFindKey);
			if (findTimer) clearTimeout(findTimer);
			clearFind();
		};
	});

	// Persist the outgoing doc's progress before the route changes, then load the
	// new doc. afterNavigate also fires once after the initial mount.
	beforeNavigate(() => capture());
	afterNavigate(() => {
		if (page.params.id) void loadDoc();
	});
</script>

<div class="progress" aria-hidden="true" style={`--p:${progress}`}></div>

<nav class="bar">
	<button class="back" type="button" onclick={goBack} aria-label="Back">
		<Icon name="back" size={18} />
		<span>Back</span>
	</button>
	<span class="sr-status" role="status" aria-live="polite">
		{podcastState === 'idle' ? '' : podcastMsg}
	</span>
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
		<button
			type="button"
			class="rail-btn"
			class:on={focusMode}
			aria-pressed={focusMode}
			onclick={toggleFocusMode}
			title="Focus mode ( f )"
			aria-label="Toggle focus mode"
		>
			<Icon name="book" size={16} />
		</button>
		{#if card}
			<button
				type="button"
				class="rail-btn rail-listen"
				onclick={() => ttsPlayer.listen({ id: card!.id, title: card!.title })}
				title="Listen"
				aria-label="Listen to this article"
			>
				<Icon name="headphones" size={16} />
			</button>
			<button
				type="button"
				class="rail-btn rail-podcast"
				class:on={podcastState === 'done'}
				class:spin={podcastState === 'busy'}
				disabled={podcastState === 'busy'}
				onclick={addToPodcast}
				title={podcastMsg ?? 'Add to podcast feed'}
				aria-label="Add this article to your podcast feed"
			>
				<Icon name={podcastState === 'done' ? 'check' : 'rss'} size={16} />
			</button>
		{/if}
		<button
			type="button"
			class="rail-btn rail-refetch"
			class:spin={refetching}
			onclick={refetchContent}
			disabled={refetching}
			title="Re-fetch full content from original ( r )"
			aria-label="Re-fetch full content from original"
		>
			<Icon name="refresh" size={16} />
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

{#if findOpen}
	<div class="findbar" role="search">
		<Icon name="search" size={15} />
		<input
			bind:this={findInputEl}
			class="find-input"
			type="text"
			placeholder="Find in document"
			bind:value={findQuery}
			oninput={onFindInput}
			onkeydown={onFindKeydown}
			aria-label="Find in document"
		/>
		<span class="find-count">{findHits.length ? findIndex + 1 : 0} / {findHits.length}</span>
		<button type="button" class="find-nav" aria-label="Previous match" onclick={() => findStep(-1)}>
			<Icon name="back" size={15} />
		</button>
		<button type="button" class="find-nav flip" aria-label="Next match" onclick={() => findStep(1)}>
			<Icon name="back" size={15} />
		</button>
		<button type="button" class="find-nav" aria-label="Close find" onclick={closeFind}>
			<Icon name="close" size={15} />
		</button>
	</div>
{/if}

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
	<div
		class="doc"
		class:focus-on={focusMode && focusIndex >= 0}
		class:themed={readerSettings.current.readerTheme !== 'match'}
		data-theme={readerThemeValue}
		style={`${styleVars};${accentStyle}`}
		bind:this={docEl}
	>
		{#if focusIndex >= 0}
			<div class="focus-bar" style={`--top:${barTop}px;--h:${barH}px`} aria-hidden="true"></div>
		{/if}
		{#if card}
			<h1>{card.title}</h1>
			<p class="byline">
				{card.siteName ?? (card.author ? displayAuthor(card.author) : new URL(card.url).hostname)}
				{#if card.readingTimeMinutes}<span class="dot">·</span>{card.readingTimeMinutes} min read{/if}
			</p>
			<div class="tageditor"><TagEditor id={card.id} tags={card.tags} /></div>
		{/if}

		{#if loading}
			<div class="sk" aria-hidden="true">
				<span class="sk-line sk-title"></span>
				<span class="sk-line"></span>
				<span class="sk-line"></span>
				<span class="sk-line sk-short"></span>
				<span class="sk-line"></span>
				<span class="sk-line"></span>
				<span class="sk-line sk-short"></span>
			</div>
		{:else if error}
			<div class="state-err" role="alert">
				<h2>Couldn't load this article.</h2>
				<p>The text couldn't be fetched. Check your connection or open the original.</p>
				<div class="err-actions">
					<button
						type="button"
						class="err-btn primary"
						onclick={refetchContent}
						disabled={refetching}
					>
						Retry
					</button>
					{#if card}
						<!-- card.url is an external absolute URL, not an internal route -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="err-btn" href={card.url} target="_blank" rel="noopener noreferrer"
							>Open original</a
						>
					{/if}
				</div>
				<p class="err-detail">{error}</p>
			</div>
		{:else}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<article class="lectern-prose" bind:this={articleEl}>{@html html}</article>
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
						<dd>{displayAuthor(card.author)}</dd>
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
					<dd>
						{Math.round(progress * 100)}%{#if card.readingTimeMinutes}
							· ~{Math.max(0, Math.ceil(card.readingTimeMinutes * (1 - progress)))} min left{/if}
					</dd>
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
									scrollIntoViewMotion(document.querySelector(`mark[data-hl="${h.id}"]`), {
										block: 'center'
									})}>{h.text}</button
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

{#if hlError}
	<div class="hl-toast" role="status">
		<span>Couldn't save highlight.</span>
		<button
			type="button"
			class="hl-retry"
			onclick={() => {
				const nh = hlError;
				hlError = null;
				if (nh) void addHighlight(nh);
			}}>Retry</button
		>
		<button type="button" class="hl-toast-x" aria-label="Dismiss" onclick={() => (hlError = null)}>
			<Icon name="close" size={13} />
		</button>
	</div>
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
		width: 100%;
		background: var(--accent);
		transform-origin: left center;
		transform: scaleX(var(--p));
		transition: transform 80ms linear;
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
		background: var(--bg);
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
		min-height: 2.75rem;
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

	/* Focus mode: spotlight the focused block by fading the rest of the prose.
	   Uses colour (not opacity) so nested blocks never double-dim. */
	.doc.focus-on article {
		color: color-mix(in srgb, var(--text) 30%, var(--bg));
		transition: color var(--dur) var(--ease);
	}
	.doc.focus-on article :global(.lectern-focus) {
		color: var(--text);
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
	/* The Display popover specifically (the Info side rail also carries .panel):
	   a touch wider so three columns of labels fit, and never taller than the
	   viewport — scroll instead of clipping. */
	.bar .panel {
		width: min(22rem, 92vw);
		max-height: calc(100dvh - 7rem);
		overflow-y: auto;
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
	/* Wrap the segments into an even grid so long labels (Newsprint, Contrast,
	   OpenDyslexic) never clip off the popover edge. */
	.seg {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: 0.25rem;
		padding: 0.2rem;
		background: var(--surface-alt);
		border-radius: var(--radius);
	}
	.seg button {
		min-width: 0;
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
	/* Reader-only theme: when the pane overrides the app theme, paint its own
	   surface (data-theme on .doc rescopes the palette) so the article reads as a
	   distinct page floating on the app background. */
	.doc.themed {
		background: var(--bg);
		color: var(--text);
		padding: clamp(1.25rem, 3vw, 2.5rem);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
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
		text-wrap: balance;
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
	.sk {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 0.4rem 0 0;
	}
	.sk-line {
		height: 0.9rem;
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
		height: 1.6rem;
		width: 70%;
		margin-bottom: 0.8rem;
	}
	.sk-short {
		width: 45%;
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
	.state-err {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 1.5rem 0;
	}
	.state-err h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.3em;
		color: var(--text);
	}
	.state-err p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.err-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.err-btn {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
	.err-btn:hover {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.err-btn.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.err-btn.primary:hover {
		background: var(--accent-deep);
	}
	.err-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.err-detail {
		margin-top: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--text-muted);
	}
	.hl-toast {
		position: fixed;
		left: 50%;
		bottom: 1.5rem;
		transform: translateX(-50%);
		z-index: 60;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem 0.4rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow);
		font-size: var(--text-sm);
		color: var(--text);
	}
	.hl-retry,
	.hl-toast-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.35rem 0.6rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease);
	}
	.hl-retry {
		color: var(--accent);
		font-weight: 600;
		font-size: var(--text-sm);
	}
	.hl-retry:hover,
	.hl-toast-x:hover {
		background: var(--surface-alt);
	}
	.hl-toast-x {
		min-width: 2.75rem;
		color: var(--text-muted);
	}

	/* Surface plumbing only — all content styling lives in the shared
	   .lectern-prose layer (lib/styles/prose.css). */
	article {
		font-family: var(--reader-font);
		font-size: var(--reader-size);
		line-height: calc(var(--reader-leading) + var(--prose-leading-boost, 0));
		letter-spacing: var(--reader-tracking, 0);
		word-spacing: var(--reader-word-spacing, 0);
	}

	@media (max-width: 820px) {
		.progress {
			left: 0;
		}
		.bar {
			position: static;
		}
	}
	.sr-status {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.rail-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
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
	.rail-btn:disabled {
		cursor: default;
	}
	.rail-btn.spin :global(svg) {
		animation: rail-spin 0.8s linear infinite;
	}
	@keyframes rail-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rail-btn.spin :global(svg) {
			animation: none;
		}
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
		border-left: 0;
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
		font-weight: 600;
		background: var(--accent-soft);
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
		.rail-btn:not(.rail-listen):not(.rail-refetch) {
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
			top: 3.6rem;
			max-height: calc(100vh - 5rem);
			overflow-y: auto;
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
	/* Marker-on-paper on light themes (solid ink, multiplied); translucent tint
	   on dark themes. --hl-mix / --hl-blend come from the theme blocks in app.css
	   and re-scope when .doc overrides the app theme via data-theme. */
	.doc :global(mark.lectern-hl) {
		background: color-mix(in srgb, var(--hl, #e0b341) var(--hl-mix, 100%), transparent);
		mix-blend-mode: var(--hl-blend, multiply);
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
	.findbar {
		position: fixed;
		top: 3.4rem;
		right: 1.25rem;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.45rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		color: var(--text-muted);
	}
	.find-input {
		width: 12rem;
		padding: 0.2rem 0.25rem;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-sm);
		outline: none;
	}
	.find-count {
		min-width: 3.2rem;
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		text-align: center;
	}
	.find-nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.find-nav:hover {
		color: var(--text);
		background: var(--surface-alt);
	}
	.find-nav.flip {
		transform: scaleX(-1);
	}
	.doc :global(mark.find-hit) {
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		border-radius: 2px;
	}
	.doc :global(mark.find-hit.current) {
		background: var(--accent);
		color: var(--accent-contrast);
	}
</style>
