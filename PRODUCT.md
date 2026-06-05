# Product

## Register

product

## Users

Self-hosters and committed readers who run their own software. A typical user already
keeps RSS feeds and a read-later pile, is frustrated by the split between feed readers
and save-for-later tools, and is willing to run a YunoHost app to own their reading.
They reach for Lectern across contexts: fast triage of an overflowing inbox on a phone,
focused long-form reading on a tablet or desktop in the evening, and quick saves from a
browser share sheet. The job to be done: turn a scattered stream of feeds and saved
articles into one calm, trustworthy queue they can triage, read, and revisit — offline,
on any device, without an algorithm deciding what they see.

## Product Purpose

Lectern is a self-hosted Readwise Reader alternative for RSS + read-later. It is a thin
unification layer over two open-source backends (MiniFlux for feeds, Readeck for saved
articles) that adds the experience the backends lack: one inbox, a triage workflow
(later / shortlist / archive), cross-source tags, saved views, offline reading, and a
single Reader-style API — delivered as an installable PWA and packaged as a native
YunoHost app. Success is when a user stops juggling separate apps because Lectern is the
one place their reading lives, and reading in it feels better than the commercial tool it
replaces.

## Brand Personality

Editorial and literary, calm and focused. The interface should feel like a well-set page,
not a dashboard — paper-like and typographic, where reading is treated as a considered act
and the chrome stays quiet so the words lead. Three words: **calm, literary, trustworthy.**
Emotional goal: the relief of a tidy reading queue and the pleasure of a beautifully set
column of text. It is unhurried and confident, never noisy or attention-seeking.

## Anti-references

Lectern should explicitly NOT look or feel like:

- **A busy social feed** — no infinite scroll for its own sake, engagement bait,
  algorithmic reordering, or a scatter of notification badges. The user's queue is theirs,
  in their order.
- **Sterile corporate SaaS** — no generic gray-card dashboard, cold default blue,
  Inter-everything templated layout, or hero-metric tiles.
- **The flashy AI aesthetic** — no dark mode with neon gradients, glassmorphism,
  purple-to-blue fills, or glowing accents.
- **A cluttered power-user IDE** — no wall of dense panels and tiny controls that buries
  the content under chrome. Power is available but progressively disclosed.

## Design Principles

1. **The text leads, the app recedes.** Every surface earns its ink by serving reading or
   triage; chrome stays hairline-quiet so the column of words is the loudest thing on screen.
2. **A calm queue, never a feed.** Order is the user's, not an algorithm's. Triage is
   reversible and low-stakes; the inbox should feel finishable, not bottomless.
3. **Readability is the feature.** Typeface, measure, leading, and theme are first-class
   choices the reader controls — not afterthoughts. Accommodation (dyslexia-friendly faces,
   high contrast, sepia/newsprint) is built in, not bolted on.
4. **Paper as the metaphor.** Warm tinted neutrals, never pure black or white; soft
   material depth over flat cards; one restrained ink accent. It should feel like stock and
   ink, not glass and glow.
5. **Trustworthy and fast.** Offline-first, optimistic, and quiet. Actions feel instant;
   nothing surprises the user or hides where their data went.

## Accessibility & Inclusion

Target **WCAG AAA where feasible** — accessibility is a headline feature, not a compliance
checkbox. Concretely: AAA text contrast in the dedicated high-contrast theme and AA+ across
all themes; bundled reading faces tuned for legibility and dyslexia (Atkinson Hyperlegible,
Lexend, Literata, OpenDyslexic); reader-controlled type size, measure, and theme; full
`prefers-reduced-motion` support; keyboard-operable triage; and safe-area / OLED-friendly
themes for varied devices and lighting. New work should preserve these guarantees, not erode
them.
