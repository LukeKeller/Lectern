# Phase B — Shared Prose Layer

Read `README.md` in this directory first (guardrails, verification, commit rules).
B1 must land before B2-B5 and B7. B6 is independent.
If quoted "Current code" does not match the file, stop and report the mismatch.

---

### B1: Create the shared prose stylesheet and per-theme prose tokens
**Priority:** P0 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/styles/prose.css (new), /Users/luke/git/luke/Lectern/apps/web/src/app.css, /Users/luke/git/luke/Lectern/apps/web/src/routes/+layout.svelte
**Why:** All three reading surfaces duplicate (and drift on) prose styling. One global `.lectern-prose` layer plus `--prose-*` theme tokens gives every future typography fix a single home and adds the missing micro-typography and dark-theme compensation.

**Steps:**

1. Create directory and file `/Users/luke/git/luke/Lectern/apps/web/src/lib/styles/prose.css`. Create file with content (use tabs for indentation, matching the repo):

```css
/**
 * Lectern shared prose layer.
 *
 * `.lectern-prose` is the single home for article-body typography across the
 * three reading surfaces (full reader, magazine, newspaper/flip). Surfaces keep
 * their own voice (drop caps, columns, measures) in component styles; anything
 * that styles the *content* of an article lives here.
 *
 * Driven by two families of custom properties:
 *  - `--reader-*` : user typography settings (emitted by readerCssVars onto the
 *    full reader's `.doc`; the print surfaces fall back to sensible defaults).
 *  - `--prose-*`  : prose tokens defined in app.css (`:root` for the invariant
 *    ones; per-theme blocks override the dark-compensation pair).
 *
 * Each surface owns `font-family`, `font-size` and `line-height` on the
 * container — line-height must include `var(--prose-leading-boost, 0)` so dark
 * themes read at the same optical density as light ones.
 */

.lectern-prose {
	color: var(--prose-fg, var(--text));
	font-kerning: normal;
	font-variant-ligatures: common-ligatures;
	font-variant-numeric: oldstyle-nums proportional-nums;
	/* Progressive enhancement (Safari): hang opening quotes into the margin. */
	hanging-punctuation: first allow-end;
}

/* ---- Block rhythm ---- */

.lectern-prose p,
.lectern-prose ul,
.lectern-prose ol,
.lectern-prose blockquote,
.lectern-prose pre,
.lectern-prose figure,
.lectern-prose table {
	margin: 0 0 var(--reader-para-gap, 1em);
}

.lectern-prose p {
	text-wrap: pretty;
	hyphens: auto;
}

/* ---- Headings ----
   No `color` here: headings inherit the container ink so the full reader's
   focus-mode dimming (which recolours the container) still applies to them.
   Weight 600, never 650 — the bundled cuts are 400/600 and anything else
   synthesizes. In-content h1 gets the h2 treatment as a post-demotion safety
   net for articles whose lead h1 survives sanitize. */

.lectern-prose h1,
.lectern-prose h2,
.lectern-prose h3,
.lectern-prose h4 {
	font-family: var(--prose-heading-font, var(--font-serif));
	font-weight: 600;
	line-height: 1.25;
	letter-spacing: -0.01em;
	text-wrap: balance;
}
.lectern-prose h1,
.lectern-prose h2 {
	font-size: 1.45em;
	margin: 2em 0 0.65em;
}
.lectern-prose h3 {
	font-size: 1.2em;
	margin: 1.6em 0 0.5em;
}
/* h4 as a letterspaced uppercase eyebrow — a small kicker level. */
.lectern-prose h4 {
	font-size: 0.85em;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	margin: 1.6em 0 0.5em;
}

/* ---- Links ----
   Body links keep the text ink with an accent-tinted underline; full accent
   arrives on hover. Link-dense articles stop reading blue-speckled. */

.lectern-prose a {
	color: inherit;
	text-decoration: underline;
	text-decoration-thickness: 1px;
	text-decoration-color: color-mix(in srgb, var(--prose-link, var(--accent)) 60%, transparent);
	text-underline-offset: 0.16em;
}
.lectern-prose a:hover {
	color: var(--prose-link, var(--accent));
	text-decoration-color: var(--prose-link, var(--accent));
}

/* ---- Blockquote ----
   One signal (the rule), full ink, slightly smaller — not border + italic +
   muted all at once. */

.lectern-prose blockquote {
	color: var(--prose-quote-fg, var(--text));
	font-style: normal;
	font-size: 0.97em;
	border-left: 2px solid var(--border-strong);
	padding-left: 1.2em;
}

/* ---- Tables ----
   Editorial rules: horizontal only, heavier head rule, lining tabular figures.
   `display: block; overflow-x: auto` lets wide tables scroll instead of
   blowing out the measure. */

.lectern-prose table {
	display: block;
	overflow-x: auto;
	max-width: 100%;
	border-collapse: collapse;
	font-size: 0.92em;
}
.lectern-prose th,
.lectern-prose td {
	padding: 0.5em 0.7em;
	border: 0;
	border-bottom: 1px solid var(--border);
	text-align: left;
	font-variant-numeric: tabular-nums lining-nums;
}
.lectern-prose thead th {
	border-bottom-width: 2px;
	font-size: 0.85em;
	letter-spacing: 0.02em;
}

/* ---- Images, video, figures ---- */

.lectern-prose img,
.lectern-prose video {
	display: block;
	max-width: 100%;
	height: auto;
	margin-block: 0 var(--reader-para-gap, 1em);
	margin-inline: auto;
	border-radius: 2px;
	filter: var(--prose-img-filter, none);
}
.lectern-prose figure img,
.lectern-prose figure video {
	margin-block: 0;
}
.lectern-prose figure {
	margin-inline: 0;
}
.lectern-prose figcaption {
	margin-top: 0.5em;
	font-family: var(--font-ui);
	font-size: 0.8em;
	line-height: 1.45;
	color: var(--prose-faded, var(--text-muted));
	text-align: left;
}

/* ---- Horizontal rule: a short centered rest, not border-to-border ---- */

.lectern-prose hr {
	width: 5rem;
	margin: 2.6em auto;
	border: 0;
	border-top: 1px solid var(--border-strong);
}

/* ---- Lists ----
   Hanging-marker approximation: zero list padding, indent the items, so
   markers sit in the margin and text stays on the measure. */

.lectern-prose ul,
.lectern-prose ol {
	padding-left: 0;
}
.lectern-prose li {
	margin-left: 1.4em;
	margin-bottom: 0.4em;
}
.lectern-prose li::marker {
	color: var(--prose-faded, var(--text-muted));
}
.lectern-prose li li {
	margin-bottom: 0.2em;
}
.lectern-prose li ul,
.lectern-prose li ol {
	margin-top: 0.2em;
	margin-bottom: 0;
}

/* ---- Superscript / subscript: never disturb the leading ---- */

.lectern-prose sup,
.lectern-prose sub {
	font-size: 0.72em;
	line-height: 0;
	position: relative;
}
.lectern-prose sup {
	top: -0.45em;
}
.lectern-prose sub {
	top: 0.25em;
}

/* ---- Code ----
   Reset the user's prose tracking/word-spacing and the oldstyle figures;
   code wants its own metrics. */

.lectern-prose code {
	font-family: var(--font-mono);
	font-size: 0.88em;
	padding: 0.12em 0.36em;
	border-radius: var(--radius-sm);
	background: var(--prose-code-bg, var(--surface-alt));
	letter-spacing: 0;
	word-spacing: 0;
	font-variant-numeric: normal;
}
.lectern-prose pre {
	padding: 1em 1.1em;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--prose-code-bg, var(--surface-alt));
	overflow-x: auto;
	line-height: 1.5;
	letter-spacing: 0;
	word-spacing: 0;
	tab-size: 2;
	font-variant-numeric: normal;
}
.lectern-prose pre code {
	padding: 0;
	background: transparent;
	font-size: 0.85em;
}
```

