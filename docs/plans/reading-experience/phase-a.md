# Phase A — Quick Wins

Read `README.md` in this directory first (guardrails, verification, commit rules).
No packet here depends on another phase. If quoted "Current code" does not match the file,
stop and report the mismatch.

---

### A1: Set magazine body copy in the reading serif

**Priority:** P0 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte
**Why:** `.mr-body` declares no `font-family`, so article prose inherits `--font-ui` (Helvetica) from `body` while the drop cap is serif. The flagship literary surface must read in the reading serif; serif at 20px also wants slightly tighter leading than 1.7.

**Current code** (MagazineReader.svelte:468-473):

```css
	/* Article body typography. The HTML is sanitized upstream. */
	.mr-body {
		font-size: var(--text-lg);
		line-height: 1.7;
		color: var(--text);
	}
```

**Change to:**

```css
	/* Article body typography. The HTML is sanitized upstream. Body copy reads in
	   the reading serif (via --reader-font when a reader pane ever provides it),
	   not the UI sans the page chrome uses; serif at this size wants slightly
	   tighter leading than the sans did. */
	.mr-body {
		font-family: var(--reader-font, var(--font-serif));
		font-size: var(--text-lg);
		line-height: 1.6;
		color: var(--text);
	}
```

**Do not:** Do not touch any other `.mr-body :global(...)` rules, the drop-cap/small-caps rules, or anything in the `<script>` block. Do not change `font-size`. Do not reformat the file (tabs, prettier `trailingComma: none`).
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open /magazine, open any issue — body paragraphs render in a serif (Iowan Old Style/Charter/Georgia), matching the drop cap; check on Paper and Dark themes.
**Acceptance:**

- `.mr-body` computed `font-family` resolves to the serif stack, not system sans.
- Computed `line-height` of `.mr-body` paragraphs is 1.6.
- No other magazine styles changed.

---

### A2: Newspaper columns: justified → ragged with hyphenation control

**Priority:** P0 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte
**Why:** `text-align: justify` at ~31ch columns produces rivers with greedy line-breaking, and the justification survives the single-column mobile collapse. Ragged-right + hyphenation limits + pretty wrapping fixes both. CSS-only change.

**Current code** (FlipReader.svelte:549-557):

```css
	/* Each band is a short, bounded 2-column block. The `2 17rem` form caps at two
	   columns and collapses to a single column on narrow screens. */
	.fr-band {
		columns: 2 17rem;
		column-gap: 2.4rem;
		column-rule: 1px solid var(--border);
		text-align: justify;
		hyphens: auto;
	}
```

**Change to:**

```css
	/* Each band is a short, bounded 2-column block. The `2 17rem` form caps at two
	   columns and collapses to a single column on narrow screens. Ragged-right:
	   greedy line-breaking justified ~31ch columns into rivers, so keep the left
	   axis and let hyphenation + pretty wrapping tidy the rag. */
	.fr-band {
		columns: 2 17rem;
		column-gap: 2.4rem;
		column-rule: 1px solid var(--border);
		text-align: left;
		hyphens: auto;
		hyphenate-limit-chars: 6 3 2;
		text-wrap: pretty;
	}
```

**Do not:** Do not change `columns`, `column-gap`, or `column-rule`. Do not touch `.fr-full`, `.fr-break`, drop-cap rules, or any script logic. Do not "gate justification ≥ 20rem" — justification is removed entirely.
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open /newspaper, open an edition — column text is ragged-right with hyphenation, no gaping word spaces; narrow the window below the column collapse and confirm the single column is also ragged. Test on Newsprint theme.
**Acceptance:**

- `.fr-band` computes `text-align: left`.
- `hyphenate-limit-chars: 6 3 2` and `text-wrap: pretty` present (harmless no-ops where unsupported).
- Two-column layout and column rule unchanged.

---

### A3: Make text selection visible on light themes

**Priority:** P0 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/app.css
**Why:** `::selection` uses `--accent-soft`, which is 1.07-1.12:1 against the light-theme backgrounds — nearly invisible, and selection is the highlight gesture. A 25% accent-into-bg mix is clearly visible on all six themes and keeps text AAA.

**Current code** (app.css:393-396):

```css
::selection {
	background: var(--accent-soft);
	color: var(--text);
}
```

**Change to:**

