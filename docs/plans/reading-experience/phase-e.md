# Phase E — System: Fonts, Themes, Tokens

Read `README.md` in this directory first (guardrails, verification, commit rules).
Suggested order: E1 → E2 → E3 (font region), then E5 → E6 → E10 (theme blocks), then E4, E7, E8
(globals), then E9, E11, E12 (reader page). E13 is a recorded skip.
E6 supersedes A10 (do not apply both). E9 coordinates with A4.
If quoted "Current code" does not match the file, stop and report the mismatch.

---

### E1: Splice Literata mid-stack into the default serif

**Priority:** P1 · **Depends on:** none (apply before E2 to avoid merge friction in typography.ts)
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts`
- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`

**Why:** The default "Serif" stack is an Apple-only lottery — Android falls through to Noto Serif, Linux to DejaVu. Splicing the bundled Literata mid-stack gives non-Apple users a real book serif; mid-stack webfonts only download when the engine actually reaches them, so Apple users (who have Iowan Old Style / Charter) never pay the bytes.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts:74` — Current code:

```ts
	serif: '"Iowan Old Style", Charter, Georgia, "Times New Roman", serif',
```

Change to:

```ts
	serif: '"Iowan Old Style", Charter, "Literata", Georgia, serif',
```

2. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:89` — Current code:

```css
--font-serif: "Iowan Old Style", Charter, Georgia, "Times New Roman", serif;
```

Change to:

```css
--font-serif: "Iowan Old Style", Charter, "Literata", Georgia, serif;
```

(Note this file uses single quotes — keep that idiom.)

**Do not:**

- Do NOT change `DEFAULT_SETTINGS.fontFamily` (typography.ts:63 stays `'serif'`).
- Do NOT touch `FONT_STACKS.literata` here (that is E2).
- Do NOT add a preload for the serif stack (E2 deliberately preloads only explicit bundled families).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open any article on the Paper theme in Chrome with DevTools > Network filtered to "font" — on macOS no Literata request fires for the default Serif family; then in DevTools emulate a missing Iowan/Charter (or test on Android/Linux) and confirm `/fonts/literata-400.woff2` loads and the article renders in Literata, not DejaVu/Noto.

**Acceptance:**

- Default serif stack reads `"Iowan Old Style", Charter, "Literata", Georgia, serif` in both `FONT_STACKS.serif` and `--font-serif`.
- Apple platforms still resolve to Iowan Old Style with zero font downloads.
- `DEFAULT_SETTINGS.fontFamily` unchanged.

---

### E2: Metric-matched Literata fallback + pre-paint font preload

**Priority:** P1 · **Depends on:** E1 applied first (same region of typography.ts); E3 adds a Literata `@font-face` in the same area of app.css — the fallback block must end up after ALL Literata blocks.
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts`
- `/Users/luke/git/luke/Lectern/apps/web/src/app.html`

**Why:** When a user has selected Literata (or another bundled face), the first article reflows when the webfont swaps in. A `size-adjust`ed Georgia stand-in makes the swap near-invisible, and preloading the active face's woff2 before first paint (the app.html script already runs pre-paint and reads `localStorage['lectern.reader']`) removes the late fetch entirely.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/app.css` — after the last Literata `@font-face` block and before the first OpenDyslexic block. Currently the last Literata block is lines 64-70:

```css
@font-face {
  font-family: "Literata";
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/literata-400-italic.woff2") format("woff2");
}
```

(If E3 has already landed, the last Literata block is the 600-italic one instead — insert after that.) Insert immediately after it:

```css
/* Metric-matched Georgia stand-in shown while Literata downloads — size-adjust
   keeps line wraps stable so the swap doesn't reflow the column. */
@font-face {
  font-family: "Literata-fallback";
  src: local("Georgia");
  size-adjust: 94%;
  ascent-override: 92%;
}
```

2. `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts:77` — Current code:

```ts
	literata: '"Literata", Georgia, "Times New Roman", serif',
```

Change to:

```ts
	literata: '"Literata", "Literata-fallback", Georgia, "Times New Roman", serif',
```

3. `/Users/luke/git/luke/Lectern/apps/web/src/app.html:37-38` — Current code:

```js
var raw = localStorage.getItem("lectern.reader");
var t = raw ? JSON.parse(raw).theme || "auto" : "auto";
```

Change to:

```js
var raw = localStorage.getItem("lectern.reader");
var s = (raw ? JSON.parse(raw) : null) || {};
var t = s.theme || "auto";
```