2. Import it globally, following the existing app.css pattern. /Users/luke/git/luke/Lectern/apps/web/src/routes/+layout.svelte:2. Current code:

```svelte
	import '../app.css';
```

Change to:

```svelte
	import '../app.css';
	import '$lib/styles/prose.css';
```

3. Define the theme-invariant prose tokens once in `:root`. Design decision: `--prose-fg/--prose-faded/--prose-quote-fg/--prose-link/--prose-code-bg/--prose-heading-font` hold unresolved `var()` references, which substitute against the *consuming element's* theme — so they only need defining once; only the dark-compensation pair (`--prose-leading-boost`, `--prose-img-filter`) varies per theme block. /Users/luke/git/luke/Lectern/apps/web/src/app.css:154-156. Current code:

```css
	--grain: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
	--grain-strength: 0.12;
}
```

Change to:

```css
	--grain: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
	--grain-strength: 0.12;

	/* Prose layer (lib/styles/prose.css). These hold var() references that
	   resolve against the consuming element's theme, so they are defined once;
	   only the dark-compensation pair below varies per theme block. */
	--prose-fg: var(--text);
	--prose-faded: var(--text-muted);
	--prose-quote-fg: var(--text);
	--prose-link: var(--accent);
	--prose-code-bg: var(--surface-alt);
	--prose-heading-font: var(--font-serif);
	--prose-leading-boost: 0;
	--prose-img-filter: none;
}
```

*Coordination note: A4 (Phase A) appends `--hl-mix`/`--hl-blend` to the same `:root` and theme blocks. Either order works — anchor on the quoted text, not line numbers.*

4. Light theme block (must explicitly reset the pair — a Paper reader pane can sit inside a dark app). /Users/luke/git/luke/Lectern/apps/web/src/app.css:183-185. Current code:

```css
	--shadow-md: 0 6px 20px rgba(31, 28, 22, 0.1), 0 1px 3px rgba(31, 28, 22, 0.06);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.55);
}
```

Change to:

```css
	--shadow-md: 0 6px 20px rgba(31, 28, 22, 0.1), 0 1px 3px rgba(31, 28, 22, 0.06);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.55);
	--prose-leading-boost: 0;
	--prose-img-filter: none;
}
```

5. Sepia block, app.css:206-208. Current code:

```css
	--shadow-md: 0 6px 20px rgba(67, 54, 31, 0.12), 0 1px 3px rgba(67, 54, 31, 0.07);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
```

Change to:

```css
	--shadow-md: 0 6px 20px rgba(67, 54, 31, 0.12), 0 1px 3px rgba(67, 54, 31, 0.07);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.5);
	--prose-leading-boost: 0;
	--prose-img-filter: none;
}
```

