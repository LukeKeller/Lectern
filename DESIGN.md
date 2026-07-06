---
name: Lectern
description: A calm, paper-like, typography-first reading app for RSS + read-later.
colors:
  accent: "#3a5e8c"
  accent-deep: "#33527b"
  accent-soft: "#e7edf4"
  accent-contrast: "#ffffff"
  paper-bg: "#f6f4ee"
  paper-surface: "#fdfcf9"
  paper-surface-alt: "#ece7dd"
  paper-sunken: "#efece4"
  ink: "#2a2620"
  ink-muted: "#56503f"
  hairline: "#e4ded1"
  hairline-strong: "#d6cfbf"
  sage: "#3f7d56"
  brick: "#b34a3a"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  reading:
    fontFamily: "'Iowan Old Style', Charter, 'Literata', Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "6px"
  md: "9px"
  lg: "14px"
  full: "999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.5rem"
  "6": "2rem"
  "7": "3rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.md}"
    padding: "0.42rem 0.85rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
    textColor: "{colors.accent-contrast}"
  button-secondary:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.42rem 0.85rem"
    typography: "{typography.body}"
  button-secondary-hover:
    backgroundColor: "{colors.paper-surface-alt}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.42rem 0.85rem"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    width: "2.25rem"
  card:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0.85rem 0.55rem 0.9rem 1.45rem"
  card-hover:
    backgroundColor: "{colors.paper-surface-alt}"
  card-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.65rem"
    typography: "{typography.body}"
  chip-tag:
    backgroundColor: "{colors.paper-surface-alt}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "0.15rem 0.2rem 0.15rem 0.55rem"
  badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.full}"
    padding: "0 0.28rem"
  unread-pill:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.full}"
    padding: "0.1rem 0.45rem"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "0.46rem 0.55rem"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
---

# Design System: Lectern

## 1. Overview

**Creative North Star: "The Reading Room"**

Lectern is a quiet, well-lit room built for one purpose: reading. Every surface is warm
paper and hushed chrome; the loudest thing on any screen should be a column of words. This
is a *product* register where design serves the reading workflow — but the workflow is
reading, so the craft of the page is the craft of the product. The palette is warm tinted
neutrals (never pure black or white), carrying one restrained ink-blue accent that appears
rarely and means something. Type is set on a single disciplined scale; spacing follows one
rhythm; borders are hairlines; motion is fast and quiet.

The system rejects, by name, four things its users do not want: the **busy social feed**
(no infinite-scroll bait, no algorithmic reordering, no scatter of notification badges — the
queue is the user's, in their order), the **sterile corporate SaaS dashboard** (no gray
cards, no cold default blue, no Inter-everything template, no hero-metric tiles), the
**flashy AI aesthetic** (no dark-mode neon, no glassmorphism, no purple-to-blue gradients,
no glowing accents), and the **cluttered power-user IDE** (power exists but is progressively
disclosed, never a wall of dense panels and tiny controls). If a screen could be mistaken
for a generic admin template, the design has failed.

Readability is the headline feature, not a setting buried three menus deep. The reader
controls typeface, measure, size, and theme; seven themes (Paper, Sepia, Newsprint, E-ink, Dark,
Black-OLED, High-Contrast) and four bundled reading faces tuned for legibility and dyslexia
(Atkinson Hyperlegible, Lexend, Literata, OpenDyslexic) are first-class. Target is **WCAG AAA
where feasible**.

**Key Characteristics:**
- Warm paper neutrals; never pure `#000` or `#fff`.
- One ink-blue accent (`#3a5e8c`), used on ≤10% of any screen.
- Hairline borders + soft warm shadows; depth is paper-tactile, not glassy.
- A single 8-step type scale and a 4pt-based spacing rhythm.
- Fast, quiet motion (120–180ms); the page never bounces or struts.
- Reader-owned typography and seven themes; accessibility is built in, not bolted on.

## 2. Colors

A warm, paper-derived palette: tinted off-white grounds, ink-brown text, hairline borders,
and a single ink-blue accent. Semantic colors (sage, brick) are muted to sit on paper, never
saturated UI primaries. (Values below are the **Paper / light** theme — the canonical base.
Sepia, Newsprint, Dark, Black, and High-Contrast are sibling theme overrides of the same
token names; the *roles* are identical, only the values shift.)

### Primary
- **Ink Blue** (`#3a5e8c`): the one accent. Active nav, primary buttons, unread dots, focus
  rings, progress bars, selected/active states. Its rarity is the point — if it's everywhere,
  it means nothing.
- **Deep Ink** (`#33527b`): primary-button hover only (an 88/12 mix of accent and black).
- **Faint Ink Wash** (`#e7edf4`): the accent's soft tint — selected card backgrounds, active
  nav background, unread pills, command-palette active row. Lets the accent register a state
  without shouting.