4. `/Users/luke/git/luke/Lectern/apps/web/src/app.html:47-48` — Current code:

```js
var meta = document.querySelector('meta[name="theme-color"]');
if (meta) meta.setAttribute("content", BG[resolved] || "#f6f4ee");
```

Keep those two lines, and insert directly AFTER line 48 (still inside the `try` block, before `} catch (e) {}` on line 49), matching the surrounding tab indentation:

```js
// Preload the active bundled reading face (regular + italic where
// bundled) so the first article never swaps mid-read. System stacks
// (serif/sans/mono) preload nothing: Literata sits mid-stack in the
// default serif and is only fetched by engines that lack Iowan/Charter.
var FONT_FILES = {
  literata: ["/fonts/literata-400.woff2", "/fonts/literata-400-italic.woff2"],
  atkinson: [
    "/fonts/atkinson-hyperlegible-400.woff2",
    "/fonts/atkinson-hyperlegible-400-italic.woff2",
  ],
  lexend: ["/fonts/lexend-400.woff2"],
  opendyslexic: ["/fonts/opendyslexic-400.woff2"],
};
var faces = FONT_FILES[s.fontFamily] || [];
for (var i = 0; i < faces.length; i++) {
  var link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.crossOrigin = "anonymous";
  link.href = faces[i];
  document.head.appendChild(link);
}
```

File→family map is derived from the `@font-face` srcs in app.css:15-84 — Lexend and OpenDyslexic have no 400-italic file bundled, so they preload only the regular cut. `crossOrigin = 'anonymous'` is required: font preloads without it are double-fetched.

5. Run `pnpm format` at the repo root (lint runs `prettier --check .`, and app.html/app.css edits must be prettier-clean).

**Do not:**

- Do NOT splice `Literata-fallback` into `FONT_STACKS.serif` or `--font-serif` — only the `literata` family entry.
- Do NOT add `font-display` to the fallback face (it is a `local()` source; nothing downloads).
- Do NOT preload fonts for `s.fontFamily` values of `serif`, `sans`, or `mono`.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: set reading font to Literata in Display settings, hard-reload an article (Network tab, "Disable cache"): both `literata-400.woff2` and `literata-400-italic.woff2` appear as the first font requests with initiator "preload", and no layout shift is visible when the face arrives (throttle to Slow 3G to see the Georgia fallback hold the same line breaks). Repeat with fontFamily `serif`: zero `<link rel="preload" as="font">` tags in `<head>`.

**Acceptance:**

- `Literata-fallback` @font-face exists in app.css after the Literata faces, with `size-adjust: 94%; ascent-override: 92%; src: local('Georgia')`.
- `FONT_STACKS.literata` contains `"Literata-fallback"` immediately after `"Literata"`.
- Pre-paint script injects preload links only for literata/atkinson/lexend/opendyslexic, with crossorigin set.
- Malformed/absent localStorage still falls through silently (outer try/catch preserved).

---

### E3: Bundle Literata 600 italic

**Priority:** P1 · **Depends on:** none; coordinate with E2 (fallback block must stay after this new `@font-face`)
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/static/fonts/` (new file `literata-600-italic.woff2`)
- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`

**Why:** Bundled Literata cuts are 400, 600, and 400-italic only (current files in `apps/web/static/fonts/`: `atkinson-hyperlegible-400-italic.woff2`, `atkinson-hyperlegible-400.woff2`, `atkinson-hyperlegible-700.woff2`, `lexend-400.woff2`, `lexend-600.woff2`, `literata-400-italic.woff2`, `literata-400.woff2`, `literata-600.woff2`, `opendyslexic-400.woff2`, `opendyslexic-700.woff2`). `<strong><em>` text therefore renders a synthesized oblique of the 600 — counterfeit letterforms in a typography-first app. The real cut is ~21 KB.

**Steps:**

1. Download the latin-subset woff2 for Literata italic 600 from Google Fonts (same source as the existing files). Fetch the CSS with a Chrome UA so Google serves woff2:

```bash
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Literata:ital,wght@1,600&display=swap" -o /tmp/literata-600i.css
grep -A 8 '/\* latin \*/' /tmp/literata-600i.css
```

Copy the `url(https://fonts.gstatic.com/...woff2)` from the block under the `/* latin */` comment (the LAST block; not latin-ext, not cyrillic), then:

```bash
curl -s "<that gstatic url>" -o /Users/luke/git/luke/Lectern/apps/web/static/fonts/literata-600-italic.woff2
```

Sanity-check: `ls -la` the file — it should be roughly 15-30 KB, similar to `literata-400-italic.woff2`.

2. `/Users/luke/git/luke/Lectern/apps/web/src/app.css` — insert a new `@font-face` immediately after the existing Literata 400-italic block (lines 64-70, quoted in E2 step 1), matching the existing pattern exactly:

```css
@font-face {
  font-family: "Literata";
  font-style: italic;
  font-weight: 600;
  font-display: swap;
  src: url("/fonts/literata-600-italic.woff2") format("woff2");
}
```

3. Service worker: no change needed — verified. `/Users/luke/git/luke/Lectern/apps/web/src/service-worker.ts:25` builds the precache as `const PRECACHE = [...build, ...files, ...prerendered, SHELL_URL];` where `files` (from `$service-worker`) is everything in `static/`, so the new woff2 is precached automatically on the next deploy.

**Do not:**

- Do NOT download the full variable font or non-latin subsets.
- Do NOT add the file to FONT_STACKS or any preload list (italic-600 loads lazily on demand; only 400 + 400-italic are preloaded by E2).
- Do NOT edit service-worker.ts.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`, plus `pnpm --filter web build` to confirm the asset is picked up. Manual: open an article containing `<strong><em>` text with font set to Literata on the Paper theme — Network shows `literata-600-italic.woff2` load, and the bold-italic glyphs are no longer slanted uprights (compare the lowercase "a": true italic is single-storey).

**Acceptance:**

- `literata-600-italic.woff2` (latin subset, ~21 KB) exists in `apps/web/static/fonts/`.
- `@font-face` block for Literata italic/600 present in app.css, matching the file's existing block style.
- Bold-italic Literata renders the real cut; no synthesized oblique.

---

### E4: Lead the mono stack with ui-monospace

**Priority:** P2 · **Depends on:** none
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts`
- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`

**Why:** `"SF Mono"` is not exposed to web content by name on macOS — leading with it wastes the first slot. `ui-monospace` is the standards keyword that actually resolves to SF Mono on Apple platforms; it must come first and must be unquoted (quoting turns the keyword into a family-name lookup, which fails).

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts:76` — Current code:

```ts
	mono: '"SF Mono", "JetBrains Mono", ui-monospace, monospace',
```

Change to:

```ts
	mono: 'ui-monospace, "SF Mono", "JetBrains Mono", monospace',
```

2. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:90` — Current code:

```css
--font-mono: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
```

Change to:

```css
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
```

**Do not:**

- Do NOT quote `ui-monospace` anywhere — it is a generic-family keyword, not a font name.
- Do NOT drop the `"SF Mono"` / `"JetBrains Mono"` entries (they still help users who installed them on Windows/Linux).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: on macOS, open an article with a code block (any theme) and check DevTools > Computed > Rendered Fonts on a `pre` — it should report "SF Mono" (resolved via ui-monospace), not Courier/Menlo-via-monospace.

**Acceptance:**

- Both mono stacks lead with unquoted `ui-monospace`.
- macOS Safari/Chrome render code blocks in SF Mono; other platforms fall through to JetBrains Mono or the UA monospace.

---

### E5: Raise muted text to AAA on Paper, Sepia, Dark, Black

**Priority:** P2 · **Depends on:** none (touches the same app.css blocks as E6/E10 — apply in any order, edits are on distinct lines)
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`

**Why:** `--text-muted` carries bylines, captions, panel labels, and the entire Info rail, but sits at 5.3-6.5:1 on four themes. The replacement hexes pass 7:1 (AAA) while keeping each theme's warm tint.

Grep check performed: the four current hexes appear ONLY in app.css (no Svelte/TS file hardcodes them). Occurrences: `#6b6457` at app.css:130 and app.css:171; `#6f5d3f` at app.css:194; `#a39c8d` at app.css:239 and app.css:310 (the `auto` dark media block mirrors the dark palette and must be kept in sync); `#8c8c8c` at app.css:262. No other places to update.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:130` — inside the `:root` block (the light/Paper defaults). Current code:

```css
--text-muted: #6b6457;
```

Change to:

```css
--text-muted: #56503f;
```

2. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:171` — inside `[data-theme='light']`. Current code:

```css
--text-muted: #6b6457;
```

Change to:

```css
--text-muted: #56503f;
```

3. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:194` — inside `[data-theme='sepia']`. Current code:

```css
--text-muted: #6f5d3f;
```

Change to:

```css
--text-muted: #564a2e;
```

4. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:239` — inside `[data-theme='dark']`. Current code:

```css
--text-muted: #a39c8d;
```

Change to:

```css
--text-muted: #aea797;
```

5. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:262` — inside `[data-theme='black']`. Current code:

```css
--text-muted: #8c8c8c;
```

Change to:

```css
--text-muted: #a09a90;
```

(This also makes Black's muted ink warm, matching E6's warm `--text`.)

6. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:310` — inside the `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ... } }` block (the `auto` theme, which mirrors dark). Current code:

```css
--text-muted: #a39c8d;
```

Change to:

```css
--text-muted: #aea797;
```

**Do not:**

- Do NOT touch Newsprint (`#5a4527` at app.css:218 already passes) or Contrast (`#d8d8d8` at app.css:287).
- Do NOT change any `--text` value here (Black's `--text` is E6).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: open an article on each of Paper, Sepia, Dark, Black — byline/Info-panel labels are still clearly "muted" relative to body ink but darker/brighter than before; spot-check contrast in DevTools (inspect a `.byline`, the color picker shows the ratio): `#56503f` on `#f6f4ee`, `#564a2e` on `#f4ecd8`, `#aea797` on `#1a1815`, `#a09a90` on `#000000` must each report ≥ 7.0:1. Also confirm Auto theme in OS-dark mode picked up the new dark value.

**Acceptance:**

- All six listed lines updated; old hexes no longer appear anywhere in `apps/web/src`.
- Muted text ≥ 7:1 on Paper, Sepia, Dark, Black.
- Dark and the auto-dark media block remain identical palettes.

---

### E6: Warm the Black theme ink and fix the swatch drift

**Priority:** P2 · **Depends on:** none (supersedes A10 — do not apply both)
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts`

**Why:** `#dcdcdc` on `#000` is 15.3:1 — bright enough to halate for astigmatic night readers — and is the only cold-neutral ink in an otherwise warm system. `#cfcdc8` keeps AAA while dropping glare and matching the system's warmth. The theme-picker swatch (`THEME_SWATCHES.black.fg`) has already drifted to `#d9d9d9` and must be synced to the real ink.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:261` — inside `[data-theme='black']`. Current code:

```css
--text: #dcdcdc;
```

Change to:

```css
--text: #cfcdc8;
```

2. `/Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts:101` — Current code:

```ts
	black: { label: 'Black', bg: '#000000', fg: '#d9d9d9' },
```

Change to:

```ts
	black: { label: 'Black', bg: '#000000', fg: '#cfcdc8' },
```

3. If C7 has landed, also update `THEME_TEXT.black` in typography.ts from `#dcdcdc` to `#cfcdc8`.

**Do not:**

- Do NOT change `THEME_BG.black` or the Contrast theme's `#ffffff`.
- Do NOT change Black's `--bg`.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: switch to the Black theme, open an article — body ink reads slightly warm (compare against Contrast's pure white), and the Black swatch in the theme picker (Display popover and Settings page) shows the same ink as the rendered page.

**Acceptance:**