6. Newsprint block, app.css:229-231. Current code:

```css
	--shadow-md: 0 6px 20px rgba(43, 31, 16, 0.12), 0 1px 3px rgba(43, 31, 16, 0.07);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
```

Change to:

```css
	--shadow-md: 0 6px 20px rgba(43, 31, 16, 0.12), 0 1px 3px rgba(43, 31, 16, 0.07);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.45);
	--prose-leading-boost: 0;
	--prose-img-filter: none;
}
```

7. Dark block, app.css:251-253. Current code:

```css
	--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

Change to:

```css
	--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	/* Light-on-dark reads optically thinner/tighter; open the leading slightly
	   and pull full-brightness images back from the flashlight effect. */
	--prose-leading-boost: 0.06;
	--prose-img-filter: brightness(0.86) contrast(1.02);
}
```

8. Black block, app.css:274-276. Current code:

```css
	--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(0, 0, 0, 0.5);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

Change to:

```css
	--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(0, 0, 0, 0.5);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.05);
	--prose-leading-boost: 0.06;
	--prose-img-filter: brightness(0.86) contrast(1.02);
}
```

9. Contrast block (design decision: leading boost yes — it is a dark theme; image dimming no — this theme is tuned for low vision and bright sun, images stay full brightness). app.css:298-300. Current code:

```css
	--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.18);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
```

Change to:

```css
	--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.18);
	--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.12);
	--prose-leading-boost: 0.06;
	/* Low-vision theme: keep images at full brightness. */
	--prose-img-filter: none;
}
```

10. The `auto` dark mirror block (do not forget it — it mirrors the dark palette for OS-dark with no data-theme attribute). app.css:322-324. Current code:

```css
		--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
		--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}
```

Change to:

```css
		--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
		--edge-hi: inset 0 1px 0 rgba(255, 255, 255, 0.04);
		--prose-leading-boost: 0.06;
		--prose-img-filter: brightness(0.86) contrast(1.02);
	}
```

**Do not:** Do not put `.lectern-prose` rules inside any Svelte component `<style>` block. Do not use `:global()` in prose.css (it is a plain global stylesheet; plain selectors apply to `{@html}` content). Do not set `line-height`, `font-family`, or `font-size` on `.lectern-prose` itself — surfaces own those. Do not add `color` to the heading rules. Do not change any non-prose token in app.css.
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` from the repo root. Manual: app boots with no visual change yet (no element carries the class until B2-B4); inspect devtools on `<html>` for `--prose-leading-boost: 0` (Paper) and `0.06` (Dark).
**Acceptance:**
- `apps/web/src/lib/styles/prose.css` exists with exactly the rule set above and is imported in `+layout.svelte`.
- All six theme blocks plus the `prefers-color-scheme: dark` auto block define `--prose-leading-boost`/`--prose-img-filter`; `:root` defines the six invariant tokens.
- Prettier passes (prose.css is covered by `pnpm lint`).

---

### B2: Adopt .lectern-prose in the full reader and delete its superseded prose CSS
**Priority:** P0 · **Depends on:** B1
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte
**Why:** The full reader's scoped prose rules are now duplicated by the shared layer; keeping both invites drift. The article container keeps only the `--reader-*` plumbing plus reader-specific features (focus mode, highlights, find-hits).

**Steps:**

1. Add the class to the article container. read/[id]/+page.svelte:960-961. Current code:

```svelte
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<article bind:this={articleEl}>{@html html}</article>
```

Change to:

```svelte
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<article class="lectern-prose" bind:this={articleEl}>{@html html}</article>
```

2. Balance the title (the shared layer balances in-content headings; the template h1 is scoped, so it needs its own line). read/[id]/+page.svelte:1291-1297. Current code:

```css
	h1 {
		font-family: var(--font-serif);
		font-size: clamp(1.7rem, 1.2rem + 2vw, 2.4rem);
		line-height: 1.15;
		letter-spacing: -0.015em;
		margin: 0.5rem 0 0.5rem;
	}
```

Change to:

```css
	h1 {
		font-family: var(--font-serif);
		font-size: clamp(1.7rem, 1.2rem + 2vw, 2.4rem);
		line-height: 1.15;
		letter-spacing: -0.015em;
		text-wrap: balance;
		margin: 0.5rem 0 0.5rem;
	}
```

*(Skip this step if E11 already applied — it includes `text-wrap: balance`.)*

3. Reduce the scoped `article` rule to surface plumbing. Remove `color` (the shared layer's `--prose-fg` owns ink; the scoped rule would out-specify it) and add the dark-theme leading boost. read/[id]/+page.svelte:1458-1465. Current code:

```css
	article {
		font-family: var(--reader-font);
		font-size: var(--reader-size);
		line-height: var(--reader-leading);
		letter-spacing: var(--reader-tracking, 0);
		word-spacing: var(--reader-word-spacing, 0);
		color: var(--text);
	}
```

Change to:

```css
	/* Surface plumbing only — all content styling lives in the shared
	   .lectern-prose layer (lib/styles/prose.css). */
	article {
		font-family: var(--reader-font);
		font-size: var(--reader-size);
		line-height: calc(var(--reader-leading) + var(--prose-leading-boost, 0));
		letter-spacing: var(--reader-tracking, 0);
		word-spacing: var(--reader-word-spacing, 0);
	}