### Neutral
- **Warm Paper** (`#f6f4ee`): the page ground. A faint accent-tinted radial sits at the top
  edge; otherwise this is the stock everything rests on.
- **Bright Leaf** (`#fdfcf9`): raised surface — cards on hover, menus, palette, inputs,
  sidebar rail.
- **Aged Paper** (`#ece7dd`): recessed/secondary fill — segmented-control track, hover
  backgrounds, tag chips, cover-image placeholder.
- **Recessed Paper** (`#efece4`): sunken plane for rails and inputs.
- **Ink** (`#2a2620`): primary text. Warm brown-black, never `#000`. Also the ground of the
  undo toast (inverted).
- **Faded Ink** (`#56503f`): secondary text, muted icons, counts, timestamps, and the
  global placeholder color. Deliberately darker than a mid-gray so it clears **AA (≈5.4:1)**
  on Warm Paper — a light "elegant" gray here would fail the placeholder-contrast bar.
- **Hairline** (`#e4ded1`) / **Strong Hairline** (`#d6cfbf`): the only border weights.
  Hairline at rest, Strong on hover/emphasis. Always 1px.

### Tertiary (semantic, muted)
- **Sage** (`#3f7d56`): success / finished-reading progress. Desaturated to live on paper.
- **Brick** (`#b34a3a`): errors and destructive-action hover. Warm, not a fire-alarm red.

### Named Rules
**The One Voice Rule.** The ink-blue accent appears on ≤10% of any screen. It marks exactly
one thing per region: the active route, the primary action, the unread state. Two accent
elements competing in one glance is a bug.

**The Tinted Neutral Rule.** Pure `#000` and `#fff` are forbidden. Every neutral is warmed
toward the paper hue. Gray text on a colored ground is forbidden — use a darker shade of that
ground instead.

## 3. Typography