```css
::selection {
	/* --accent-soft is near-invisible against the light papers (~1.1:1); a 25%
	   accent-into-bg mix reads clearly on all six themes and keeps text AAA. */
	background: color-mix(in srgb, var(--accent) 25%, var(--bg));
	color: var(--text);
}
```

**Do not:** Do not touch `:focus-visible` above it or `.page` below it. Do not change `--accent-soft` itself (it is used by buttons/nav).
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open any article, drag-select a sentence on Paper, Sepia, and Newsprint themes — the selection band is clearly visible; repeat on Dark to confirm it still reads.
**Acceptance:**

- Selected text is visibly tinted on Paper, Sepia, Newsprint (no squinting).
- Selected text remains legible (`color: var(--text)` unchanged).

---

### A4: Highlight marks: multiply on light themes, scoped tints on dark themes

**Priority:** P0 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/app.css, /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte
**Why:** The 38% translucent washes composite to 1.18-1.50:1 on Sepia/Newsprint (default yellow almost disappears) and the same light-tuned mix is used on dark themes. Light themes get solid marker ink with `mix-blend-mode: multiply`; dark themes get a theme-scoped translucent tint (multiply would crush light text to black). Two new theme tokens drive both, and they re-scope correctly when the reader pane overrides the app theme via `data-theme` on `.doc`.

**Step 1 — app.css `:root` block. Current code** (app.css:155-156):

```css
	--grain-strength: 0.12;
}
```

**Change to:**

```css
	--grain-strength: 0.12;

	/* Highlight-mark rendering, theme-scoped: light themes paint solid marker ink
	   multiplied into the paper; dark themes use a translucent tint (multiply
	   would crush light text into black). Each [data-theme] block overrides. */
	--hl-mix: 100%;
	--hl-blend: multiply;
}
```

**Step 2 — `[data-theme='light']` block. Current code** (app.css:184-185 — note: an identical `--edge-hi` line exists in `:root` but is followed by a comment, not `}`; match this exact two-line string):

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.55);
}
```

**Change to:**

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.55);
	--hl-mix: 100%;
	--hl-blend: multiply;
}
```

**Step 3 — `[data-theme='sepia']` block. Current code** (app.css:207-208):

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
```

**Change to:**

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.5);
	--hl-mix: 100%;
	--hl-blend: multiply;
}
```

**Step 4 — `[data-theme='newsprint']` block. Current code** (app.css:230-231):

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
```

**Change to:**

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.45);
	--hl-mix: 100%;
	--hl-blend: multiply;
}
```

**Step 5 — `[data-theme='dark']` block. Current code** (app.css:252-253 — single-tab indent, closing brace at column 0; the auto-theme media-query block at 323-324 has a double-tab indent and indented brace, so this match is unique):

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

**Change to:**

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	--hl-mix: 26%;
	--hl-blend: normal;
}
```

**Step 6 — `[data-theme='black']` block. Current code** (app.css:275-276):

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

**Change to:**

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.05);
	--hl-mix: 26%;
	--hl-blend: normal;
}
```

**Step 7 — `[data-theme='contrast']` block. Current code** (app.css:299-300):

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
```

**Change to:**

```css
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.12);
	--hl-mix: 32%;
	--hl-blend: normal;
}
```

**Step 8 — auto-dark media block. Current code** (app.css:323-325 — double-tab indent, end of the `@media (prefers-color-scheme: dark)` block):

```css
		--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}
}
```

**Change to:**

```css
		--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
		--hl-mix: 26%;
		--hl-blend: normal;
	}
}
```

**Step 9 — the mark rule. Current code** (read/[id]/+page.svelte:1854-1859):

```css
	.doc :global(mark.lectern-hl) {
		background: color-mix(in srgb, var(--hl, #e0b341) 38%, transparent);
		color: inherit;
		border-radius: 2px;
		padding: 0.05em 0;
	}
```

**Change to:**

```css
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
```

**Do not:** Do not touch the per-color `--hl` rules (`.doc :global(mark.lectern-hl[data-color='blue'])` etc.), the `mark.find-hit` rules, or the `.hl-item` panel-card colors. Do not add dark-theme line-height or image-brightness rules — that is a later phase. Do not rename the tokens.
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open an article, highlight a sentence (select → Highlight). On Sepia and Newsprint the default yellow mark is unmistakably a yellow marker stroke and the text inside stays dark and legible. Switch the reader theme to Dark and Black — the mark is a dim translucent yellow tint, text stays light and legible (not black). Set app theme Dark with reader theme Paper (`Display → Theme`) and confirm the in-doc mark uses the light treatment.
**Acceptance:**

- Yellow highlight contrast vs background clearly visible on all three light themes.
- Dark/Black/Contrast marks are translucent tints (26%/26%/32%), no multiply, text not blackened.
- Reader-pane theme override (`data-theme` on `.doc`) re-scopes the mark treatment.
- All five mark colors still render distinctly.

---

### A5: Layered Escape — close reader overlays before exiting the reader

**Priority:** P1 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte
**Why:** The layout's window keydown listener (registered first, at +layout.svelte:218-228 / 271-276) maps Escape to `controller.back()`, so Escape with the Display popover open exits the reader. A capture-phase listener in the reader closes the topmost overlay (Display popover, find bar, highlight popover) and stops propagation, so the layout's bubble-phase handler never fires for that press.

**Step 1 — add the handler. Current code** (read/[id]/+page.svelte:314-319, end of `onKey`):

```ts
		} else if (e.key === 'r' || e.key === 'R') {
			// Re-extract the article from the original source (incomplete/broken capture).
			void refetchContent();
			e.preventDefault();
		}
	}