```

4. Delete lines 1466-1555 (every `article :global(...)` content rule — all superseded by prose.css). Delete exactly these blocks, in full:

```css
	article :global(p),
	article :global(ul),
	article :global(ol),
	article :global(blockquote),
	article :global(pre),
	article :global(figure),
	article :global(table) {
		margin: 0 0 var(--reader-para-gap, 1.15em);
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
		border-left: 3px solid var(--border-strong);
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
```

After the deletion, the modified `article { ... }` rule from step 3 is immediately followed by the `@media (max-width: 820px)` block (currently at line 1557).

**Do not:** Do not touch the focus-mode rules (`.doc.focus-on article ...`, lines 1161-1169), the focus bar, `mark.lectern-hl` rules (1854-1871), or `mark.find-hit` rules (1925-1932) — those are reader-specific and stay. Do not remove the `--reader-width` usage on `.doc` (1252-1257). Do not delete the scoped `h1`/`.byline` rules (template chrome, not article content). Do not add `prose-indented` here — that is B7.
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` at root (svelte-check will flag any unused-selector leftovers). Manual, in the full reader (`/read/<id>`) on an article with headings, lists, a table, a blockquote, code, and images: Paper theme — links read in text ink with tinted underline, accent on hover; blockquote upright at 0.97em with a 2px rule; hr is a short centered 5rem rule; table has horizontal rules only and scrolls horizontally if wide; figcaption flush-left in the UI face. Dark and Black themes — line-height visibly opens (+0.06) and images dim. Sepia — oldstyle figures in body numerals. Check focus mode (f) still dims everything but the focused block, an existing highlight still renders, and Cmd/Ctrl+F hits still mark.
**Acceptance:**
- `<article>` carries `lectern-prose`; the component `<style>` contains no `article :global(...)` content rules.
- Typography settings (font, size, leading, tracking, word spacing, paragraph gap, width) all still respond from the Display popover.
- Dark/black reader theme override (`.doc[data-theme]`) gets boosted leading and dimmed images even when the app theme is light.

---

### B3: Adopt .lectern-prose in MagazineReader and route reader settings into the body
**Priority:** P0 · **Depends on:** B1
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte
**Why:** The flagship literary surface currently sets body copy in the inherited UI sans and duplicates prose rules. Body copy must consume the reader's typography (review P0 #1/#2); the layout voice (drop cap, pull-quote, separators) stays.

**Steps:**

1. Add the class to the body container. MagazineReader.svelte:182-184. Current code:

```svelte
					<!-- content.ts sanitizes with DOMPurify before caching -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="mr-body">{@html html[card.id]}</div>
```

Change to:

```svelte
					<!-- content.ts sanitizes with DOMPurify before caching -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="mr-body lectern-prose">{@html html[card.id]}</div>
```

2. Replace the body rule (fixes the UI-sans bug; serif re-tuned to 1.6 leading at reader size). MagazineReader.svelte:468-473. Current code (or the A1-modified version if Phase A landed first — either way, replace the whole rule):

```css
	/* Article body typography. The HTML is sanitized upstream. */
	.mr-body {
		font-size: var(--text-lg);
		line-height: 1.7;
		color: var(--text);
	}
```

Change to:

```css
	/* Article body: the reader's own typography at full scale (×1). Content
	   styling lives in the shared .lectern-prose layer; only the magazine's
	   voice (drop cap, pull-quote, separators) is kept below. */
	.mr-body {
		font-family: var(--reader-font, var(--font-serif));
		font-size: calc(var(--reader-size, 19px) * 1);
		line-height: calc(var(--reader-leading, 1.6) + var(--prose-leading-boost, 0));
	}
```

3. Delete lines 474-476 containing:

```css
	.mr-body :global(p) {
		margin: 0 0 1.1rem;
	}
```

4. Keep lines 477-491 (the drop cap and small-caps first-line — magazine voice; Phase D refines them). Do not modify.

5. Delete lines 492-517 containing (three blocks — headings, images/figures, figcaption, links):

```css
	.mr-body :global(h1),
	.mr-body :global(h2),
	.mr-body :global(h3),
	.mr-body :global(h4) {
		line-height: 1.25;
		margin: 1.8rem 0 0.8rem;
	}
	.mr-body :global(img),
	.mr-body :global(figure) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius);
		margin: 1.2rem 0;
	}
	.mr-body :global(figure img) {
		margin: 0;
	}
	.mr-body :global(figcaption) {
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-align: center;
		margin-top: 0.4rem;
	}
	.mr-body :global(a) {
		color: var(--accent);
	}
```

6. Keep lines 518-541 (the pull-quote blockquote with the hanging open-quote and its `::before`) — that is the magazine's considered editorial voice and intentionally overrides the shared blockquote (its scoped selector out-specifies `.lectern-prose blockquote`). Do not modify.

7. Delete lines 542-560 containing (lists, pre, code):

```css
	.mr-body :global(ul),
	.mr-body :global(ol) {
		margin: 0 0 1.1rem;
		padding-left: 1.4em;
	}
	.mr-body :global(li) {
		margin: 0.3rem 0;
	}
	.mr-body :global(pre) {
		overflow-x: auto;
		padding: 0.9rem;
		border-radius: var(--radius);
		background: var(--surface-alt);
		font-size: var(--text-sm);
	}
	.mr-body :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.9em;
	}
```

**Do not:** Do not touch `.mr-lead` (the lead figure is outside `.mr-body`). Do not delete the drop-cap/first-line rules or the blockquote pull-quote. Do not wire `readerCssVars` into the magazine route — the `var(..., fallback)` chain is the contract for this phase; print surfaces inherit the vars only when a later phase emits them.
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` at root. Manual on `/magazine`, open an issue: body copy is now serif (≈19px/1.6), not Helvetica; drop cap still renders; pull-quote keeps its hanging quote; in Dark theme the issue body gets opened leading and dimmed images; links are ink with tinted underlines.
**Acceptance:**
- `.mr-body` carries `lectern-prose` and only sets font-family/size/line-height (plus the kept voice rules).
- No `:global(p/h*/img/figcaption/a/ul/ol/li/pre/code)` content rules remain under `.mr-body` other than the drop cap, first-line, and blockquote voice blocks.

---

### B4: Adopt .lectern-prose in FlipReader and route reader settings into the body
**Priority:** P0 · **Depends on:** B1
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte
**Why:** FlipReader hard-codes face/size/leading (review P0 #2) and carries a third duplicated prose rule set. Body copy adopts the shared layer with newspaper ×0.92 / magazine-kind ×0.94 scaling; band/column layout and drop caps stay.

**Steps:**

1. Add the class to both body containers. FlipReader.svelte:257. Current code:

```svelte
						<div class="fr-body fr-bands">
```

Change to:

```svelte
						<div class="fr-body fr-bands lectern-prose">
```

2. FlipReader.svelte:272-273. Current code:

```svelte
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body">{@html html}</div>
```

Change to:

```svelte
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body lectern-prose">{@html html}</div>
```

3. Replace the base body rule. FlipReader.svelte:483-490. Current code:

```css
	/* Article body — shared base, then per-kind treatment. {@html} content needs
	   :global selectors since it carries no Svelte scope attributes. */
	.fr-body {
		font-family: var(--font-serif);
		color: var(--text);
		font-size: 1.06rem;
		line-height: 1.7;
	}
```

Change to:

```css
	/* Article body: the reader's typography at newspaper scale (×0.92; the
	   magazine kind overrides to ×0.94 below). Content styling lives in the
	   shared .lectern-prose layer; only this surface's voice (columns, bands,
	   drop caps) is kept. */
	.fr-body {
		font-family: var(--reader-font, var(--font-serif));
		font-size: calc(var(--reader-size, 19px) * 0.92);
		line-height: calc(var(--reader-leading, 1.6) + var(--prose-leading-boost, 0));
	}
```

4. Delete lines 491-537 containing (all duplicated content rules — p, h2/h3, a, img, figure, figcaption, blockquote, pre):

```css
	.fr-body :global(p) {
		margin: 0 0 1em;
	}
	.fr-body :global(h2),
	.fr-body :global(h3) {
		font-family: var(--font-serif);
		line-height: 1.2;
		margin: 1.4em 0 0.4em;
	}
	.fr-body :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.fr-body :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius);
	}
	.fr-body :global(figure) {
		margin: 1.2em 0;
	}
	.fr-body :global(figcaption) {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-align: center;
		margin-top: 0.4em;
	}
	.fr-body :global(blockquote) {
		margin: 1.4em 0;
		padding-left: 1.1em;
		border-left: 1px solid var(--border-strong);
		color: var(--text);
		font-style: italic;
		font-size: 1.06em;
		line-height: 1.5;
	}
	.fr-body :global(pre) {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: var(--bg-sunken);
		padding: 0.9em 1em;
		border-radius: var(--radius);
		overflow-x: auto;
		white-space: pre;
	}