- `[data-theme='black'] --text` is `#cfcdc8` (≈13:1 on #000, still AAA).
- `THEME_SWATCHES.black.fg` is `#cfcdc8` — no drift between swatch and theme.

---

### E7: Replace background-attachment: fixed with a fixed pseudo-element

**Priority:** P2 · **Depends on:** none
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`

**Why:** `background-attachment: fixed` on `body` forces full-page repaint on every scroll frame on iOS and low-end Android. A `position: fixed` pseudo-element gets its own compositor layer and scrolls for free. The `html` element already paints `var(--bg)` (app.css:336), so `body` can stop painting a background entirely and the wash moves to `body::before` at `z-index: -1`.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/app.css:340-357` — Current code:

```css
body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--text-base);
  line-height: 1.55;
  background:
    radial-gradient(
      120% 55% at 50% -8%,
      color-mix(in srgb, var(--accent) 6%, transparent),
      transparent 60%
    ),
    var(--bg);
  background-attachment: fixed;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
```

Change to:

```css
body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--text-base);
  line-height: 1.55;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

/* The faint accent wash behind the whole app. Lives on a fixed pseudo-element
   (own compositor layer) instead of body { background-attachment: fixed },
   which forces repaint-on-scroll on iOS/low-end Android. The solid ground is
   painted by `html` above; this sits between it and all content (z-index: -1,
   body creates no stacking context, so content always paints over it). */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(
    120% 55% at 50% -8%,
    color-mix(in srgb, var(--accent) 6%, transparent),
    transparent 60%
  );
}
```

Note: `var(--bg)` is deliberately dropped from `body` — `html { background: var(--bg) }` (app.css:336, unchanged) remains the opaque ground covering overscroll/safe-area, and the `::before` paints the wash above it.

2. Stacking sanity (already accounted for — verify, don't change): the grain overlays are per-surface pseudo-elements over their own opaque backgrounds, unaffected; sticky bars that paint `background: var(--bg)` sit over the wash exactly as before.

**Do not:**

- Do NOT keep any `background` declaration on `body`.
- Do NOT use a child div instead — `::before` keeps the DOM clean.
- Do NOT touch the `html` rule.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test` and `pnpm format`. Manual: on Paper theme, the faint blue wash is still visible at the top of the viewport and does NOT scroll with content (scroll a long article — the wash stays pinned, identical to before); check Dark theme too. Open the newspaper (Newsprint theme) and FlipReader surfaces — grain unchanged. In DevTools > Rendering > Paint flashing, scrolling an article no longer flashes the entire viewport.

**Acceptance:**

- `background-attachment: fixed` no longer appears anywhere in app.css.
- Visual parity: wash position, strength, and theme behavior identical on all six themes.
- Scrolling no longer triggers full-viewport repaints.

---

### E8: Thin, theme-tinted scrollbars

**Priority:** P2 · **Depends on:** none
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`

**Why:** Windows/Linux render default UA scrollbar chrome directly beside the prose column. `scrollbar-width: thin` + a `--border-strong`-tinted thumb makes them quiet and theme-aware (Firefox everywhere; Chromium 121+). Grep check performed: zero existing scrollbar styles in `apps/web/src`, nothing conflicts.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/app.css` — insert after the `::selection` block (currently lines 393-396; A3 may have changed its colors — the anchor is the block, not its content), before the `.page` rule. Insert:

```css
/* Thin, theme-tinted scrollbars (Firefox; Chromium 121+). macOS overlay
   scrollbars ignore these. Keeps heavy UA chrome off the prose column on
   Windows/Linux. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
```

**Do not:**

- Do NOT add `::-webkit-scrollbar` rules — they disable Chromium's native `scrollbar-color` path and re-introduce styling drift.
- Do NOT scope to specific containers; the universal selector has zero specificity and lets the tokens re-theme per `data-theme` subtree (the reader's themed `.doc` included).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: in Firefox or Chrome 121+ on the Paper theme, open a long article — the window scrollbar is thin with a warm `#d6cfbf` thumb on a transparent track; switch to Dark and confirm the thumb re-tints; open the highlights Notebook rail (its list scrolls) and confirm the inner scrollbar is thin too.

**Acceptance:**

- One global rule added; no `-webkit-` scrollbar CSS anywhere.
- Scrollbars are thin and use `--border-strong` on all themes, in both the main window and inner scrollers.

---

### E9: Composite highlight and find-hit washes in oklab

**Priority:** P2 · **Depends on:** A4 — A4 restructures `mark.lectern-hl` (solid + multiply via `--hl-mix`/`--hl-blend`). Apply this to wherever the translucent `color-mix` washes live after A4 lands; the rules below quote the pre-A4 state as reference.
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`

**Why:** sRGB-space `color-mix` darkens and dirties translucent tint composites (hue shift toward gray). `in oklab` keeps the mixed wash perceptually even across the five highlight hues and the accent, with no other code change. (Per the review, the full OKLCH palette refactor is deliberately skipped — only these two mixes change.)

**Steps:**

1. The highlight mark wash. Pre-A4 current code (read/[id]/+page.svelte:1854-1859):

```css
.doc :global(mark.lectern-hl) {
  background: color-mix(in srgb, var(--hl, #e0b341) 38%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0.05em 0;
}
```

Change the `background` line's `in srgb` to `in oklab` (everything else stays). Post-A4, the rule reads `color-mix(in srgb, var(--hl, #e0b341) var(--hl-mix, 100%), transparent)` — change that `in srgb` to `in oklab` instead (the dark-theme translucent path benefits; the light-theme 100% solid path is unaffected by the color space).

2. The find-hit wash (read/[id]/+page.svelte:1925-1928). Current code:

```css
.doc :global(mark.find-hit) {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border-radius: 2px;
}
```

Change to:

```css
.doc :global(mark.find-hit) {
  background: color-mix(in oklab, var(--accent) 22%, transparent);
  border-radius: 2px;
}
```

**Do not:**

- Do NOT touch the other `color-mix(in srgb, ...)` calls in this file (adaptive accent, focus dim — that one is E10, skeleton shimmer) — they mix toward opaque theme colors where srgb is fine and hand-tuned.
- Do NOT convert any app.css mixes.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: on the Dark theme, highlight a sentence in each of the five colors — washes look evenly saturated, none muddier than the rest; open find (Cmd/Ctrl+F), search a common word, and confirm hit washes on Paper and Dark are clean accent tints.

**Acceptance:**

- Both mark washes use `color-mix(in oklab, ...)`; percentages unchanged.
- No srgb→oklab change applied to any other rule.

---

### E10: Raise focus-mode residual ink to 38% on light themes

**Priority:** P2 · **Depends on:** none (E5 and E10 both append lines to the app.css theme blocks — anchor on the quoted text, not line numbers)
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/app.css`
- `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`

**Why:** Focus mode dims non-focused prose to a 30% ink mix — on Sepia/Newsprint that residual is too faint to skim back across. Light themes need 38%; dark themes are correct at 30%. Theme scoping cannot be done with selectors in the page: the reader's `.doc` sets its own `data-theme` only when overriding (`+page.svelte:906-913`), otherwise it inherits the app theme from `<html data-theme>` — and `auto` has no attribute at all. A per-theme token in app.css cascades correctly through every one of those paths, so we add `--focus-dim` to each theme block (every block redeclares all tokens; this follows the file's pattern).

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/app.css` — add the token to all eight palette declarations. In `:root`, insert after the `--grain-strength: 0.12;` line (post-A4/B1, anchor on that text):

```css
/* Focus-mode residual ink: % of --text kept on non-focused prose. Light
	   paper needs more residual than dark grounds to stay skimmable. */
--focus-dim: 38%;
```

Then, in each theme block, insert one line immediately after that block's `--edge-hi: ...;` line (or after the A4-added `--hl-blend` line if present):

- `[data-theme='light']`: `	--focus-dim: 38%;`
- `[data-theme='sepia']`: `	--focus-dim: 38%;`
- `[data-theme='newsprint']`: `	--focus-dim: 38%;`
- `[data-theme='dark']`: `	--focus-dim: 30%;`
- `[data-theme='black']`: `	--focus-dim: 30%;`
- `[data-theme='contrast']`: `	--focus-dim: 30%;`
- the `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ... } }` block (two-tab indent): `		--focus-dim: 30%;`

2. `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte:1161-1166` — Current code:

```css
/* Focus mode: spotlight the focused block by fading the rest of the prose.
	   Uses colour (not opacity) so nested blocks never double-dim. */