```

**Change to:**

```ts
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
```

**Step 2 — register it. Current code** (read/[id]/+page.svelte:664-668):

```ts
		window.addEventListener('keydown', onFindKey);
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('keydown', onKey);
		window.addEventListener('resize', updateBar);
		document.addEventListener('mouseup', onMouseUp);
```

**Change to:**

```ts
		window.addEventListener('keydown', onEscapeCapture, true);
		window.addEventListener('keydown', onFindKey);
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('keydown', onKey);
		window.addEventListener('resize', updateBar);
		document.addEventListener('mouseup', onMouseUp);
```

**Step 3 — unregister it. Current code** (read/[id]/+page.svelte:674-679):

```ts
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', updateBar);
			document.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('keydown', onFindKey);
			if (findTimer) clearTimeout(findTimer);
```

**Change to:**

```ts
			window.removeEventListener('keydown', onEscapeCapture, true);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', updateBar);
			document.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('keydown', onFindKey);
			if (findTimer) clearTimeout(findTimer);
```

**Do not:** Do not modify the layout's keydown handler or `keyboard.ts` — Escape-goes-back from a clean reader must keep working. Do not remove the `true` capture flag from either call (add and remove must match). Do not fold this into `onKey` (bubble phase runs after the layout's listener).
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open an article, open the Display popover, press Escape — popover closes, you stay in the reader; press Escape again — now you go back to the list. Repeat with the find bar (Cmd/Ctrl+F) and with a text selection's Highlight popover. Confirm Escape still closes the shortcuts sheet (`?`) and the mobile drawer as before.
**Acceptance:**

- Escape with Display popover open closes only the popover.
- Escape with find bar or highlight popover open closes only that layer.
- Escape with no overlay open still exits the reader.
- No leaked listener (close/reopen reader, Escape behavior unchanged).

*Coordination note: C2 (Phase C) also adds Escape layering via `controller.back()` for its new "…" menu. If C2 is already applied, extend its `back()` branch instead of duplicating; if A5 is applied first, C2's implementer should fold `menuOpen` into this capture handler.*

---

### A6: Stop the Display popover clipping its theme/typeface rows (desktop)

**Priority:** P1 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte
**Why:** Seven theme buttons and seven font buttons each share one non-wrapping flex row in a 20rem popover, so the last labels (Contrast, Lexend, OpenDyslexic) clip. Convert the segments to a wrapping grid, widen the popover slightly, and add a viewport-height scroll guard. Desktop fix only — the mobile bottom-sheet is C5.

**Step 1 — popover sizing. The `.panel` class is shared with the Info side rail, so scope the override to the popover (`.bar .panel`). Current code** (read/[id]/+page.svelte:1188-1193, end of the `.panel` rule):

```css
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
	}