```

(Design decision: the flip blockquote was generic drift, not voice — the shared treatment replaces it. The shared `pre` uses `--prose-code-bg`/`--surface-alt` instead of `--bg-sunken`; that unification is intended.)

5. Replace the magazine-kind size override. FlipReader.svelte (post-deletion; originally 652-655). Current code:

```css
	.flip.magazine .fr-body {
		font-size: 1.12rem;
		line-height: 1.75;
	}
```

Change to:

```css
	.flip.magazine .fr-body {
		font-size: calc(var(--reader-size, 19px) * 0.94);
	}
```

(Line-height now comes from the shared base calc — do not re-declare it.)

**Do not:** Do not touch `.fr-band` (columns, text-align, hyphens — the justify fix is A2, not this packet), `.fr-bands`, `.fr-break`, `.fr-full` (its `max-width: 100%` guards are harmless overlap), the newspaper/magazine drop caps and `::first-line` rules (lines 597-610 and 656-667), `.head`, `.endmark`, `.runfoot`, or the skeleton. Do not wire `readerCssVars` into the newspaper/magazine routes — fallbacks are the contract for this phase.
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` at root. Manual on `/newspaper`, open an edition: bands still flow in two columns with the drop cap on band one; blockquotes now upright with a 2px rule; pre blocks have a hairline border and 1.5 leading. Flip a magazine-kind issue: single measure, ×0.94 size, drop cap intact. Check Dark theme: dimmed images, opened leading.
**Acceptance:**
- Both `.fr-body` containers carry `lectern-prose`; no duplicated `:global` content rules remain under `.fr-body` except drop-cap/first-line voice.
- Newspaper body = reader size ×0.92, magazine kind ×0.94, both with `--prose-leading-boost` in the leading calc.

