# Reading Experience Review — 2026-06-09

Method: three parallel code critiques (full reader, print surfaces, design system) plus a live
walkthrough of lectern.p10.club on desktop and 390px phone emulation. Benchmarks: Readwise
Reader, Instapaper, iA Writer, NYT/New Yorker article pages, well-set print.

Verdict: the foundation is unusually good — warm tinted palettes with AAA body text on all six
themes, an honest font roster (Literata/Atkinson/Lexend/OpenDyslexic), em-based prose scale,
anchor-based scroll restore, focus-mode dimming via color-mix, and the newspaper masthead is the
most authentic print detail in the app. What separates Lectern from top-tier today is not the
bones; it is (1) a missing micro-typography layer, (2) dark-theme indifference, (3) the dead-end
ending, (4) print surfaces that ignore the reader's typography settings, and (5) a handful of
trust-breaking details (fake folios, leaked tag syntax, punycode bylines).

---

## P0 — Blocks "top-tier"

### 1. Magazine body text is set in the UI sans

`MagazineReader.svelte:469-473` — `.mr-body` has no `font-family`, so it inherits
`--font-ui` from `body`. The flagship "literary" surface reads like a settings panel, with a
serif accent drop cap floating in Helvetica. Live-confirmed on /magazine issues.
Fix: `font-family: var(--reader-font, var(--font-serif));` then re-tune leading (serif wants
~1.6 at 20px, not 1.7).

### 2. Print modes ignore reader typography settings (accessibility regression)

`MagazineReader.svelte:469-472`, `FlipReader.svelte:485-490, 652-655` hard-code face/size/leading.
A reader who chose OpenDyslexic at 24px loses it the moment they open an issue or edition.
Fix: body copy consumes `var(--reader-font)` and scales from `var(--reader-size)`
(magazine ×1.0, newspaper ×0.92). Layout voice (columns, drop caps, kickers) stays opinionated;
body text must not.

### 3. Justified two-column text at ~31ch produces rivers; justification survives the mobile collapse

`FlipReader.svelte:552-557` — `columns: 2 17rem; text-align: justify; hyphens: auto`. Browsers
use greedy line-breaking; at ~31ch words gape. On phones the columns collapse but
`text-align: justify` remains — live-confirmed gappy justified ~38ch on mobile.
Fix: `text-align: left`, keep `hyphens: auto`, add `hyphenate-limit-chars: 6 3 2` and
`text-wrap: pretty`. If justification stays as the newspaper signature, gate it to columns
resolving ≥ 20rem.

### 4. The article ends in a dead end

`read/[id]/+page.svelte:961` — nothing after `</article>`: no end mark, no triage, no next-up.
Auto-advance exists but only via invisible keyboard triage (`e/l/s/i`). Live-confirmed: the page
just stops at the source's last line.
Fix: quiet centered end mark, then Archive / Later / Shortlist row, then a "Next up" card
(title + source + reading time) from the reading queue.

### 5. Dark themes get zero prose adaptation

No dark-scoped rule touches the article (`+page.svelte:1458-1555`, `app.css:233-300`).
Light-on-dark reads optically thinner/tighter; `-webkit-font-smoothing: antialiased` thins it
further; images render full-brightness (flashlight effect on Black/OLED); highlight tints stay
light-tuned.
Fix: dark themes add `line-height: calc(var(--reader-leading) + 0.06)`,
`filter: brightness(0.86) contrast(1.02)` on images, and theme-scoped highlight mixes
(~24-28%, desaturated). Token route: `--prose-leading-boost` / `--prose-weight` per theme.

### 6. Text selection is nearly invisible on light themes — and selection is the highlight gesture

`app.css:393-396` — `::selection` uses `--accent-soft`: 1.07:1 vs Paper bg, 1.10 Sepia,
1.12 Newsprint. The highlight popover appears only after a selection the user can barely see.
Fix: `::selection { background: color-mix(in srgb, var(--accent) 25%, var(--bg)); }` —
keeps AAA text-on-selection on all six themes.