.doc.focus-on article {
  color: color-mix(in srgb, var(--text) 30%, var(--bg));
  transition: color var(--dur) var(--ease);
}
```

Change to:

```css
/* Focus mode: spotlight the focused block by fading the rest of the prose.
	   Uses colour (not opacity) so nested blocks never double-dim. Residual ink
	   is per-theme (--focus-dim): light paper keeps 38%, dark grounds 30%. */
.doc.focus-on article {
  color: color-mix(in srgb, var(--text) var(--focus-dim, 30%), var(--bg));
  transition: color var(--dur) var(--ease);
}
```

**Do not:**

- Do NOT scope with `[data-theme]` selectors in the Svelte file — it misses the inherited-theme and `auto` cases.
- Do NOT change the `.lectern-focus` restore rule (lines 1167-1169).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: enter focus mode (`f`) on Sepia — dimmed paragraphs are now readable-at-a-glance but clearly subordinate; on Dark, dimming looks unchanged from before. Then set reader theme override to Sepia while the app theme is Dark: the sepia `.doc` pane must use the 38% residual, not the app's 30%.

**Acceptance:**

- `--focus-dim` declared in `:root`, all six theme blocks, and the auto-dark media block (38% light family / 30% dark family).
- Focus dim rule consumes `var(--focus-dim, 30%)`.
- Theme-override reader panes pick up their own theme's value.

---

### E11: Structured byline lockup (eyebrow → balanced title → byline)

**Priority:** P1 · **Depends on:** none (coordinate with A7: author values should render through `displayAuthor()` if A7 has landed)
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`