---

### B5: Make headings follow accessibility faces via --prose-heading-font
**Priority:** P1 · **Depends on:** B1, B2
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts
**Why:** OpenDyslexic/Atkinson/Lexend readers currently get serif headings — the elements they scan by. The shared layer already consumes `--prose-heading-font`; the reader emits it per-setting.

**Steps:**

1. typography.ts:178-189. Current code:

```ts
/** The CSS custom properties that drive the reader's typography. */
export function readerCssVars(s: ReaderSettings): Record<string, string> {
	return {
		'--reader-font': FONT_STACKS[s.fontFamily],
		'--reader-size': `${s.fontSize}px`,
		'--reader-leading': String(s.lineHeight),
		'--reader-width': `${s.maxWidth}px`,
		'--reader-tracking': `${s.letterSpacing}em`,
		'--reader-word-spacing': `${s.wordSpacing}em`,
		'--reader-para-gap': `${s.paragraphSpacing}em`
	};
}
```

Change to:

```ts
/** Faces designed for reading accessibility. When one is active, in-article
 *  headings follow the body face instead of the editorial serif — headings are
 *  the elements readers scan by, so they must not regress to a hard face. */
const ACCESSIBILITY_FONTS: ReadonlySet<FontFamily> = new Set([
	'atkinson',
	'lexend',
	'opendyslexic'
]);

/** The CSS custom properties that drive the reader's typography. */
export function readerCssVars(s: ReaderSettings): Record<string, string> {
	return {
		'--reader-font': FONT_STACKS[s.fontFamily],
		'--reader-size': `${s.fontSize}px`,
		'--reader-leading': String(s.lineHeight),
		'--reader-width': `${s.maxWidth}px`,
		'--reader-tracking': `${s.letterSpacing}em`,
		'--reader-word-spacing': `${s.wordSpacing}em`,
		'--reader-para-gap': `${s.paragraphSpacing}em`,
		// Consumed by .lectern-prose headings (lib/styles/prose.css). Resolves
		// on the reader's .doc, overriding the :root default (--font-serif).
		'--prose-heading-font': ACCESSIBILITY_FONTS.has(s.fontFamily)
			? 'var(--reader-font)'
			: 'var(--font-serif)'
	};
}
```

(Design decision made: `serif`, `sans`, `mono`, and `literata` keep serif headings — only the three accessibility faces switch. The value is the indirection `var(--reader-font)`, not the raw stack, so the two can never drift; both vars land on the same `.doc` element so resolution is safe.)

**Do not:** Do not add the variable to MagazineReader/FlipReader (they fall back to `var(--font-serif)` from `:root` until a later phase emits reader vars there). Do not emit the raw `FONT_STACKS` string for the accessibility case. Do not change `FONT_STACKS` or `FONT_LABELS`.
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` at root. Manual in the full reader: pick Atkinson in the Display popover → in-article h2/h3/h4 render in Atkinson (inspect computed font-family); switch to Literata → headings return to the serif stack; switch to OpenDyslexic and Lexend and confirm the same.
**Acceptance:**
- `readerCssVars` emits `--prose-heading-font` with value `var(--reader-font)` for atkinson/lexend/opendyslexic and `var(--font-serif)` otherwise.
- Headings change face live when switching typefaces in the popover, with no reload.

---

### B6: Cap the reading measure at 760px and retune the Wide preset
**Priority:** P1 · **Depends on:** none
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts, /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte, /Users/luke/git/luke/Lectern/apps/web/src/routes/settings/+page.svelte
**Why:** The width slider currently reaches 1000px (~105ch) — unreadable measure. Cap at 760px everywhere (clamp, both sliders, Wide preset). Design decision: the settings model stores raw px, so em-based presets (Narrow 28em/Medium 34em/Wide 40em) are out of scope for this packet — noted for a future refactor. Leading-to-measure coupling is also deliberately NOT implemented: it would fight the explicit line-height slider and the new `--prose-leading-boost`.

**Steps:**

1. typography.ts:105-110. Current code:

```ts
/** Quick reading-width presets (px), surfaced as buttons in the settings UI. */
export const WIDTH_PRESETS: { label: string; value: number }[] = [
	{ label: 'Narrow', value: 580 },
	{ label: 'Medium', value: 680 },
	{ label: 'Wide', value: 820 }
];
```

Change to:

```ts
/** Quick reading-width presets (px), surfaced as buttons in the settings UI.
 *  Stored as raw px for now; an em-of-reader-size model (Narrow 28em /
 *  Medium 34em / Wide 40em) is a future refactor. 760 is the measure cap. */
export const WIDTH_PRESETS: { label: string; value: number }[] = [
	{ label: 'Narrow', value: 580 },
	{ label: 'Medium', value: 680 },
	{ label: 'Wide', value: 760 }
];
```

2. typography.ts:156. Current code:

```ts
			maxWidth: clampNumber(o.maxWidth, DEFAULT_SETTINGS.maxWidth, 480, 1000),
```

Change to:

```ts
			maxWidth: clampNumber(o.maxWidth, DEFAULT_SETTINGS.maxWidth, 480, 760),