```

**Change to:**

```css
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
```

**Step 2 — wrapping segments. Current code** (read/[id]/+page.svelte:1209-1229):

```css
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
```

**Change to:**

```css
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
```

**Do not:** Do not change the base `.panel` rule's `width` (it leaks to the Info side rail). Do not build a mobile bottom sheet, width presets, or an "Aa" preview — out of scope. Do not touch the sliders or the scrim.
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: at desktop width (>980px), open an article → Display. All seven theme labels (through Contrast) and all seven typeface labels (through OpenDyslexic) are fully visible, wrapped onto multiple rows, none clipped. Shrink the window height to ~500px — the popover scrolls internally instead of clipping the Width slider. Open the Info panel (`]`) and confirm its rail width/appearance is unchanged.
**Acceptance:**

- No clipped button labels in Theme or Typeface rows at 20-22rem popover width.
- Popover scrolls when taller than the viewport.
- Info side rail (`aside.rail.panel`) visually unchanged.

---

### A7: Show a human author name instead of raw punycode email

**Priority:** P1 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/author.ts (new), /Users/luke/git/luke/Lectern/apps/web/src/lib/author.test.ts (new), /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte, /Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte, /Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte
**Why:** Feed/email captures put machine forms in `card.author` (live: `marius@xn--gckvb8fzb.com (Marius)`). Parse the `Name <email>` and `email (Name)` forms and show only the name; for bare addresses show a humanized local part. The address (and any punycode host) is dropped, never decoded — `node:punycode` is unavailable in the browser, so we deliberately never display the domain.

**Step 1 — create `/Users/luke/git/luke/Lectern/apps/web/src/lib/author.ts` with exactly this content** (tab-indented):

```ts
/**
 * Human-readable author from raw byline metadata. Feed and email captures often
 * carry machine forms — `Name <user@host>`, `user@host (Name)`, or a bare
 * address. Show the human name when one is present and never show the address;
 * for a bare address fall back to a humanized local part. The domain (often a
 * punycode `xn--` host) is dropped entirely rather than decoded — there is no
 * browser-safe punycode decoder and the domain is not a byline anyway.
 */