**Why:** The current header is a template: `siteName ?? author ?? hostname` means author and publication never appear together, and the publish date (`card.publishedAt`, an ISO string | null on the shared Card model — `packages/shared/src/model.ts:86`) never shows at all. Top-tier readers set a lockup: a letterspaced source eyebrow, a balanced title, then "By {author} · {date} · {n} min read". The spacing rhythm (0.5rem all around) also reads cramped.

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte:917-924` — Current code:

```svelte
		{#if card}
			<h1>{card.title}</h1>
			<p class="byline">
				{card.siteName ?? card.author ?? new URL(card.url).hostname}
				{#if card.readingTimeMinutes}<span class="dot">·</span>{card.readingTimeMinutes} min read{/if}
			</p>
			<div class="tageditor"><TagEditor id={card.id} tags={card.tags} /></div>
		{/if}
```

Change to (if A7 landed, write `By {displayAuthor(card.author)}` instead of `By {card.author}`):

```svelte
		{#if card}
			<div class="eyebrow">{card.siteName ?? new URL(card.url).hostname}</div>
			<h1>{card.title}</h1>
			{#if card.author || card.publishedAt || card.readingTimeMinutes}
				<p class="byline">
					{#if card.author}By {card.author}{/if}
					{#if card.publishedAt}
						{#if card.author}<span class="dot">·</span>{/if}{new Date(
							card.publishedAt
						).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
					{/if}
					{#if card.readingTimeMinutes}
						{#if card.author || card.publishedAt}<span class="dot">·</span>
						{/if}{card.readingTimeMinutes} min read
					{/if}
				</p>
			{/if}
			<div class="tageditor"><TagEditor id={card.id} tags={card.tags} /></div>
		{/if}
```

(The date format matches the existing idiom at line 1011, which formats `card.savedAt` the same way for the Info panel.)

2. Same file, the lockup CSS at lines 1291-1305 — Current code:

```css
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
```

Change to:

```css
/* Title lockup: source eyebrow → balanced title → byline. The eyebrow
	   carries the lockup's 1.2rem top space; the h1 sits 0.5rem under it. */
.eyebrow {
  margin: 1.2rem 0 0;
  font-family: var(--font-ui);
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
h1 {
  font-family: var(--font-serif);
  font-size: clamp(1.7rem, 1.2rem + 2vw, 2.4rem);
  line-height: 1.15;
  letter-spacing: -0.015em;
  margin: 0.5rem 0 0.65rem;
  text-wrap: balance;
}
.byline {
  margin: 0 0 1.4rem;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.dot {
  margin: 0 0.4rem;
}
```

(Rhythm note: the review's "h1 margin 1.2rem 0 0.65rem" assumed no element above the title; with the eyebrow always rendered, the eyebrow takes the 1.2rem top and the h1 keeps a tight 0.5rem to its eyebrow — total lockup spacing is preserved.)

3. Run `pnpm format` (the multi-line `{#if}` chains must be prettier-clean).

**Do not:**

- Do NOT move or remove the `.tageditor` block (relocating "Add tag…" out of the masthead is deferred — see "Not yet packetized" in README).
- Do NOT fall back to `card.savedAt` when `publishedAt` is null — the byline shows a date only when the source actually published one.
- Do NOT show both siteName and hostname; eyebrow is `siteName ?? hostname`.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual on Paper theme: (1) an RSS article with author + publishedAt shows the eyebrow above the title and `By Author · Jun 9, 2026 · 12 min read` below it, dots correctly placed; (2) a doc with no author but a date shows `Jun 9, 2026 · 12 min read` with no leading dot; (3) a doc with neither shows only `12 min read`; (4) a doc with none of the three renders no byline element at all; (5) a long title wraps balanced (no single-word last line) in Chrome.

**Acceptance:**

- Eyebrow (uppercase, 0.08em tracking, `--text-2xs`, muted) renders for every card.
- Author + date + reading time can all appear together; separators never lead or trail.
- h1 uses `text-wrap: balance`; byline uses tabular figures; margins are 1.2rem-top / 0.65rem-below-title / 1.4rem-below-byline.

---

### E12: Grain on the reader's .doc surface

**Priority:** P2 · **Depends on:** none
**Files:**

- `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte`

**Why:** Every print surface lays `var(--grain)` paper tooth over its ground (FlipReader.svelte:329-341, MagazineReader.svelte:221, newspaper:291, magazine:236), but the flagship reader is flat — the one surface users spend the most time on is the only glassy one. Decision: add it, matching the print surfaces at `var(--grain-strength)`, using FlipReader's pattern (grain pseudo-element at z 0, content raised to z 1) so the texture sits under the text and never tints glyphs or interferes with selection.

FlipReader's reference pattern (FlipReader.svelte:329-348, do not modify):

```css
.flip::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: var(--grain);
  background-size: 180px 180px;
  opacity: var(--grain-strength);
  mix-blend-mode: soft-light;
}
/* Keep the chrome and reading column above the grain. */
.flipbar,
.stage {
  position: relative;
  z-index: 1;
}
```

**Steps:**

1. `/Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte:1252-1267` — Current code (anchor; the two existing rules stay as they are):

```css
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
```

Insert immediately AFTER the `.doc.themed` rule's closing `}` (and BEFORE the `.focus-bar` rule that follows it — this ordering matters, see step 2 note):

```css
/* The same paper grain the print surfaces wear (see FlipReader.svelte) —
	   the reading column has tooth, not glass. Soft-light over the page ground
	   (or the .themed pane's own surface), under all content. */
.doc::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  border-radius: inherit;
  background-image: var(--grain);
  background-size: 180px 180px;
  opacity: var(--grain-strength);
  mix-blend-mode: soft-light;
}
/* Keep the title lockup, prose, and panels above the grain so text is never
	   blended or selection-tinted. */
.doc > * {
  position: relative;
  z-index: 1;
}
```

2. Placement/stacking notes (already accounted for — verify, don't change):

- `.doc` is already `position: relative`, so the `::before` fills the column.
- `.doc > *` and `.focus-bar` have equal specificity under Svelte scoping; because the `.focus-bar { position: absolute; ... }` rule comes LATER in the file than the new `.doc > *` rule, the focus bar keeps `position: absolute` and merely gains `z-index: 1` — above the grain, as intended. Do not move the new rules below `.focus-bar`.
- The highlight popover (`.hl-popover`) and toasts are outside `.doc` — unaffected.
- `border-radius: inherit` rounds the grain to the `.themed` pane's `--radius-lg` corners; on the unthemed `.doc` it inherits 0.
- Text selection: glyphs and `::selection` paint in the z 1 content layer, above the grain; `pointer-events: none` keeps drag-selection working through it.

**Do not:**

- Do NOT use `z-index: -1` on the `::before` — without a stacking context on `.doc` it would slide beneath the `.themed` pane's background and vanish.
- Do NOT add `isolation: isolate` to `.doc` (it would stop the soft-light blend reaching the page ground on the unthemed reader).
- Do NOT raise `--grain-strength`; the reader uses the global 0.12 like every other surface.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual: on Paper, open an article and zoom to 200% — faint tooth is visible across the reading column, text edges stay crisp; select a paragraph (selection renders normally, popover appears); enter focus mode (focus bar still visible at left); set reader theme override to Sepia inside a Dark app — the floating sepia pane shows grain within its rounded corners only. Compare side-by-side with the FlipReader surface: same texture scale.

**Acceptance:**

- `.doc::before` grain matches the FlipReader recipe (180px tile, soft-light, `var(--grain-strength)`).
- Grain sits under all `.doc` content; selection, highlight popover, focus bar, and TagEditor unaffected.
- Themed pane grain respects the pane's border radius.

---

### E13: Type scale collapse — SKIPPED (recorded decision)

**Priority:** P2 · **Depends on:** n/a
**Files:** none
**Why:** Evaluated per spec: `grep -rn -- '--text-2xs' apps/web/src` returns **37 usages** across 17 files (MagazineReader, FlipReader, ListView, ShortcutsHelp, WhatsNew, CommandPalette, +layout, read/[id], newspaper, magazine, search, feeds, views, changelog, home). The threshold for collapsing into `--text-xs` was <10 usages; at 37 call sites the mechanical replacement risk (each site hand-chose 11px vs 12px in dense chrome like kickers and folios) outweighs the token-count win.
**Steps:** none — do not implement.
**Do not:** Do not delete or alias `--text-2xs`.
**Acceptance:**

- No change; `--text-2xs` retained. Rationale recorded: 37 usages ≥ the 10-usage threshold set for this packet.