```

(Persisted settings above 760 are clamped on next load by `normalizeSettings` — no migration needed.)

3. Reader Display popover slider. read/[id]/+page.svelte:847-857. Current code:

```svelte
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
```

Change to:

```svelte
			<label class="slider">
				<span>Width <em>{readerSettings.current.maxWidth}px</em></span>
				<input
					type="range"
					min="480"
					max="760"
					step="20"
					value={readerSettings.current.maxWidth}
					oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
				/>
			</label>
```

4. Settings page slider. settings/+page.svelte:612-619. Current code:

```svelte
				<input
					type="range"
					min="480"
					max="1000"
					step="20"
					value={readerSettings.current.maxWidth}
					oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
				/>
```

Change to:

```svelte
				<input
					type="range"
					min="480"
					max="760"
					step="20"
					value={readerSettings.current.maxWidth}
					oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
				/>
```

**Do not:** Do not change `DEFAULT_SETTINGS.maxWidth` (680 stays). Do not change the 480 floor or the 20px step. Do not implement leading-measure coupling or em presets. Do not touch the fontSize/lineHeight sliders.
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` at root. Manual: open Settings → Reading, the Wide preset reads 760 and selecting it lights as active at slider max; in the reader Display popover, dragging Width to max stops at 760px and the column visibly caps; with a previously stored width of e.g. 900 (set `localStorage['lectern.reader']` by hand), reload → width reads 760.
**Acceptance:**
- Width is clamped to [480, 760] in `normalizeSettings`, both sliders, and presets; Wide preset value equals the cap so the preset highlights when slider is maxed.
- A code comment records the em-preset refactor as deferred.

---

### B7: Add a paragraphStyle (spaced | indented) reading setting
**Priority:** P2 · **Depends on:** B1, B2
**Files:** /Users/luke/git/luke/Lectern/apps/web/src/lib/typography.ts, /Users/luke/git/luke/Lectern/apps/web/src/lib/styles/prose.css, /Users/luke/git/luke/Lectern/apps/web/src/routes/read/[id]/+page.svelte, /Users/luke/git/luke/Lectern/apps/web/src/routes/settings/+page.svelte
**Why:** Book-convention paragraph indents are a standard reading preference. The class-based mechanism lives in the shared prose layer; the full reader binds it (design decision: the print surfaces keep spaced paragraphs — their drop-cap openings assume it).

**Steps:**

1. Add the type. typography.ts:26-33. Current code:

```ts
export type FontFamily =
	| 'serif'
	| 'sans'
	| 'mono'
	| 'literata'
	| 'atkinson'
	| 'lexend'
	| 'opendyslexic';
```

Change to:

```ts
export type FontFamily =
	| 'serif'
	| 'sans'
	| 'mono'
	| 'literata'
	| 'atkinson'
	| 'lexend'
	| 'opendyslexic';

/** Paragraph separation: `spaced` (web convention, inter-paragraph gap) or
 *  `indented` (book convention, first-line indents and no gap). */
export type ParagraphStyle = 'spaced' | 'indented';
```

2. Add the field to the interface. typography.ts:53-56. Current code:

```ts
	/** Inter-paragraph gap, in em. */
	paragraphSpacing: number;
	/** After triaging in the reader, jump to the next document in the list. */
	autoAdvance: boolean;
```

Change to:

```ts
	/** Inter-paragraph gap, in em. */
	paragraphSpacing: number;
	/** Paragraph separation: spacing between blocks, or book-style indents. */
	paragraphStyle: ParagraphStyle;
	/** After triaging in the reader, jump to the next document in the list. */
	autoAdvance: boolean;
```

3. Add the default. typography.ts:69-71. Current code:

```ts
	paragraphSpacing: 1,
	autoAdvance: true
};
```

Change to:

```ts
	paragraphSpacing: 1,
	paragraphStyle: 'spaced',
	autoAdvance: true
};
```

4. Validate it. typography.ts:159-161. Current code:

```ts
		paragraphSpacing: clampNumber(o.paragraphSpacing, DEFAULT_SETTINGS.paragraphSpacing, 0.4, 2.4),
		autoAdvance: typeof o.autoAdvance === 'boolean' ? o.autoAdvance : DEFAULT_SETTINGS.autoAdvance
	};
```

Change to:

```ts
		paragraphSpacing: clampNumber(o.paragraphSpacing, DEFAULT_SETTINGS.paragraphSpacing, 0.4, 2.4),
		paragraphStyle: o.paragraphStyle === 'indented' ? 'indented' : DEFAULT_SETTINGS.paragraphStyle,
		autoAdvance: typeof o.autoAdvance === 'boolean' ? o.autoAdvance : DEFAULT_SETTINGS.autoAdvance
	};
```

(Design decision: the mode is delivered as a class, not a CSS variable — `readerCssVars` is unchanged.)

5. Append the mode rules to the end of `/Users/luke/git/luke/Lectern/apps/web/src/lib/styles/prose.css` (after the `pre code` block created in B1):

```css
/* ---- Paragraph style: indented (book convention) ----
   First-line indents replace the inter-paragraph gap. No indent on openers:
   the first paragraph and any paragraph that follows a heading, quote, figure,
   or rule starts flush. Toggled per the paragraphStyle reader setting. */

.lectern-prose.prose-indented p {
	margin-bottom: 0;
	text-indent: 1.4em;
}
.lectern-prose.prose-indented p:first-of-type,
.lectern-prose.prose-indented h1 + p,
.lectern-prose.prose-indented h2 + p,
.lectern-prose.prose-indented h3 + p,
.lectern-prose.prose-indented h4 + p,
.lectern-prose.prose-indented blockquote + p,
.lectern-prose.prose-indented figure + p,
.lectern-prose.prose-indented hr + p {
	text-indent: 0;
}
```