### 7. The default yellow highlight almost disappears on Sepia/Newsprint

`+page.svelte:1854-1858` — 38% translucent washes composite to 1.18-1.50:1 on the light themes.
Fix: on light themes render marks as solid `var(--hl)` with `mix-blend-mode: multiply`
("marker on paper": yellow → ~1.9:1 vs bg, text stays AA/AAA). Theme-scope dark variants per #5.

### 8. Both side panels open crush the article to ~30 characters per line

Live-confirmed: TOC + Info open at desktop width squeezes the column to a sliver; the TOC also
holds a full panel just to say "No headings."
Fix: minimum measure guard — below a threshold, panels overlay instead of compress; collapse the
app sidebar in reading view; don't open an empty TOC (disable the toggle or show a hint inline).

---

## P1 — Meaningful

### Typography and prose

- **No micro-typography layer** (`+page.svelte:1458-1465`): add `font-kerning: normal;
font-variant-ligatures: common-ligatures; font-variant-numeric: oldstyle-nums proportional-nums;
text-wrap: pretty; hyphens: auto` (set `lang` on `<article>` from doc metadata);
  `text-wrap: balance` on title and h2/h3. `hanging-punctuation: first allow-end` as Safari
  progressive enhancement.
- **Duplicate title** (live finding, desktop + flip reader): extracted content often opens with an
  h1 repeating the title Lectern already renders. Strip a leading h1 during sanitize when it
  fuzzy-matches the document title; demote other in-content h1→h2. Today in-content h1 also falls
  through to app.css and renders margin-0, wrong face (`app.css:359-367`).
- **Measure can reach ~105ch and leading never responds to width** (`typography.ts:156`, slider to
  1000px). Cap at 760px; tighten "Wide" preset; couple leading to measure (+0.05 per ~80px above
  680). Better: store width in em of reader size so "Medium" means the same measure at every font
  size (`Narrow 28em / Medium 34em / Wide 40em`).
- **Headings ignore the chosen reading font** (`+page.svelte:1475-1481`): OpenDyslexic/Atkinson
  users still get serif headings — the elements they scan by. Inherit `--reader-font` when an
  accessibility face is active. Also: weight 650 is synthesized (bundled cuts are 400/600) — use 600.
  h4 has no size; give it a proper small-eyebrow level.