**UI Font:** system sans stack (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI'…`) —
the chrome speaks in the OS's own quiet voice so it disappears.
**Reading Font:** `'Iowan Old Style', Charter, 'Literata', Georgia` serif by default, plus four
bundled, reader-selectable faces (Atkinson Hyperlegible, Lexend, Literata, OpenDyslexic). Each
bundled face ships a metric-matched fallback (`Literata-fallback` = size-adjusted Georgia) so the
font swap never reflows the column.
**Mono Font:** `'SF Mono', 'JetBrains Mono'` — code and tabular data only.

**Character:** The chrome is set in a neutral system sans so it recedes; the *reading column*
is where typographic personality lives, and it is handed to the reader. The app never imposes
a display typeface — its restraint is the statement.

### Hierarchy
A single 8-step scale: `0.6875 · 0.75 · 0.8125 · 0.9375 · 1.0625 · 1.25 · 1.5 · 2rem`.
- **Display** (650, `2rem`, lh 1.2, ls −0.01em): page titles, the largest headings. App UI uses
  fixed rem — no fluid `clamp()` in product chrome.
- **Headline** (650, `1.5rem`, lh 1.2): section headers within a page.
- **Title** (650, `1.25rem`, lh 1.2, sans): panel headers, dialog titles, section headers.
- **Index Title** (600, `1.25rem`, lh 1.25, **serif** `--font-serif`, ls −0.005em): the headline
  of a **list/card row**. Deliberately set in the reading serif — not the sans `Title` — to give
  the index a "magazine masthead" voice and a clean step over its sans byline. Read rows dim it to
  Faded Ink at weight 500. This is the one place UI chrome borrows the reading face on purpose.
- **Body** (400, `0.9375rem`, lh 1.55): default UI text and list rows.
- **Label** (600, `0.75rem`–`0.6875rem`, tabular-nums where numeric): counts, badges,
  timestamps, metadata. Short only — never set passages here.
- **Reading** (400, **`19px`** default, lh 1.6, serif, measure 680px ≈ 71ch): the reader column.
  Size (12–28px), leading (1.2–2.2), measure (480–760px), face, tracking, word/paragraph spacing
  and theme are all reader-controlled; these are the defaults. Width presets: Narrow 580 / Medium
  680 / Wide 760.

### Named Rules
**The Reader-Owns-Type Rule.** In the reading column, type size, measure, family, and theme
are the reader's to set, not the designer's. Ship sensible defaults; never lock them.

**The Measure Rule.** Body and reading columns cap at ~65–75ch (the shared `.page` column is
`max-width: 44rem`). Wider is fatiguing and forbidden.

**The Theme-Fidelity Rule.** The reading column is tuned per theme, not shipped once and reused.
Dark grounds open the leading (`--prose-leading-boost: 0.06`) because light-on-dark reads optically
tighter, and pull images back from the flashlight effect (`--prose-img-filter: brightness(0.86)
contrast(1.02)`); E-ink pre-flattens images to grayscale for clean dithering. Highlight marks paint
solid marker ink multiplied into light papers (`--hl-blend: multiply`) but switch to a translucent
tint on dark themes (`--hl-mix: 26%`, `normal` blend) so they never crush the text to black. Text
selection is a 25%-accent-into-`--bg` mix (not the near-invisible `--accent-soft`), keeping the
selected passage AAA on every theme.

## 4. Elevation

Paper-tactile, not glassy. Surfaces are **flat with hairline borders at rest**; soft, warm,
low-opacity shadows appear only on things that genuinely float or respond — menus, the command
palette, toasts, the listen player, and card/hover states. Shadows are tinted to the ink hue
(`rgba(31,28,22,…)`), never neutral black, so they read as light falling on warm stock. A
top-edge inset sheen (`--edge-hi`) gives raised surfaces the highlight of a physical page edge.
Warm grounds carry a faint **paper tooth** — a tileable grayscale fractal-noise sheet (`--grain`)
blended at ~12% (`--grain-strength`) via soft-light, tuned to look like stock, never like a filter;
it is zeroed on E-ink (which dithers) and left off the high-contrast theme. Glassmorphism,
backdrop-blur panels, and decorative glows are forbidden.

### Shadow Vocabulary
- **Hairline lift** (`box-shadow: 0 1px 2px rgba(31,28,22,0.05)` — `--shadow-sm`): card hover,
  selected rows, segmented-control active thumb. The faintest possible separation.
- **Floating panel** (`0 6px 20px rgba(31,28,22,0.1), 0 1px 3px rgba(31,28,22,0.06)` —
  `--shadow-md`): dropdown menus, toasts. Clearly off the page but still grounded.
- **Modal** (`0 14px 36px rgba(31,28,22,0.14), 0 2px 8px rgba(31,28,22,0.08)` — `--shadow`):
  command palette and true overlays only.
- **Sheet on a desk** (`0 1px 2px rgba(31,28,22,0.05), 0 22px 48px -30px rgba(31,28,22,0.32)`
  — `--shadow-paper`): the document surfaces only — the newspaper broadsheet and the magazine
  contents leaf. A long, soft, downward pool that reads as a page resting on the desk, not a
  floating glass card. Zeroed on E-ink.
- **Page-edge sheen** (`inset 0 1px 0 rgba(255,255,255,0.55)` — `--edge-hi`): the top
  highlight on raised surfaces.

### Named Rules
**The Flat-At-Rest Rule.** Resting surfaces are flat with a 1px hairline. Shadow is a
*response* — to hover, to floating, to focus — never decoration. If a static card has a drop
shadow for no reason, delete it.

## 5. Components

### Buttons
- **Shape:** gently rounded, `9px` (`--radius`). Padding `0.42rem 0.85rem` (small variant
  `0.3rem 0.6rem`). All states transition `120ms` with the standard ease.
- **Primary:** solid Ink Blue ground, white text, 1px border matching the fill. Hover darkens
  to Deep Ink (`#33527b`). Reserved for the one true action in a region.
- **Secondary (default `.btn`):** Bright Leaf surface, ink text, hairline border. Hover lifts
  border to Strong Hairline and fills with Aged Paper. This is the workhorse button.
- **Ghost:** transparent ground, inherits border/text; for low-emphasis actions.
- **Danger:** secondary shell whose hover shifts border + text to Brick on a transparent ground
  — destructive intent shown by color, not a filled red button.
- **Icon buttons:** transparent, muted ink, `2–2.25rem` square, `9px` radius; hover fills Aged
  Paper and darkens the glyph. Toggle-on state uses accent text on Faint Ink Wash.

### Chips / Tags / Pills
- **Tag chip:** Aged Paper ground, Faded Ink text, fully rounded (`--radius-full`), `text-xs`,
  asymmetric padding leaving room for an inline remove button. Quiet, not a button.
- **Badge / count:** fully-rounded accent pill, white text, `text-2xs`, weight 600,
  tabular-nums. On an icon it floats top-right with a `--bg`-colored ring to punch out.
- **Unread pill:** Faint Ink Wash ground with accent text — a soft state marker, not a badge.

### Cards / List Items (signature)
- **Corner Style:** `14px` (`--radius-lg`), the softest radius in the system.
- **Background:** transparent at rest on a hairline-divided list (`border-bottom: 1px solid
  Hairline`). Hover washes in ~55% Aged Paper + the Hairline-lift shadow. Selected uses Faint
  Ink Wash.
- **Unread:** a single 8px Ink-Blue **dot** at the left edge — never a border stripe.
- **Progress:** a 2px accent bar pinned to the row's bottom edge; turns Sage at 100%.
- **Read state:** title dims to Faded Ink and drops to weight 500. Faded/dismissed rows go to
  50% opacity, recovering toward 80% on hover.
- **Internal padding:** `0.85rem 0.55rem 0.9rem 1.45rem` (extra left inset reserves the dot
  gutter).

### Inputs / Fields
- **Style:** Bright Leaf ground, 1px Hairline border, `9px` radius, `0.5rem 0.65rem` padding.
- **Search field:** a `2rem`-tall pill-of-a-box with an inline icon; the inner `<input>` is
  chromeless (no border/background) so the wrapper is the only visible field.
- **Focus:** border shifts to Ink Blue (`--accent`) and the native outline is removed; the
  global `:focus-visible` ring is a 2px accent outline at 2px offset. No glow.
- **Segmented control:** Aged Paper track, transparent inactive segments (muted text); the
  active segment lifts onto a Bright Leaf thumb with the Hairline-lift shadow.

### Navigation
- **Sidebar rail:** items are `text-base`, weight 500, muted ink, `9px` radius, `0.46rem
  0.55rem` padding. Hover fills Aged Paper and darkens text. **Active** uses Faint Ink Wash
  ground + Ink-Blue text at weight 600; the trailing count also turns accent. Tree rows and
  playlist items follow the same default→hover→active language one level quieter (`text-sm`).
- **Count badges** are right-aligned, `text-2xs`, tabular-nums, muted — accent only when their
  row is active.

### Command Palette (signature)
A centered `min(560px, 92vw)` panel at 13vh, Bright Leaf on an ink-tinted scrim
(`rgba(20,16,10,0.34)`), `14px` radius, Modal shadow, entering with a 180ms `pop` (fade +
6px rise + slight scale). The input is chromeless and large (`text-md`); the active row is
accent-on-Faint-Ink-Wash. This is the keyboard-first spine of the app.

### Highlight Marker (signature)
Reader highlights are the **one** sanctioned colored left border: a `3px` stripe whose color
*encodes the highlight color* the user chose (yellow `#e0b341`, blue `#4f8edc`, green
`#5fae6a`, pink `#d97aa6`, orange `#e08a3c`). This is data, not decoration — it is the
explicit exception to the no-stripe rule below, permitted only because the color carries the
user's meaning.

## 6. Do's and Don'ts

### Do:
- **Do** keep the Ink-Blue accent (`#3a5e8c`) on ≤10% of any screen; mark one thing per region.
- **Do** tint every neutral toward the warm paper hue; reach for Warm Paper / Bright Leaf /
  Aged Paper, never a flat gray card.
- **Do** use a single 8px dot, a bottom progress bar, or weight/opacity to signal card state —
  the established vocabulary.
- **Do** keep surfaces flat with a 1px hairline at rest; add shadow only when something floats,
  hovers, or focuses.
- **Do** cap reading and body measure at ~65–75ch (`.page` is `44rem`).
- **Do** let the reader own type size, measure, family, and theme in the reading column.
- **Do** keep motion fast and quiet: `120ms`/`180ms` with `cubic-bezier(0.22,0.61,0.36,1)`;
  honor `prefers-reduced-motion`.
- **Do** color placeholder and muted UI text with Faded Ink (`--text-muted`, `#56503f`) — the
  global `::placeholder` rule sets it at full opacity so every chromeless field (search, filter,
  token, reader find) clears AA. Never leave a placeholder at the UA-default light gray.
- **Do** hold WCAG AAA where feasible; preserve the high-contrast theme and reading faces.

### Don't:
- **Don't** build a **busy social feed**: no infinite-scroll bait, no algorithmic reordering,
  no scatter of notification badges. The queue is the user's, in their order.
- **Don't** ship a **sterile corporate SaaS** look: no gray cards, no cold default blue, no
  Inter-everything template, no hero-metric tiles.
- **Don't** use the **flashy AI aesthetic**: no dark-mode neon, no glassmorphism, no
  purple-to-blue gradients, no glowing accents, no gradient text.
- **Don't** build a **cluttered power-user IDE**: no wall of dense panels and tiny controls;
  disclose power progressively.
- **Don't** use a `border-left`/`border-right` greater than 1px as a colored accent stripe on
  cards, list items, or callouts. Two exceptions, both content not chrome: the reader highlight
  marker (stripe color encodes the user's highlight color), and blockquote rules in the reading
  column (a classic typographic device — keep them a **neutral** `--border-strong`, never the
  accent, so they read as quoted text rather than a UI accent).
- **Don't** use pure `#000` or `#fff`, gray text on colored grounds, or saturated semantic
  reds/greens. If it looks like a generic admin template, the design has failed.
- **Don't** put a resting drop shadow on a static card, or blur a panel for effect.