6. Bind the class in the full reader (this is the B2-modified line). read/[id]/+page.svelte:960-961. Current code (after B2):

```svelte
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<article class="lectern-prose" bind:this={articleEl}>{@html html}</article>
```

Change to:

```svelte
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<article
				class="lectern-prose"
				class:prose-indented={readerSettings.current.paragraphStyle === 'indented'}
				bind:this={articleEl}
			>
				{@html html}
			</article>
```

(The added whitespace text nodes are safe: anchors/blocks/find all operate on elements or non-blank text nodes.)

7. Add the control to the reader Display popover, directly after the Width slider (the `</label>` closing the Width slider, B6-modified, currently lines 847-857) and before the closing `</div>` of `.panel`. Current code:

```svelte
			<label class="slider">
				<span>Width <em>{readerSettings.current.maxWidth}px</em></span>
				<input
					type="range"
					min="480"
					max="760"
					step="20"
					value={readerSettings.current.maxWidth}
					oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
				/>
			</label>
		</div>
	{/if}
```

Change to:

```svelte
			<label class="slider">
				<span>Width <em>{readerSettings.current.maxWidth}px</em></span>
				<input
					type="range"
					min="480"
					max="760"
					step="20"
					value={readerSettings.current.maxWidth}
					oninput={(e) => readerSettings.update({ maxWidth: Number(e.currentTarget.value) })}
				/>
			</label>
			<div class="field">
				<span class="field-label">Paragraphs</span>
				<div class="seg">
					<button
						type="button"
						class:active={readerSettings.current.paragraphStyle === 'spaced'}
						onclick={() => readerSettings.update({ paragraphStyle: 'spaced' })}
					>
						Spaced
					</button>
					<button
						type="button"
						class:active={readerSettings.current.paragraphStyle === 'indented'}
						onclick={() => readerSettings.update({ paragraphStyle: 'indented' })}
					>
						Indented
					</button>
				</div>
			</div>
		</div>
	{/if}
```

(If B6 has not landed yet, the same edit applies with `max="1000"`.)

8. Add the control to the Settings page, directly after the Paragraph spacing slider. settings/+page.svelte:643-656. Current code:

```svelte
				<label class="slider">
					<span
						>Paragraph spacing <em>{readerSettings.current.paragraphSpacing.toFixed(1)}em</em></span
					>
					<input
						type="range"
						min="0.4"
						max="2.4"
						step="0.1"
						value={readerSettings.current.paragraphSpacing}
						oninput={(e) =>
							readerSettings.update({ paragraphSpacing: Number(e.currentTarget.value) })}
					/>
				</label>
```

Change to:

```svelte
				<label class="slider">
					<span
						>Paragraph spacing <em>{readerSettings.current.paragraphSpacing.toFixed(1)}em</em></span
					>
					<input
						type="range"
						min="0.4"
						max="2.4"
						step="0.1"
						value={readerSettings.current.paragraphSpacing}
						oninput={(e) =>
							readerSettings.update({ paragraphSpacing: Number(e.currentTarget.value) })}
					/>
				</label>
				<div class="field">
					<span class="flabel">Paragraph style</span>
					<div class="seg">
						<button
							type="button"
							class:active={readerSettings.current.paragraphStyle === 'spaced'}
							onclick={() => readerSettings.update({ paragraphStyle: 'spaced' })}
						>
							Spaced
						</button>
						<button
							type="button"
							class:active={readerSettings.current.paragraphStyle === 'indented'}
							onclick={() => readerSettings.update({ paragraphStyle: 'indented' })}
						>
							Indented
						</button>
					</div>
					<span class="fhint"
						>Spaced paragraphs (web convention) or first-line indents (book convention).</span
					>
				</div>
```

**Do not:** Do not emit a `--prose-paragraph-style` variable — the class is the mechanism. Do not bind `prose-indented` in MagazineReader or FlipReader. Do not disable the Paragraph spacing slider in indented mode (it still affects lists/quotes/figures); no extra UI state. Do not invent new control markup — `.field`/`.seg` in the popover and `.field`/`.flabel`/`.seg`/`.fhint` on the settings page are the existing idioms (the width presets at settings/+page.svelte:601-611 use exactly this seg pattern).
**Verify:** `pnpm typecheck && pnpm lint && pnpm test` at root. Manual in the full reader on a long article: toggle Paragraphs → Indented in the Display popover — paragraphs collapse their gaps and indent first lines 1.4em; the opening paragraph and the first paragraph after each h2/h3/blockquote/figure/hr stays flush; toggle back to Spaced restores gaps; setting persists across reload and shows the same state on the Settings page; Reset to defaults returns Spaced. Confirm magazine and newspaper surfaces are unaffected by the toggle.
**Acceptance:**
- `ReaderSettings.paragraphStyle` exists, defaults to `spaced`, survives `normalizeSettings` round-trips, and rejects garbage values.
- Both UIs (popover + settings page) show and set the control with the active state highlighted.
- Indented mode renders per the prose.css rules in the full reader only.