- **Blockquote triple-signals** (`+page.svelte:1509-1514`): border + whole-paragraph italic +
  muted ink (which also misses AAA at 5.3:1). Use `color: var(--text); font-style: normal;
font-size: 0.97em; border-left: 2px` (or 1px to match the magazine's considered choice).
- **Body links carry full accent ink** (`:1488-1493`): link-dense articles turn blue-speckled.
  `color: inherit` + accent-tinted underline; accent on hover.
- **The header is a template, not a set piece** (`:917-924`): the `??` chain means author and
  publication never show together; published date never shows; cover image fetched for accent but
  never displayed. Build a structured byline: site eyebrow (letterspaced caps) → balanced h1 →
  "By {author} · {date} · {n} min read". Move the "Add tag…" field out of the masthead (Info
  panel or post-article); it is chrome in the middle of a title lockup.
- **Default serif is an Apple-only lottery** (`typography.ts:63,74`): Android gets Noto Serif,
  Linux gets DejaVu. Make Literata the cross-platform default or splice it mid-stack
  (`"Iowan Old Style", Charter, "Literata", Georgia, serif`) — mid-stack webfonts only download
  when reached. Add metric-matched fallback (`size-adjust`) + preload of the active face via the
  existing pre-paint script to kill the reflow on first article.

### Chrome and flow

- **Nine persistent top-bar controls** (`+page.svelte:694-860`): keep Back + Display (+ progress);
  move Listen/Podcast/Re-fetch/Original behind "…" or Info. Auto-hide on scroll-down, reveal on
  scroll-up. On mobile this is worse: app bar + reader bar stack (live-confirmed).
- **Escape with the Display popover open exits the reader** (live finding): Escape should close
  the topmost layer first.
- **Display popover clips its rows** (live finding, desktop): Contrast theme and Lexend cut off
  with no overflow affordance. Mobile: popover positioned below the viewport (y≈849 at 844px tall
  — verify on a real phone). Also: reader-theme buttons changed the app theme while the popover
  still showed "Auto" selected — confusing state feedback. Consider a bottom sheet on mobile and
  width presets + "Aa" live preview; expose tracking/paragraph-gap behind an Advanced disclosure.
- **Highlight panel cards use colored 3px side-stripes** (`:1780-1801`) — the banned decorative
  stripe, redundant with mark color. Use a small color dot. Same for magazine cover-line 2px white
  stripes (`routes/magazine/+page.svelte:397-403`) and the gloss `.foil` gradient (`:418-429`).
- **Adaptive accent has no contrast guard** (`+page.svelte:77-81`): clamp injected cover colors to
  ≥4.5:1 vs active theme bg (mix toward `--text` until passing).
- **Author metadata shows raw punycode email** (live: `marius@xn--gckvb8fzb.com (Marius)`).
  Parse `name <email>` / `email (name)` forms; show the human name, decode punycode, drop the
  address.

### Print surfaces

- **Drop caps are not optically sized** (three competing specs: 3.2em/3.1em/3.4em, line-height
  0.7-0.72): caps occupy ~1.4 lines, foot hanging in dead air. Use `initial-letter: 3` with a
  float fallback sized to exactly 2 lines; one shared `.drop-cap` recipe, one weight, ink not
  accent. Guard edge cases: leading-quote paragraphs (oversized `"W`), image-led articles whose
  first flow band never gets the cap.
- **Faux small caps on ::first-line** (`MagazineReader.svelte:487-491`, FlipReader 606-610,
  664-667): system serifs have no smcp, so browsers synthesize counterfeit caps at
  viewport-dependent length. Delete, or wrap the first ~4 words in a real letterspaced-caps span
  during sanitize.
- **A fleuron every 130 words** (`FlipReader.svelte:62, 259-261`): ~14 ornaments in a 2,000-word
  feature demotes ❧ to noise; same glyph also means "next article". Bands separate with margin
  only; reserve ❧ for source `<hr>` and article boundaries.
- **Fake folios** (`routes/magazine/+page.svelte:33-37, 57-66`): dotted leaders to invented page
  numbers in a scroll, on a brand whose word is "trustworthy". Put real data in the slot
  (reading minutes, cumulative minutes-into-issue).
- **Issue titles leak tag syntax** (live: `['Rss'`, `'Article'`, `Politics-Society]`): if
  intentional ornamentation it reads as a serialization bug; title-case the tag and drop the
  brackets/quotes. Cover art also repeats across issues — vary crop/tint per issue or fall back to
  a typographic cover when the pool is shallow.
- **Short RSS items get the full broadsheet costume** (live: 20-word post in two columns with a
  drop cap and "hap-pen" split across columns): if total words < ~90, single column, ragged, no
  drop cap, "Read the full story →" directly under the snippet.
- **Page-turn motion**: 220ms fly + simultaneous smooth scroll-to-top double-animates
  (`FlipReader.svelte:237, 441`); live walkthrough also hit a multi-second blank page after a
  turn (content in DOM, paint delayed — investigate; possibly transition + image decode).
  Use 180ms `cubicOut`, `scrollTo({behavior:'instant'})`.
- **Last article in an issue is never auto-marked read** (`FlipReader.svelte:149-158`): the
  cover-to-cover reader gets the worst bookkeeping. Mark on end-of-scroll of the final page.
- **Full-width blockquotes become ~90ch walls** (`FlipReader.svelte:24-37, 586-588`): give
  `.fr-full blockquote` a real pull-quote treatment (max-width 30em, centered, top/bottom rules).
- **Swipe-to-turn fires after panning a code block/table** (`:179-189`): bail when the gesture
  starts inside `pre, table, iframe, video`.
- **"↑ Contents" scrolls to article 1, not the contents** (`MagazineReader.svelte:195-197`).
- **Tombstone ∎ floats on its own right-aligned line**: append to the final line of copy via
  `p:last-of-type::after` instead.
- **Mono kicker with triage state spliced in** (`MagazineReader.svelte:394-401`): adopt
  FlipReader's kicker spec (UI face, 0.14em tracking, uppercase); keep state on the buttons.

## P2 — Polish

- Tables: editorial rules (horizontal only, heavier head rule, `tabular-nums`), and wrap in an
  overflow-x scroller — wide tables currently blow out the 680px measure (`+page.svelte:1545-1555`).
- `sup`/`sub` disrupt leading: `line-height: 0; position: relative; top: -0.45em`.
- Code blocks inherit prose leading and user tracking/word-spacing (`:1534-1544`): reset to
  `line-height: 1.5; letter-spacing: 0; word-spacing: 0; tab-size: 2` + hairline border.
- Content images wear 9px app radius (`:1494-1499`): 2px or none; `display: block;
margin-inline: auto`.
- Figcaption: flush-left, UI face, 0.8em — not centered (`:1503-1508`).
- `hr`: short centered rule or asterism, not border-to-border (`:1522-1526`).
- Paragraph-indent mode (book convention) as a `paragraphStyle: 'spaced' | 'indented'` setting.
- List markers: `li::marker { color: var(--text-muted) }`, approximate hanging markers; `li li`
  tighter.
- Muted text misses AAA on 5/6 themes (5.3-6.5:1): Paper `#56503f`, Sepia `#564a2e`,
  Dark `#aea797`, Black `#a09a90` all pass 7:1 and keep the tinted character.
- Black theme: `#dcdcdc` on `#000` = 15.3:1 → halation for astigmatic night readers, and the only
  cold-neutral theme in a warm system. `--text: #cfcdc8`, sync `THEME_SWATCHES.black.fg` drift.
- Bundle `literata-600-italic` (~21 KB) — `<strong><em>` currently synthesizes; lead `--font-mono`
  with `ui-monospace` (SF Mono isn't exposed to web content).
- `background-attachment: fixed` wash under prose (`app.css:345-352`) forces repaint-on-scroll on
  iOS/low-end Android — move to a fixed pseudo-element.
- Thin scrollbars (`scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent`) —
  Windows/Linux currently get UA chrome beside prose.
- Grain texture: applied on every print surface but not the flagship reader — add it or document
  the omission as deliberate.
- Skip the OKLCH refactor (palettes are hand-tuned and even); just switch the two srgb
  `color-mix` composites (highlight marks, find-hits) to `in oklab`, and derive future themes in
  OKLCH.
- Collapse `--text-2xs/--text-xs/--text-sm` (three sizes in a 2px band).
- Focus-mode residual ink 30% is faint on Sepia/Newsprint; use ~38% for the light family.
- Title lockup rhythm: h1 `margin: 1.2rem 0 0.65rem`, byline `0 0 1.4rem`, tabular figures in the
  byline.

## Suggested sequencing

1. **One-line/near-one-line wins first**: magazine font-family, `::selection`, highlight
   multiply on light themes, justified→ragged, Escape layering, popover clipping, punycode byline,
   tag-syntax titles, h1 dedupe/demote.
2. **The prose layer**: extract a shared `prose.css` (`.lectern-prose`) consumed by all three
   surfaces — micro-typography features, dark-theme compensation, blockquote/table/figure/hr/list
   treatments, `--prose-*` tokens. This single refactor closes the "drift, not intention" problem
   and gives every future fix one home.
3. **The flow**: end-of-article block, top-bar reduction + auto-hide, panel measure guard,
   reader-settings respect in print modes.
4. **The print polish**: drop-cap recipe, fleuron economy, real folios, short-item handling,
   page-turn motion.