export function displayAuthor(raw: string): string {
	let author = raw.trim();
	if (!author) return raw;
	// "Name <user@host>": prefer the display name; a bare "<user@host>" falls
	// through to local-part handling below.
	const angled = author.match(/^(.*?)\s*<\s*([^\s<>]+@[^\s<>]+)\s*>$/);
	if (angled) {
		const name = angled[1]
			.trim()
			.replace(/^["']+|["']+$/g, '')
			.trim();
		if (name) return name;
		author = angled[2];
	}
	// "user@host (Name)": the display name trails in parentheses.
	const commented = author.match(/^[^\s()]+@[^\s()]+\s*\(([^)]*)\)$/);
	if (commented) {
		const name = commented[1].trim();
		if (name) return name;
		author = author.replace(/\s*\([^)]*\)$/, '');
	}
	// Bare address: humanize the local part and drop the domain entirely.
	const bare = author.match(/^([^\s@]+)@[^\s@]+$/);
	if (bare) {
		const local = bare[1]
			.replace(/["']/g, '')
			.replace(/[._+-]+/g, ' ')
			.trim();
		return local ? local.replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : author;
	}
	// Already a human name (or an unrecognized form): pass through untouched.
	return author;
}
```

**Step 2 — create `/Users/luke/git/luke/Lectern/apps/web/src/lib/author.test.ts` with exactly this content:**

```ts
import { describe, expect, it } from 'vitest';
import { displayAuthor } from './author';

describe('displayAuthor', () => {
	it('shows the parenthesized display name from "email (Name)" forms', () => {
		expect(displayAuthor('marius@xn--gckvb8fzb.com (Marius)')).toBe('Marius');
	});

	it('shows the display name from "Name <email>" forms', () => {
		expect(displayAuthor('Jane Doe <jane@example.com>')).toBe('Jane Doe');
		expect(displayAuthor('"Jane Doe" <jane@example.com>')).toBe('Jane Doe');
	});

	it('falls back to a humanized local part for bare addresses', () => {
		expect(displayAuthor('jane.doe@example.com')).toBe('Jane Doe');
		expect(displayAuthor('<jane@example.com>')).toBe('Jane');
	});

	it('passes plain names through untouched', () => {
		expect(displayAuthor('Maria Popova')).toBe('Maria Popova');
		expect(displayAuthor('  Maria Popova  ')).toBe('Maria Popova');
	});
});
```

**Step 3 — reader byline. Current code** (read/[id]/+page.svelte:32):

```ts
	import TagEditor from '$lib/components/TagEditor.svelte';
```

**Change to:**

```ts
	import { displayAuthor } from '$lib/author';
	import TagEditor from '$lib/components/TagEditor.svelte';
```

**Current code** (read/[id]/+page.svelte:919-920):

```svelte
			<p class="byline">
				{card.siteName ?? card.author ?? new URL(card.url).hostname}
```

**Change to:**

```svelte
			<p class="byline">
				{card.siteName ?? (card.author ? displayAuthor(card.author) : new URL(card.url).hostname)}
```

*(If E11 — structured byline — is already applied, instead wrap the author reference in its new byline markup: `By {displayAuthor(card.author)}`.)*

**Step 4 — Info panel. Current code** (read/[id]/+page.svelte:983-986):

```svelte
				{#if card.author}<div>
						<dt>Author</dt>
						<dd>{card.author}</dd>
					</div>{/if}
```

**Change to:**

```svelte
				{#if card.author}<div>
						<dt>Author</dt>
						<dd>{displayAuthor(card.author)}</dd>
					</div>{/if}
```

**Step 5 — FlipReader byline. Current code** (FlipReader.svelte:10):

```ts
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';
```

**Change to:**

```ts
	import SourceAvatar from '$lib/components/SourceAvatar.svelte';
	import { displayAuthor } from '$lib/author';
```

**Current code** (FlipReader.svelte:108-113):

```ts
	function byline(card: Card): string {
		const parts: string[] = [];
		if (card.author) parts.push(card.author);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min read`);
		return parts.join(' · ');
	}
```

**Change to:**

```ts
	function byline(card: Card): string {
		const parts: string[] = [];
		if (card.author) parts.push(displayAuthor(card.author));
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min read`);
		return parts.join(' · ');
	}
```

**Step 6 — MagazineReader meta. Current code** (MagazineReader.svelte:10):

```ts
	import SourceAvatar from './SourceAvatar.svelte';
```

**Change to:**

```ts
	import SourceAvatar from './SourceAvatar.svelte';
	import { displayAuthor } from '$lib/author';
```

**Current code** (MagazineReader.svelte:33-39):

```ts
	function meta(card: Card): string {
		const parts: string[] = [];
		if (card.siteName) parts.push(card.siteName);
		if (card.author) parts.push(card.author);
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min`);
		return parts.join(' · ');
	}
```

**Change to:**

```ts
	function meta(card: Card): string {
		const parts: string[] = [];
		if (card.siteName) parts.push(card.siteName);
		if (card.author) parts.push(displayAuthor(card.author));
		if (card.readingTimeMinutes) parts.push(`${card.readingTimeMinutes} min`);
		return parts.join(' · ');
	}
```

**Do not:** Do not modify the stored `card.author` data or any sync/mutation code — this is display-only. Do not add a punycode decoder. Do not touch the `meta()` in routes/magazine/+page.svelte (it shows siteName + minutes only, no author).
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test` (the new author.test.ts must pass). Manual: open an article whose author metadata is an email form (newsletter card) — byline and Info panel show "Marius", not `marius@xn--gckvb8fzb.com (Marius)`; check the same card inside a magazine issue and a newspaper edition.
**Acceptance:**

- `email (Name)`, `Name <email>`, and bare-address forms all render as a human name in all four display sites.
- Plain author names render unchanged.
- New unit tests pass; no behavior change for cards without an author.

---

### A8: Stop magazine issue titles leaking tag serialization syntax

**Priority:** P1 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/magazine.ts, /Users/luke/git/luke/Lectern/apps/web/src/lib/magazine.test.ts, /Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte, /Users/luke/git/luke/Lectern/apps/web/src/routes/magazine/+page.svelte
**Why:** Cover titles render the raw tag (`{featured.tag}` / `{issue.tag}`), which live-leaks serialized fragments like `['Rss'`, `'Article'`, `Politics-Society]`. One shared formatter strips bracket/quote syntax, turns `-`/`_` into spaces, and title-cases — used by the issue rack covers and the MagazineReader masthead (which currently only handles `-`/`_`).

**Step 1 — add the formatter. Current code** (magazine.ts:42-44, end of `buildMagazines`):

```ts
	issues.sort((a, b) => b.cards.length - a.cards.length || a.tag.localeCompare(b.tag));
	return issues;
}
```

**Change to:**

```ts
	issues.sort((a, b) => b.cards.length - a.cards.length || a.tag.localeCompare(b.tag));
	return issues;
}

/**
 * Human title for a magazine issue. Tags can arrive carrying serialization
 * fragments (`['rss'`, `'article'`, `politics-society]`) — strip bracket/quote
 * syntax, turn separators into spaces, and title-case each word. Falls back to
 * the raw tag if stripping leaves nothing.
 */
export function magazineTitle(tag: string): string {
	const words = tag
		.replace(/[[\]{}'"`]/g, ' ')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return words ? words.replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : tag;
}
```

**Step 2 — tests. Current code** (magazine.test.ts:3):

```ts
import { buildMagazines, isLibraryItem } from './magazine';
```

**Change to:**

```ts
import { buildMagazines, isLibraryItem, magazineTitle } from './magazine';
```

**Then append at the very end of magazine.test.ts** (after the closing `});` of the `buildMagazines` describe block, whose last test is `it('honours a custom minimum', ...)`):

```ts

describe('magazineTitle', () => {
	it('strips leaked tag syntax and title-cases the words', () => {
		expect(magazineTitle("['rss'")).toBe('Rss');
		expect(magazineTitle("'article'")).toBe('Article');
		expect(magazineTitle('politics-society]')).toBe('Politics Society');
	});

	it('turns separators into spaces and capitalizes each word', () => {
		expect(magazineTitle('machine_learning')).toBe('Machine Learning');
		expect(magazineTitle('long-reads')).toBe('Long Reads');
	});

	it('falls back to the raw tag when stripping leaves nothing', () => {
		expect(magazineTitle("[]''")).toBe("[]''");
	});
});
```

**Step 3 — MagazineReader masthead. Current code** (MagazineReader.svelte:3):

```ts
	import type { Magazine } from '$lib/magazine';
```

**Change to:**

```ts
	import { magazineTitle, type Magazine } from '$lib/magazine';
```

**Current code** (MagazineReader.svelte:29-31):

```ts
	const title = $derived(
		magazine.tag.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
	);
```

**Change to:**

```ts
	const title = $derived(magazineTitle(magazine.tag));
```

**Step 4 — rack covers. Current code** (routes/magazine/+page.svelte:9):

```ts
	import { buildMagazines, type Magazine } from '$lib/magazine';
```

**Change to:**

```ts
	import { buildMagazines, magazineTitle, type Magazine } from '$lib/magazine';
```

**Current code** (routes/magazine/+page.svelte:152):

```svelte
					<h2 class="cover-title">{featured.tag}</h2>
```

**Change to:**

```svelte
					<h2 class="cover-title">{magazineTitle(featured.tag)}</h2>
```

**Current code** (routes/magazine/+page.svelte:200):

```svelte
							<h2 class="cover-title">{issue.tag}</h2>
```

**Change to:**

```svelte
							<h2 class="cover-title">{magazineTitle(issue.tag)}</h2>
```

**Do not:** Do not change `buildMagazines` grouping (the raw tag stays the issue key — `hue(tag)`, `issueNo(tag)`, `failedArt` keys all keep using the raw tag). Do not remove the `text-transform: capitalize` CSS on `.cover-title` / `.mr-head h1` (harmless over already-title-cased text). Do not touch cover art selection or folios.
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test` (new magazineTitle tests must pass). Manual: open /magazine — no cover title shows `[`, `]`, `'`, or `"`; a tag like `politics-society` reads "Politics Society"; open an issue and confirm the MagazineReader h1 matches its cover title.
**Acceptance:**

- No bracket/quote characters in any cover title or issue masthead.
- Hyphen/underscore tags render as title-cased multi-word titles.
- Issue grouping, hue, and issue numbers unchanged (same covers, same order).

---

### A9: Strip duplicate leading h1 from article content and demote in-content h1s

**Priority:** P1 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/article-html.ts (new), /Users/luke/git/luke/Lectern/apps/web/src/lib/article-html.test.ts (new), /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte, /Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte, /Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte
**Why:** Extracted content often opens with an `<h1>` repeating the title the reader chrome already renders (live finding, full reader + flip readers), and remaining in-content h1s fall through to app.css base styles (wrong face, margin 0). Strip the leading h1 when it fuzzy-matches the document title; demote every other h1 to h2 so prose heading styles apply. Sanitization happens in two places — `DOMPurify.sanitize` in `read/[id]/+page.svelte:635` and `lib/content.ts:24` (shared cache, no title available there) — so the cleanup is a pure post-sanitize function applied at the three call sites that know the title. Known accepted tradeoff: highlights/scroll anchors are block-index-relative, so pre-existing highlights on articles that had a leading h1 may shift by one block — do not attempt to remap them.

**Step 1 — create `/Users/luke/git/luke/Lectern/apps/web/src/lib/article-html.ts` with exactly this content:**

```ts
/**
 * Post-sanitize cleanup for captured article HTML. Extraction often leaves the
 * article's own <h1> at the top, duplicating the title the reader chrome
 * already renders. Strip that leading h1 when it fuzzy-matches the document
 * title, and demote any remaining in-content h1s to h2 so the page keeps a
 * single h1 (the chrome title) and the prose heading styles apply. Pure DOM
 * string -> string; returns the input untouched where DOMParser is unavailable
 * (SSR / node tests), mirroring splitBands in FlipReader.
 */

/** Lowercase, strip everything but letters/digits, collapse runs to spaces. */
function comparable(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * True when a heading and the document title are the same article title,
 * tolerating punctuation/case differences and truncation or site suffixes
 * (one contains the other and the shorter side is substantial).
 */
export function titlesMatch(heading: string, title: string): boolean {
	const a = comparable(heading);
	const b = comparable(title);
	if (!a || !b) return false;
	if (a === b) return true;
	const shorter = a.length <= b.length ? a : b;
	const longer = a.length <= b.length ? b : a;
	return shorter.length >= 10 && longer.includes(shorter);
}

/** Characters of rendered text that precede `el` within `root`. */
function textBefore(root: Element, el: Element): number {
	const range = root.ownerDocument.createRange();
	range.setStart(root, 0);
	range.setEndBefore(el);
	return range.toString().trim().length;
}

export function cleanArticleHtml(html: string, title?: string | null): string {
	if (!html || typeof DOMParser === 'undefined') return html;
	const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	const body = doc.body;
	// Strip the leading h1 when it repeats the document title. "Leading" allows
	// a little front matter (a kicker or byline) before it, but not body prose.
	const first = body.querySelector('h1');
	if (
		first &&
		title &&
		textBefore(body, first) < 80 &&
		titlesMatch(first.textContent ?? '', title)
	) {
		first.remove();
	}
	// Demote any remaining in-content h1s — the reader chrome owns the h1.
	for (const h1 of Array.from(body.querySelectorAll('h1'))) {
		const h2 = doc.createElement('h2');
		for (const attr of Array.from(h1.attributes)) h2.setAttribute(attr.name, attr.value);
		while (h1.firstChild) h2.appendChild(h1.firstChild);
		h1.replaceWith(h2);
	}
	return body.innerHTML;
}
```

**Step 2 — create `/Users/luke/git/luke/Lectern/apps/web/src/lib/article-html.test.ts` with exactly this content** (the vitest project runs in the node environment with no DOMParser, so the DOM path is exercised manually in the browser; the pure matcher and the no-DOM guard are unit-tested):

```ts
import { describe, expect, it } from 'vitest';
import { cleanArticleHtml, titlesMatch } from './article-html';

describe('titlesMatch', () => {
	it('matches identical titles regardless of case and punctuation', () => {
		expect(titlesMatch('Hello, World — a Story', 'hello world a story')).toBe(true);
	});

	it('matches truncated variants when the overlap is substantial', () => {
		expect(
			titlesMatch('The Rise and Fall of Everything', 'The Rise and Fall of Everything — Example Site')
		).toBe(true);
	});

	it('rejects short or unrelated headings', () => {
		expect(titlesMatch('Intro', 'A completely different article title')).toBe(false);
		expect(titlesMatch('', 'Some title')).toBe(false);
	});
});

describe('cleanArticleHtml', () => {
	it('returns input unchanged when no DOM is available (node test env)', () => {
		const html = '<h1>Title</h1><p>Body</p>';
		expect(cleanArticleHtml(html, 'Title')).toBe(html);
	});
});
```

**Step 3 — full reader. Current code** (read/[id]/+page.svelte:13):

```ts
	import { serializeRange, renderHighlights } from '$lib/highlight';
```

**Change to:**

```ts
	import { serializeRange, renderHighlights } from '$lib/highlight';
	import { cleanArticleHtml } from '$lib/article-html';
```

**Current code** (read/[id]/+page.svelte:632-635):

```ts
			const content = await getClient().getContent(docId, refresh ? { refresh: true } : undefined);
			if (docId !== id) return;
			// Sanitize before rendering untrusted article HTML on the client.
			html = DOMPurify.sanitize(content.html);
```

**Change to:**

```ts
			const content = await getClient().getContent(docId, refresh ? { refresh: true } : undefined);
			if (docId !== id) return;
			// Sanitize before rendering untrusted article HTML on the client, then
			// drop the duplicated leading h1 / demote in-content h1s.
			html = cleanArticleHtml(DOMPurify.sanitize(content.html), initial?.title);
```

**Step 4 — FlipReader. Current code** (FlipReader.svelte:7):

```ts
	import { getArticleHtml, prefetchArticles } from '$lib/content';
```

**Change to:**

```ts
	import { getArticleHtml, prefetchArticles } from '$lib/content';
	import { cleanArticleHtml } from '$lib/article-html';
```

**Current code** (FlipReader.svelte:123-128):

```ts
		getArticleHtml(card.id)
			.then((h) => {
				if (cancelled) return;
				html = h;
				loading = false;
			})
```

**Change to:**

```ts
		getArticleHtml(card.id)
			.then((h) => {
				if (cancelled) return;
				html = cleanArticleHtml(h, card.title);
				loading = false;
			})
```

**Step 5 — MagazineReader. Current code** (MagazineReader.svelte:8):

```ts
	import { getArticleHtml } from '$lib/content';
```

**Change to:**

```ts
	import { getArticleHtml } from '$lib/content';
	import { cleanArticleHtml } from '$lib/article-html';
```

**Current code** (MagazineReader.svelte:67-72):

```ts
		for (const card of magazine.cards) {
			getArticleHtml(card.id)
				.then((h) => {
					html[card.id] = h;
				})
```

**Change to:**

```ts
		for (const card of magazine.cards) {
			getArticleHtml(card.id)
				.then((h) => {
					html[card.id] = cleanArticleHtml(h, card.title);
				})
```

**Do not:** Do not change `lib/content.ts` — its cache stores sanitized HTML keyed by id only and has no title; cleaning stays at the call sites. Do not weaken or move the DOMPurify calls. Do not try to remap existing highlight/scroll anchors (accepted one-block drift on affected articles). Do not strip h1s that don't match the title — they get demoted, not removed.
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test` (new tests pass). Manual: open an article whose extracted content begins with its own title (most RSS/Readability captures) — the title appears once (the chrome h1), not twice; the same article opened inside a newspaper edition and a magazine issue also shows no duplicated title; an article with a non-matching internal h1 keeps that heading, now styled as an h2.
**Acceptance:**

- Leading content h1 fuzzy-matching the document title is removed in all three readers.
- All other in-content h1s render as h2 (attributes preserved, TOC `h2,h3` scan now includes them).
- Articles without h1s render byte-identically.
- SSR/node path (no DOMParser) passes HTML through unchanged.

---

### A10: Sync THEME_SWATCHES.black.fg with the Black theme ink

**Priority:** P2 · **Depends on:** none — SKIP if doing Phase E (E6 supersedes this with the warm-ink retune; do not apply both)
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts
**Why:** The Black theme's `--text` is `#dcdcdc` (app.css:261) but the theme-picker swatch foreground says `#d9d9d9` — drift in a file whose comment promises sync with the theme blocks.

**Current code** (typography.ts:101):

```ts
	black: { label: 'Black', bg: '#000000', fg: '#d9d9d9' },
```

**Change to:**

```ts
	black: { label: 'Black', bg: '#000000', fg: '#dcdcdc' },
```

**Do not:** Do not change any other swatch, `THEME_BG`, or app.css `--text` values (the Black-theme `#cfcdc8` halation retune is E6).
**Verify:** `cd /Users/luke/git/luke/Lectern && pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open Settings → Reading (or the Display popover) — the Black swatch is indistinguishable from before (3-step hex nudge), no visual regression.
**Acceptance:**

- `THEME_SWATCHES.black.fg === '#dcdcdc'`, matching `[data-theme='black'] --text` in app.css.
- No other lines in typography.ts changed.
