# Phase C — Reading Flow and Chrome

Read `README.md` in this directory first (guardrails, verification, commit rules).
C3 depends on C2; C7 depends on C6 (shared import block). C3 and C8 pair at ≤640px.
If quoted "Current code" does not match the file, stop and report the mismatch.

---

### C1: Add end-of-article block (end mark + triage row + Next up card)

**Priority:** P0 (review item #4) · **Depends on:** nothing
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** The article currently ends at the source's last line — no end mark, no triage, no next-up. Auto-advance exists only via invisible keyboard triage (`e`/`l`/`s` → `controller.triage` → `advanceOrBack`, lines 538-558). The reading queue already exists: `readingQueue.nextAfter(id)` (`$lib/reading-queue.svelte.ts`, populated by `ListView.snapshotQueue()`), so no new queue helper is needed — only a lookup of the next card from the local Dexie mirror (`db.cards.get`).

**Steps:**

1. `apps/web/src/routes/read/[id]/+page.svelte:549-558` — add the next-card state directly AFTER the `advanceOrBack` function.

   Current code:
   ```ts
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
   ```
   Change to:
   ```ts
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

   	// End-of-article "Next up": the document after this one in the reading queue
   	// (the snapshot of the list the reader came from), looked up in the local
   	// Dexie mirror. Undefined when last-in-queue or opened via a direct link.
   	const nextId = $derived(card ? readingQueue.nextAfter(card.id) : undefined);
   	let nextCard = $state<Card | undefined>(undefined);
   	$effect(() => {
   		const nid = nextId;
   		if (!nid) {
   			nextCard = undefined;
   			return;
   		}
   		let cancelled = false;
   		void db.cards.get(nid).then((c) => {
   			if (!cancelled) nextCard = c;
   		});
   		return () => {
   			cancelled = true;
   		};
   	});
   ```

2. `apps/web/src/routes/read/[id]/+page.svelte:959-962` — render the block after `</article>`. It lives inside the existing `{:else}` branch of `{#if loading}…{:else if error}…`, so it is automatically hidden while content loads or on error (the "hide while loading" requirement — do not add an extra flag).

   Current code:
   ```svelte
   		{:else}
   			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
   			<article bind:this={articleEl}>{@html html}</article>
   		{/if}
   ```
   Change to (keep any class additions from A9/B2/B7 on the `<article>` line if already applied):
   ```svelte
   		{:else}
   			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
   			<article bind:this={articleEl}>{@html html}</article>
   			<footer class="endmatter">
   				<span class="end-mark" aria-hidden="true">&#10086;</span>
   				{#if card}
   					<div class="end-triage" role="group" aria-label="Triage this document">
   						<button type="button" class="err-btn" onclick={() => controller.triage('archive')} title="Archive ( e )">
   							Archive
   						</button>
   						<button type="button" class="err-btn" onclick={() => controller.triage('later')} title="Later ( l )">
   							Later
   						</button>
   						<button type="button" class="err-btn" onclick={() => controller.triage('shortlist')} title="Shortlist ( s )">
   							Shortlist
   						</button>
   					</div>
   				{/if}
   				{#if nextCard}
   					<a class="next-up" href={resolve('/read/[id]', { id: nextCard.id })}>
   						<span class="next-kicker">Next up</span>
   						<span class="next-title">{nextCard.title}</span>
   						<span class="next-meta">
   							{nextCard.siteName ?? new URL(nextCard.url).hostname}
   							{#if nextCard.readingTimeMinutes}<span class="dot">·</span>{nextCard.readingTimeMinutes} min read{/if}
   						</span>
   					</a>
   				{/if}
   			</footer>
   		{/if}
   ```
   Notes: `&#10086;` is ❦ (floral heart — distinct from FlipReader's ❧). `controller.triage(...)` is the existing function (line 538) — it enqueues `setLocation` and calls `advanceOrBack`, exactly like the `e`/`l`/`s` keys. `.err-btn` is the existing hairline button class in this component (line 1374). `.dot` already exists (line 1303). `Location` values `'archive' | 'later' | 'shortlist'` are valid per `packages/shared/src/model.ts:23`.

3. `apps/web/src/routes/read/[id]/+page.svelte:1408-1413` — add the styles AFTER the `.err-detail` rule.

   Current code:
   ```css
   	.err-detail {
   		margin-top: 0.5rem;
   		font-family: var(--font-mono);
   		font-size: var(--text-2xs);
   		color: var(--text-muted);
   	}
   ```
   Change to:
   ```css
   	.err-detail {
   		margin-top: 0.5rem;
   		font-family: var(--font-mono);
   		font-size: var(--text-2xs);
   		color: var(--text-muted);
   	}
   	/* End-of-article: quiet end mark, triage row, next-up card. */
   	.endmatter {
   		margin: 3em 0 2em;
   		display: flex;
   		flex-direction: column;
   		align-items: center;
   		gap: 1.4rem;
   	}
   	.end-mark {
   		font-family: var(--font-serif);
   		font-size: 1.1rem;
   		line-height: 1;
   		color: var(--text-muted);
   		user-select: none;
   	}
   	.end-triage {
   		display: flex;
   		flex-wrap: wrap;
   		justify-content: center;
   		gap: 0.6rem;
   	}
   	.next-up {
   		display: flex;
   		flex-direction: column;
   		gap: 0.25rem;
   		width: 100%;
   		max-width: 26rem;
   		padding: 0.85rem 1rem;
   		border: 1px solid var(--border);
   		border-radius: var(--radius);
   		color: var(--text);
   		text-decoration: none;
   		transition:
   			border-color var(--dur-fast) var(--ease),
   			background var(--dur-fast) var(--ease);
   	}
   	.next-up:hover {
   		border-color: var(--border-strong);
   		background: var(--surface-alt);
   	}
   	.next-kicker {
   		font-size: var(--text-2xs);
   		font-weight: 600;
   		letter-spacing: 0.06em;
   		text-transform: uppercase;
   		color: var(--text-muted);
   	}
   	.next-title {
   		font-family: var(--font-serif);
   		font-size: var(--text-md);
   		line-height: 1.3;
   	}
   	.next-meta {
   		font-size: var(--text-sm);
   		color: var(--text-muted);
   	}
   ```

**Do not:** add a new queue helper or modify `reading-queue.svelte.ts`; add new sync mutation types (reuse `controller.triage`); show the block in the loading or error branches; use accent-colored ornaments (end mark is `--text-muted`).
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open a document from Inbox (desktop + 390px) — after the last paragraph see ❦, three bordered buttons, and a Next up card with the following list item's title/source/min read; clicking the card navigates to that doc; clicking Archive triages and auto-advances (autoAdvance on) or goes back (off). Open a doc via direct URL (no queue) — no Next up card, triage row still present. While the skeleton is shimmering, no end block is visible.
**Acceptance:**
- End mark, triage row, Next up card render after the article, centered, hairline-quiet.
- Triage buttons perform the identical action as `e`/`l`/`s` (sync enqueue + advanceOrBack).
- Next up card shows title + source + reading time, navigates to `/read/<id>`.
- Block absent while loading, on error, and the card absent when no next document exists.

---

### C2: Reduce the reader top bar to Back · TOC · Info · Focus · "…" · Display

**Priority:** P1 · **Depends on:** nothing
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** Nine persistent controls (lines 694-860). Listen, Podcast, Re-fetch, Original are occasional actions; they move into a "…" overflow menu using the exact popover pattern the Display panel already uses in this file (transparent `.display-scrim` button + absolutely-positioned panel anchored to the sticky `.bar`). No popover primitive exists elsewhere (CommandPalette is a modal), so this in-file pattern is the one to reuse. Bonus (review live finding): Escape now closes the topmost popover before exiting the reader, via the controller's `back`.

**Steps:**

1. `apps/web/src/routes/read/[id]/+page.svelte:89` — add menu state.

   Current code:
   ```ts
   	let showDisplay = $state(false);
   ```
   Change to:
   ```ts
   	let showDisplay = $state(false);
   	let menuOpen = $state(false);
   ```

2. `apps/web/src/routes/read/[id]/+page.svelte:545-546` — Escape closes popovers first (the global key layer routes Escape to `controller.back`). *Coordination: if A5 (capture-phase Escape handler) is already applied, add `menuOpen` handling to that handler instead of this step, and skip this step.*

   Current code:
   ```ts
   		back: goBack
   	};
   ```
   Change to:
   ```ts
   		back() {
   			// Escape closes the topmost reader layer before leaving the view.
   			if (showDisplay || menuOpen) {
   				showDisplay = false;
   				menuOpen = false;
   				return;
   			}
   			goBack();
   		}
   	};
   ```

3. `apps/web/src/routes/read/[id]/+page.svelte:702-788` — replace the whole `.bar-right` block (keep the preceding `.back` button and `.sr-status` span untouched, and keep the `{#if showDisplay}` block that follows).

   Current code:
   ```svelte
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
   ```
   Change to:
   ```svelte
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
   		<button
   			type="button"
   			class="rail-btn rail-more"
   			class:on={menuOpen}
   			aria-expanded={menuOpen}
   			aria-haspopup="menu"
   			onclick={() => {
   				showDisplay = false;
   				menuOpen = !menuOpen;
   			}}
   			title="More actions"
   			aria-label="More actions"
   		>
   			<Icon name="more" size={16} />
   		</button>
   		<button
   			type="button"
   			class="display-btn"
   			class:on={showDisplay}
   			aria-expanded={showDisplay}
   			onclick={() => {
   				menuOpen = false;
   				showDisplay = !showDisplay;
   			}}
   		>
   			<Icon name="sliders" size={16} />
   			<span>Display</span>
   		</button>
   	</div>

   	{#if menuOpen}
   		<button
   			type="button"
   			class="display-scrim"
   			aria-label="Close menu"
   			onclick={() => (menuOpen = false)}
   		></button>
   		<div class="more-menu" role="menu" aria-label="More actions">
   			{#if card}
   				<button
   					type="button"
   					role="menuitem"
   					class="menu-item"
   					onclick={() => {
   						ttsPlayer.listen({ id: card!.id, title: card!.title });
   						menuOpen = false;
   					}}
   				>
   					<Icon name="headphones" size={16} />
   					<span>Listen</span>
   				</button>
   				<button
   					type="button"
   					role="menuitem"
   					class="menu-item"
   					class:spin={podcastState === 'busy'}
   					disabled={podcastState === 'busy'}
   					onclick={addToPodcast}
   					title={podcastMsg ?? 'Add to podcast feed'}
   				>
   					<Icon name={podcastState === 'done' ? 'check' : 'rss'} size={16} />
   					<span>{podcastState === 'done' ? 'Added to podcast' : 'Add to podcast'}</span>
   				</button>
   			{/if}
   			<button
   				type="button"
   				role="menuitem"
   				class="menu-item"
   				disabled={refetching}
   				onclick={() => {
   					void refetchContent();
   					menuOpen = false;
   				}}
   			>
   				<Icon name="refresh" size={16} />
   				<span>Re-fetch content</span>
   			</button>
   			{#if card}
   				<!-- card.url is an external absolute URL, not an internal route -->
   				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
   				<a
   					role="menuitem"
   					class="menu-item"
   					href={card.url}
   					target="_blank"
   					rel="noopener noreferrer"
   					onclick={() => (menuOpen = false)}
   				>
   					<Icon name="external" size={16} />
   					<span>Open original</span>
   				</a>
   			{/if}
   		</div>
   	{/if}
   ```
   Note: verify an icon named `more` exists in Icon.svelte; if it does not, use an existing ellipsis-style icon name from that file (check `grep -o "name === '[a-z-]*'" apps/web/src/lib/components/Icon.svelte` or its icon map) and report which one you used.

4. `apps/web/src/routes/read/[id]/+page.svelte:1129-1154` — remove the now-dead `.orig` selectors (Svelte warns on unused scoped CSS).

   Current code:
   ```css
   	.back,
   	.orig,
   	.display-btn {
   ```
   Change to:
   ```css
   	.back,
   	.display-btn {
   ```
   And current code:
   ```css
   	.back:hover,
   	.orig:hover,
   	.display-btn:hover,
   	.display-btn.on {
   ```
   Change to:
   ```css
   	.back:hover,
   	.display-btn:hover,
   	.display-btn.on {
   ```

5. `apps/web/src/routes/read/[id]/+page.svelte:1155-1159` — add menu CSS after `.bar-right`.

   Current code:
   ```css
   	.bar-right {
   		display: flex;
   		align-items: center;
   		gap: 0.3rem;
   	}
   ```
   Change to:
   ```css
   	.bar-right {
   		display: flex;
   		align-items: center;
   		gap: 0.3rem;
   	}
   	/* Overflow "…" menu: same scrim + bar-anchored popover pattern as Display. */
   	.more-menu {
   		position: absolute;
   		top: calc(100% + 0.3rem);
   		right: 0;
   		z-index: 25;
   		min-width: 13.5rem;
   		display: flex;
   		flex-direction: column;
   		gap: 1px;
   		padding: 0.35rem;
   		background: var(--surface);
   		border: 1px solid var(--border);
   		border-radius: var(--radius-lg);
   		box-shadow: var(--shadow);
   	}
   	.menu-item {
   		display: flex;
   		align-items: center;
   		gap: 0.6rem;
   		width: 100%;
   		min-height: 2.75rem;
   		padding: 0.45rem 0.6rem;
   		border: 0;
   		border-radius: var(--radius);
   		background: transparent;
   		color: var(--text);
   		font-size: var(--text-sm);
   		font-weight: 500;
   		text-align: left;
   		text-decoration: none;
   		cursor: pointer;
   		transition:
   			background var(--dur-fast) var(--ease),
   			color var(--dur-fast) var(--ease);
   	}
   	.menu-item:hover {
   		background: var(--surface-alt);
   	}
   	.menu-item:disabled {
   		opacity: 0.6;
   		cursor: default;
   	}
   	.menu-item :global(svg) {
   		flex-shrink: 0;
   		color: var(--text-muted);
   	}
   ```

6. `apps/web/src/routes/read/[id]/+page.svelte:1602-1614` — repoint the spin animation from the removed rail buttons to the podcast menu item.

   Current code:
   ```css
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
   ```
   Change to:
   ```css
   	.menu-item.spin :global(svg) {
   		animation: rail-spin 0.8s linear infinite;
   	}
   	@keyframes rail-spin {
   		to {
   			transform: rotate(360deg);
   		}
   	}
   	@media (prefers-reduced-motion: reduce) {
   		.menu-item.spin :global(svg) {
   			animation: none;
   		}
   	}
   ```

7. `apps/web/src/routes/read/[id]/+page.svelte:1697-1701` — keep the "…" button visible on small screens (where the rails don't exist).

   Current code:
   ```css
   	@media (max-width: 979px) {
   		.rail-btn:not(.rail-listen):not(.rail-refetch) {
   			display: none;
   		}
   	}
   ```
   Change to:
   ```css
   	@media (max-width: 979px) {
   		.rail-btn:not(.rail-more) {
   			display: none;
   		}
   	}
   ```

**Do not:** create a new shared popover component or modify CommandPalette; remove `addToPodcast`, `refetchContent`, `ttsPlayer.listen`, `podcastState`, or the `sr-status` live region; close the menu after the podcast click (it stays open so the spinner→check feedback is visible); change the `r` keyboard shortcut.
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual desktop: bar shows exactly Back · list · info · book · … · Display; "…" opens a menu with Listen / Add to podcast / Re-fetch content / Open original; click-outside closes; Escape closes menu (and Display) without leaving the reader; second Escape goes back; podcast item spins then shows "Added to podcast". 390px: only "…" and Display (and Back) visible; menu still usable.
**Acceptance:**
- Listen, Podcast, Re-fetch, Original gone from the bar, present and functional in the "…" menu.
- TOC/Info/Focus toggles unchanged on desktop; mobile shows Back, "…", Display.
- Escape closes the topmost popover first, then exits the reader.
- No unused-CSS-selector warnings from `svelte-check`.

---

### C3: Auto-hide the reader top bar on scroll

**Priority:** P1 · **Depends on:** C2 (uses `menuOpen`)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** Chrome should yield to prose. The existing scroll listener (`onScroll`, lines 176-195, rAF block that drives the progress bar) is the piggyback point — no new listener.

**Steps:**

1. `apps/web/src/routes/read/[id]/+page.svelte:95-97` — add state next to the other bar state.

   Current code:
   ```ts
   	let barTop = $state(0);
   	let barH = $state(0);
   	let blocks: HTMLElement[] = [];
   ```
   Change to:
   ```ts
   	let barTop = $state(0);
   	let barH = $state(0);
   	let barHidden = $state(false);
   	let lastBarY = 0;
   	let blocks: HTMLElement[] = [];
   ```

2. `apps/web/src/routes/read/[id]/+page.svelte:180-184` — compute hide/reveal inside the existing rAF.

   Current code:
   ```ts
   			raf = requestAnimationFrame(() => {
   				raf = 0;
   				const m = scrollMetrics();
   				progress = computePercent(m.scrollTop, m.scrollHeight, m.clientHeight);
   				// Scroll-spy: the last heading scrolled above the top band is "active".
   ```
   Change to:
   ```ts
   			raf = requestAnimationFrame(() => {
   				raf = 0;
   				const m = scrollMetrics();
   				progress = computePercent(m.scrollTop, m.scrollHeight, m.clientHeight);
   				// Auto-hide the toolbar: hide scrolling down past 200px, reveal on
   				// scroll-up or near the top. 4px hysteresis avoids jitter.
   				if (m.scrollTop <= 200) barHidden = false;
   				else if (m.scrollTop > lastBarY + 4) barHidden = true;
   				else if (m.scrollTop < lastBarY - 4) barHidden = false;
   				lastBarY = m.scrollTop;
   				// Scroll-spy: the last heading scrolled above the top band is "active".
   ```

3. `apps/web/src/routes/read/[id]/+page.svelte:607-609` (in `loadDoc`) — reset on document switch.

   Current code:
   ```ts
   		html = '';
   		progress = 0;
   		focusIndex = -1;
   ```
   Change to:
   ```ts
   		html = '';
   		progress = 0;
   		barHidden = false;
   		lastBarY = 0;
   		focusIndex = -1;
   ```

4. `apps/web/src/routes/read/[id]/+page.svelte:694` — bind the class; never hide while a bar-anchored popover is open (the panels are absolutely positioned inside `.bar` and would fly off with it).

   Current code:
   ```svelte
   <nav class="bar">
   ```
   Change to:
   ```svelte
   <nav class="bar" class:bar-hidden={barHidden && !showDisplay && !menuOpen}>
   ```

5. `apps/web/src/routes/read/[id]/+page.svelte:1117-1128` — bar CSS: add the transform transition and hidden state.

   Current code:
   ```css
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
   ```
   Change to:
   ```css
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
   		transition: transform 180ms var(--ease);
   	}
   	.bar.bar-hidden {
   		transform: translateY(-100%);
   	}
   	@media (prefers-reduced-motion: reduce) {
   		.bar {
   			transition: none;
   		}
   	}
   ```

6. `apps/web/src/routes/read/[id]/+page.svelte:1557-1564` — the bar is currently `position: static` below 820px (it sat under the fixed app topbar). Keep that for 641-820px, but at ≤640px (where C8 hides the app topbar) make it sticky so auto-hide/reveal works on phones.

   Current code:
   ```css
   	@media (max-width: 820px) {
   		.progress {
   			left: 0;
   		}
   		.bar {
   			position: static;
   		}
   	}
   ```
   Change to:
   ```css
   	@media (max-width: 820px) {
   		.progress {
   			left: 0;
   		}
   		.bar {
   			position: static;
   		}
   	}
   	@media (max-width: 640px) {
   		/* The app top bar is hidden on the reader route at this width (see
   		   +layout.svelte), so this bar is the only chrome: sticky + auto-hiding. */
   		.bar {
   			position: sticky;
   			padding-top: calc(0.5rem + env(safe-area-inset-top));
   		}
   	}
   ```

**Do not:** add a second scroll listener; hide the fixed `.progress` bar; animate anything other than `transform`; let the bar hide while `showDisplay` or `menuOpen` is true.
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual desktop: scroll down past ~200px → bar slides up (180ms); any scroll-up → it returns; above 200px it is always visible; open Display, scroll down → bar stays. 390px (with C8 applied): same behavior, bar respects the notch safe area. With OS reduced-motion: bar snaps (no transition) but still hides/reveals.
**Acceptance:**
- Hide on scroll-down past 200px, reveal on scroll-up or < 200px, via the existing rAF.
- `transform: translateY(-100%)`, 180ms `var(--ease)`, reduced-motion = no transition.
- Popovers pin the bar open; doc switch resets to visible.

---

### C4: Panel measure guard (overlay rails below 1520px) + honest empty TOC

**Priority:** P0 (review item #8) · **Depends on:** nothing
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** With both rails open the article column (`.doc { flex: 0 1 var(--reader-width) }`, shrinkable) is crushed to ~30ch. Threshold math from the actual CSS: app sidebar `--sidebar-w` 15rem (240px) + `main` inline padding `clamp(1.1rem, 4vw, 3rem)` ×2 (96px at this width) + TOC rail 13rem (208px) + Info rail 17rem (272px) + two 2rem flex gaps (64px) + a 40rem article minimum (640px) = **1520px**. Below that (and ≥980px, where rails exist at all) open rails become fixed overlays instead of flex siblings. Empty TOC: simplest deterministic choice given no tooltip/toast primitive exists — keep the panel, auto-sized message + close hint.

**Steps:**

1. `apps/web/src/routes/read/[id]/+page.svelte:902-904` — empty-TOC copy + hint.

   Current code:
   ```svelte
   		{:else}
   			<p class="rail-empty">No headings.</p>
   		{/if}
   ```
   Change to:
   ```svelte
   		{:else}
   			<p class="rail-empty">No headings in this article.</p>
   			<p class="rail-empty">Press <kbd>[</kbd> to close.</p>
   		{/if}
   ```

2. `apps/web/src/routes/read/[id]/+page.svelte:1702-1719` — add the overlay band AFTER the existing `min-width: 980px` block (source order matters: it must override the sticky rules; its 3-class selectors also outweigh the `.panel` popover styles that currently bleed onto `aside.rail.panel`).

   Current code:
   ```css
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
   ```
   Change to:
   ```css
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
   	/* Measure guard: below 1520px the flex layout cannot hold a 40rem article
   	   beside both rails (15rem sidebar + 2×3rem main padding + 13rem + 17rem
   	   rails + 2×2rem gaps + 40rem column = 1520px), so open rails float over the
   	   content as fixed cards instead of compressing it. */
   	@media (min-width: 980px) and (max-width: 1519px) {
   		.reader.toc-open .rail.toc,
   		.reader.panel-open .rail.panel {
   			position: fixed;
   			top: 4.5rem;
   			bottom: 1.25rem;
   			max-height: none;
   			z-index: 23;
   			overflow-y: auto;
   			padding: 1rem;
   			background: var(--surface);
   			border: 1px solid var(--border);
   			border-radius: var(--radius-lg);
   			box-shadow: var(--shadow-md);
   		}
   		.reader.toc-open .rail.toc {
   			left: calc(var(--sidebar-w) + 1.25rem);
   			width: 14rem;
   		}
   		.reader.panel-open .rail.panel {
   			right: 1.25rem;
   			width: 18rem;
   		}
   	}
   ```

**Do not:** change the `display: none` default for rails below 980px; touch the `.panel` (Display popover) rules; use JS/ResizeObserver — the threshold is a pure media query; collapse the app sidebar (out of scope).
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual desktop: at ≥1520px window width, `[` + `]` open both rails as flex siblings (unchanged). Narrow the window to ~1200px: open rails float over the article with `--shadow-md`, article keeps its full measure, rails scroll internally. At 1000px both open simultaneously without crushing text. Open an article with no h2/h3: TOC shows "No headings in this article." + "Press [ to close." in an auto-sized rail.
**Acceptance:**
- Article column never drops below 40rem because of open panels at ≥980px.
- Overlay rails: fixed, `--shadow-md`, surface bg, hairline border, internally scrollable.
- Empty TOC states the fact and how to dismiss; no dead full-height empty panel content.

---

### C5: Display popover becomes a bottom sheet at ≤640px

**Priority:** P1 · **Depends on:** nothing (assumes A6's desktop clip fix; desktop untouched here)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** Live finding: at phone sizes the bar-anchored `position: absolute` popover renders below the viewport (the bar is `position: static` ≤820px, so the popover anchors to the page). A fixed bottom sheet with a visible scrim is the standard fix; `position: fixed` also makes it independent of the bar's positioning.

**Steps:**

1. `apps/web/src/routes/read/[id]/+page.svelte:1171-1193` — append a mobile media block AFTER the existing `.display-scrim` and `.panel` rules (quoted below pre-A6; if A6 landed, the `.bar .panel` override block sits between them — append after all of it).

   Current code:
   ```css
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
   ```
   Change to (same two rules, then the new media block):
   ```css
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
   	/* Phones: the bar-anchored popover would land below the viewport, so render
   	   it as a fixed bottom sheet under a visible scrim. `.bar .panel` scopes the
   	   override to the Display popover (not the aside.rail.panel). */
   	@media (max-width: 640px) {
   		.display-scrim {
   			z-index: 45;
   			background: rgba(20, 16, 10, 0.32);
   		}
   		.bar .panel {
   			position: fixed;
   			left: 0;
   			right: 0;
   			bottom: 0;
   			top: auto;
   			z-index: 46;
   			width: auto;
   			max-height: 70vh;
   			overflow-y: auto;
   			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
   			border-bottom: 0;
   			padding-bottom: calc(1rem + env(safe-area-inset-bottom));
   		}
   	}
   ```

**Do not:** change the desktop popover position/size (A6 owns the desktop clip fix); add drag-to-dismiss or new components; move the panel markup out of `nav.bar`.
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual at 390×844 emulation: tap Display → sheet rises from the bottom edge, top corners rounded `--radius-lg`, content (all fields) scrollable within 70vh, dimmed scrim behind; tapping the scrim closes it; home-indicator safe area padded. Desktop ≥641px: popover unchanged, anchored under the bar.
**Acceptance:**
- ≤640px: `position: fixed; left/right/bottom: 0; top: auto; max-height: 70vh; overflow-y: auto;` rounded top corners, visible scrim.
- All controls reachable on a phone; no popover off-viewport.
- `aside.rail.panel` (Info rail) unaffected.

---

### C6: Reader popover theme picker sets the reader override and shows the stored value

**Priority:** P1 · **Depends on:** nothing
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** Verified current behavior: the reader popover's Theme seg deliberately sets the **global app theme** (`readerSettings.update({ theme: t.value })`, line 805) and highlights `current.theme` — duplicating both the settings page's app-theme picker and its separate "Reader theme" select (`settings/+page.svelte:543-548`), and producing the live "changed the app while showing Auto" confusion. The model already supports a doc-scoped override: `readerTheme: 'match' | …` drives `.doc.themed` + `data-theme` via `readerThemeAttr` (lines 139-142, 909-910). Fix: the reader popover edits `readerTheme` only; the selected chip is always `readerSettings.current.readerTheme` (a stored value, including `match`).

**Steps:**

1. `apps/web/src/routes/read/[id]/+page.svelte:18-25` — import the `ReaderTheme` type.

   Current code:
   ```ts
   	import {
   		readerCssVars,
   		readerThemeAttr,
   		FONT_LABELS,
   		THEME_SWATCHES,
   		type FontFamily,
   		type ThemeMode
   	} from '$lib/typography';
   ```
   Change to:
   ```ts
   	import {
   		readerCssVars,
   		readerThemeAttr,
   		FONT_LABELS,
   		THEME_SWATCHES,
   		type FontFamily,
   		type ReaderTheme,
   		type ThemeMode
   	} from '$lib/typography';
   ```

2. `apps/web/src/routes/read/[id]/+page.svelte:134-137` — replace the app-theme option list with reader-theme options.

   Current code:
   ```ts
   	const THEMES = (Object.keys(THEME_SWATCHES) as ThemeMode[]).map((value) => ({
   		value,
   		label: THEME_SWATCHES[value].label
   	}));
   ```
   Change to:
   ```ts
   	// Reader-pane theme options: `match` follows the app theme; the rest override
   	// the reader pane only (doc-scoped via `.doc.themed` + data-theme), never the
   	// global app theme — that lives in Settings → Reading and the sidebar toggle.
   	const READER_THEME_OPTIONS: { value: ReaderTheme; label: string }[] = [
   		{ value: 'match', label: 'Match' },
   		...(Object.keys(THEME_SWATCHES) as ThemeMode[])
   			.filter((t): t is Exclude<ThemeMode, 'auto'> => t !== 'auto')
   			.map((t) => ({ value: t as ReaderTheme, label: THEME_SWATCHES[t].label }))
   	];
   ```

3. `apps/web/src/routes/read/[id]/+page.svelte:798-811` — rewire the seg.

   Current code:
   ```svelte
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
   ```
   Change to:
   ```svelte
   			<div class="field">
   				<span class="field-label">Reader theme</span>
   				<div class="seg">
   					{#each READER_THEME_OPTIONS as t (t.value)}
   						<button
   							type="button"
   							class:active={readerSettings.current.readerTheme === t.value}
   							aria-pressed={readerSettings.current.readerTheme === t.value}
   							onclick={() => readerSettings.update({ readerTheme: t.value })}
   						>
   							{t.label}
   						</button>
   					{/each}
   				</div>
   			</div>
   ```

**Do not:** touch `reader-settings.svelte.ts`, `typography.ts`, or the settings page; remove the `match` option; change `readerThemeAttr` / `.doc.themed` logic (lines 139-142 and 909-910 already consume `readerTheme` correctly).
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: with app theme Auto, open the reader popover — "Match" is selected. Click "Sepia": only the article pane re-themes (gets the floating `.themed` card surface), the app chrome/sidebar stays on the app theme, and "Sepia" shows selected immediately. Reload — "Sepia" still selected (stored). Click "Match" — pane follows the app theme again. The sidebar theme toggle and Settings → Theme still change the app theme and never alter this chip.
**Acceptance:**
- Reader popover theme buttons set `readerTheme` only; global app theme untouched.
- Selected chip always equals the stored `readerSettings.current.readerTheme`, including after reload.
- Stated for the record: previous code intentionally set the app theme from the reader popover; that duplication is removed in favor of the doc-scoped override.

---

### C7: Clamp the adaptive accent to ≥4.5:1 contrast against the active reader background

**Priority:** P1 · **Depends on:** C6 (same import block — apply C6 first so the quoted import matches)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts`, `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`
**Why:** Lines 77-81 inject `getDocumentAccent()`'s raw cover-derived hex as `--accent` — a pale cover color on Paper (or a dark one on Black) yields illegible links/UI. The active bg is obtained from the existing `THEME_BG` map (`typography.ts:213-220`, already mirrors app.css) keyed by the same resolved theme the component already computes (`readerThemeValue`, with `auto`/`match` resolved via `matchMedia` exactly as `chromeForTheme` does; SSR is disabled app-wide per `+layout.ts`, so `window` is safe). A matching `THEME_TEXT` map is added for the mix target.

**Steps:**

1. `apps/web/src/lib/typography.ts:213-220` — add `THEME_TEXT` and the utility functions after `THEME_BG`.

   Current code:
   ```ts
   export const THEME_BG: Record<Exclude<ThemeMode, 'auto'>, string> = {
   	light: '#f6f4ee',
   	sepia: '#f4ecd8',
   	newsprint: '#f1e4c8',
   	dark: '#1a1815',
   	black: '#000000',
   	contrast: '#000000'
   };
   ```
   Change to:
   ```ts
   export const THEME_BG: Record<Exclude<ThemeMode, 'auto'>, string> = {
   	light: '#f6f4ee',
   	sepia: '#f4ecd8',
   	newsprint: '#f1e4c8',
   	dark: '#1a1815',
   	black: '#000000',
   	contrast: '#000000'
   };

   /** Each theme's body-text colour, mirroring `--text` in app.css. Used as the
    *  mix target when clamping adaptive accents for contrast. Keep in sync. */
   export const THEME_TEXT: Record<Exclude<ThemeMode, 'auto'>, string> = {
   	light: '#2a2620',
   	sepia: '#43361f',
   	newsprint: '#2b1f10',
   	dark: '#e8e3d7',
   	black: '#dcdcdc',
   	contrast: '#ffffff'
   };

   /** Parse `#rgb` / `#rrggbb` (leading `#` optional) into 0-255 channels. */
   export function parseHex(hex: string): [number, number, number] | null {
   	const t = hex.trim().replace(/^#/, '');
   	if (/^[0-9a-f]{3}$/i.test(t)) {
   		return [parseInt(t[0] + t[0], 16), parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16)];
   	}
   	if (/^[0-9a-f]{6}$/i.test(t)) {
   		const n = parseInt(t, 16);
   		return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
   	}
   	return null;
   }

   function toHex(rgb: [number, number, number]): string {
   	return (
   		'#' +
   		rgb
   			.map((c) =>
   				Math.max(0, Math.min(255, Math.round(c)))
   					.toString(16)
   					.padStart(2, '0')
   			)
   			.join('')
   	);
   }

   /** WCAG 2.x relative luminance of an sRGB colour (channels 0-255). */
   function relativeLuminance([r, g, b]: [number, number, number]): number {
   	const lin = (c: number) => {
   		const s = c / 255;
   		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
   	};
   	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
   }

   /** WCAG contrast ratio (1-21) between two sRGB colours (channels 0-255). */
   export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
   	const la = relativeLuminance(a);
   	const lb = relativeLuminance(b);
   	const hi = Math.max(la, lb);
   	const lo = Math.min(la, lb);
   	return (hi + 0.05) / (lo + 0.05);
   }

   /** Linear per-channel mix: `a` moved fraction `t` (0-1) toward `b`. */
   function mixRgb(
   	a: [number, number, number],
   	b: [number, number, number],
   	t: number
   ): [number, number, number] {
   	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
   }

   /**
    * Clamp an adaptive accent for legibility: while its contrast against `bgHex`
    * is below 4.5:1, mix it 15% toward `textHex` (at most 5 iterations, which is
    * enough to lift any colour on every bundled theme). Non-hex input (or a
    * malformed map entry) passes through unchanged — fail open to the raw colour.
    */
   export function clampAccentContrast(accentHex: string, bgHex: string, textHex: string): string {
   	const bg = parseHex(bgHex);
   	const text = parseHex(textHex);
   	let cur = parseHex(accentHex);
   	if (!bg || !text || !cur) return accentHex;
   	for (let i = 0; i < 5 && contrastRatio(cur, bg) < 4.5; i++) {
   		cur = mixRgb(cur, text, 0.15);
   	}
   	return toHex(cur);
   }
   ```
   *(Coordination: if E6 has landed, `THEME_TEXT.black` should be `#cfcdc8` to match.)*

2. `apps/web/src/routes/read/[id]/+page.svelte:18-26` (post-C6 state) — extend the import.

   Current code:
   ```ts
   	import {
   		readerCssVars,
   		readerThemeAttr,
   		FONT_LABELS,
   		THEME_SWATCHES,
   		type FontFamily,
   		type ReaderTheme,
   		type ThemeMode
   	} from '$lib/typography';
   ```
   Change to:
   ```ts
   	import {
   		clampAccentContrast,
   		readerCssVars,
   		readerThemeAttr,
   		FONT_LABELS,
   		THEME_BG,
   		THEME_SWATCHES,
   		THEME_TEXT,
   		type FontFamily,
   		type ReaderTheme,
   		type ThemeMode
   	} from '$lib/typography';
   ```

3. `apps/web/src/routes/read/[id]/+page.svelte:76-81` — delete the old raw-injection derived (it moves below `readerThemeValue`, which it now depends on).

   Current code:
   ```ts
   	// Override the pane's accent custom properties when an adaptive colour is live.
   	const accentStyle = $derived(
   		readerSettings.current.adaptiveAccent && accentColor
   			? `--accent:${accentColor};--accent-soft:color-mix(in srgb, ${accentColor} 16%, transparent)`
   			: ''
   	);
   ```
   Change to: (nothing — remove these 6 lines entirely)

4. `apps/web/src/routes/read/[id]/+page.svelte:139-142` — add the resolved theme + clamped accent after `readerThemeValue`.

   Current code:
   ```ts
   	// Reader-pane theme: the explicit override, or the app theme when matching.
   	const readerThemeValue = $derived(
   		readerThemeAttr(readerSettings.current.theme, readerSettings.current.readerTheme)
   	);
   ```
   Change to:
   ```ts
   	// Reader-pane theme: the explicit override, or the app theme when matching.
   	const readerThemeValue = $derived(
   		readerThemeAttr(readerSettings.current.theme, readerSettings.current.readerTheme)
   	);

   	// Resolve the pane's effective palette for contrast math: the data-theme
   	// value, or the OS scheme when app + reader are both on auto/match (the same
   	// resolution chromeForTheme uses; ssr=false so window is always available).
   	const effectiveReaderTheme = $derived.by((): Exclude<ThemeMode, 'auto'> => {
   		if (readerThemeValue) return readerThemeValue as Exclude<ThemeMode, 'auto'>;
   		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
   	});
   	// Override the pane's accent custom properties when an adaptive colour is
   	// live, clamped to >= 4.5:1 contrast against the active theme background.
   	const accentStyle = $derived.by(() => {
   		if (!readerSettings.current.adaptiveAccent || !accentColor) return '';
   		const safe = clampAccentContrast(
   			accentColor,
   			THEME_BG[effectiveReaderTheme],
   			THEME_TEXT[effectiveReaderTheme]
   		);
   		return `--accent:${safe};--accent-soft:color-mix(in srgb, ${safe} 16%, transparent)`;
   	});
   ```

**Do not:** fetch or recompute the accent server-side; read `getComputedStyle` for the bg (the `THEME_BG`/`THEME_TEXT` maps are the specified source); mutate `accentColor`; clamp when `adaptiveAccent` is off; exceed 5 mix iterations.
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: enable adaptive accent (Settings → Reading), open an article whose cover yields a pale accent on Paper — links/progress bar render a visibly darker, legible variant; switch the reader theme to Black — the same article's accent is lightened if needed. Spot-check in DevTools: computed `--accent` on `.doc` differs from the API color only when the raw ratio was < 4.5:1.
**Acceptance:**
- `--accent` injected on `.doc` always has ≥4.5:1 contrast vs the active reader theme's `--bg` (or is the rawest passing value after 5 × 15% mixes toward `--text`).
- Pure functions (`parseHex`, `contrastRatio`, `clampAccentContrast`) live in `typography.ts`, exported and unit-testable.
- Non-hex API colors pass through unchanged; behavior with adaptive accent disabled is identical to today.

---

### C8: Hide the app top bar on the reader route at phone widths

**Priority:** P1 · **Depends on:** none (pairs with C3's ≤640px sticky reader bar)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/+layout.svelte`
**Why:** At ≤820px the layout shows a fixed `.topbar` (menu / brand / search) and `main` gets `padding-top: calc(var(--topbar-h) + …)` (lines 666-681, 984-987); the reader then renders its own toolbar beneath it — two stacked chrome bars on a phone. No fullscreen/immersive flag exists in the layout (verified: no such mechanism anywhere), so the cleanest mechanism is a route-derived class from `page.route.id` — the layout already imports `page` from `$app/state`. The reader toolbar already has Back; ⌘K/search remains reachable via the palette and the reader's own chrome.

**Steps:**

1. `apps/web/src/routes/+layout.svelte:36-39` — derive the flag.

   Current code:
   ```ts
   	let paletteOpen = $state(false);
   	let drawerOpen = $state(false);
   	let helpOpen = $state(false);
   	let pending: string | null = null;
   ```
   Change to:
   ```ts
   	let paletteOpen = $state(false);
   	let drawerOpen = $state(false);
   	let helpOpen = $state(false);
   	let pending: string | null = null;

   	// The reader supplies its own toolbar (with Back); on phones, the app top bar
   	// above it would stack two chrome bars, so it is hidden on that route.
   	const isReader = $derived(page.route.id === '/read/[id]');
   ```

2. `apps/web/src/routes/+layout.svelte:321` — tag the top bar.

   Current code:
   ```svelte
   <div class="topbar">
   ```
   Change to:
   ```svelte
   <div class="topbar" class:reader-route={isReader}>
   ```

3. `apps/web/src/routes/+layout.svelte:630` — tag `main` so its top padding (reserved for the fixed bar) is released too.

   Current code:
   ```svelte
   <main>
   ```
   Change to:
   ```svelte
   <main class:reader-route={isReader}>
   ```

4. `apps/web/src/routes/+layout.svelte:969-988` — append the ≤640px rules AFTER the existing 820px media block.

   Current code:
   ```css
   	@media (max-width: 820px) {
   		.topbar {
   			display: flex;
   		}
   		.scrim {
   			display: block;
   		}
   		.sidebar {
   			transform: translateX(-100%);
   			box-shadow: var(--shadow);
   			transition: transform var(--dur) var(--ease);
   		}
   		.sidebar.open {
   			transform: translateX(0);
   		}
   		main {
   			margin-left: 0;
   			padding-top: calc(var(--topbar-h) + env(safe-area-inset-top) + 1rem);
   		}
   	}
   ```
   Change to:
   ```css
   	@media (max-width: 820px) {
   		.topbar {
   			display: flex;
   		}
   		.scrim {
   			display: block;
   		}
   		.sidebar {
   			transform: translateX(-100%);
   			box-shadow: var(--shadow);
   			transition: transform var(--dur) var(--ease);
   		}
   		.sidebar.open {
   			transform: translateX(0);
   		}
   		main {
   			margin-left: 0;
   			padding-top: calc(var(--topbar-h) + env(safe-area-inset-top) + 1rem);
   		}
   	}
   	/* Reader route on phones: the reader's own toolbar (with Back) is the only
   	   chrome — drop the app bar and the padding that reserved space for it. */
   	@media (max-width: 640px) {
   		.topbar.reader-route {
   			display: none;
   		}
   		main.reader-route {
   			padding-top: calc(env(safe-area-inset-top) + 0.75rem);
   		}
   	}
   ```

**Do not:** hide the topbar above 640px (641-820px keeps both bars — the reader bar is `position: static` there, per the reader's own CSS); introduce a context/store/prop plumbing for "immersive" (the route check is the whole mechanism); touch the sidebar, drawer, or scrim.
**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual at 390px: open any list → app top bar visible; open an article → no app top bar, reader toolbar (Back …) at the top, content starts just below the safe area; navigate Back → app top bar returns; at 700px width the app top bar is still visible in the reader (unchanged band); desktop unaffected.
**Acceptance:**
- `/read/[id]` at ≤640px shows exactly one chrome bar (the reader's).
- `main` padding collapses accordingly — no blank band where the bar was.
- All other routes and widths render identically to before.
