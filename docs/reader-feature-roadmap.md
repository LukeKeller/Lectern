# Readwise Reader → Lectern: feature gap & UI/UX roadmap

Synthesized from a full read of the Reader docs + guides (≈246 features across
intake, organize/nav, reading/appearance, sharing/export, filtering, Ghostreader,
workflows), 2026-06-03. Focus: UI/UX and the reading experience. (The live app
is behind login; this is grounded in the docs' descriptions + screenshots, not a
hands-on walkthrough of the account.)

Reader's reading view is a **3-pane layout**: left = Table of Contents (toggle
`[`), center = article, right = **Info / Notebook / Chat** tabs (toggle `]`),
with a bottom action bar (hidden in "long-form" mode). Lists support split tabs
(Unseen/Seen), count badges, and bulk actions.

## Already at parity (don't rebuild)
Locations + triage, document tags & notes, saved/filtered **views** (query AST),
sidebar **counts**, **command palette** + `?` shortcut sheet + keyboard-driven
nav, **full-text search** (offline metadata + server FTS over bodies), **Feed
hide-read** (≈ Unseen/Seen), OPML/CSV import, feeds management, light/dark/auto,
typography panel (font/size/line-height/width), reading progress bar, PWA +
offline + share-target + bookmarklet, owned content + dedup, version badge +
auto-update.

## P0 — Reading experience (the core Readwise feel)
| # | Feature | Lectern | Notes |
|---|---|---|---|
| 1 | **Paragraph focus + advance** — accent bar on the current paragraph; `Space`/`↓`/`j` next, `↑`/`k` prev; auto-scroll to keep it centered | missing | **User-requested.** Reader's "blue focus indicator." Pairs with our keyboard layer. Foundation for `H`/`T`/`N` paragraph actions. |
| 2 | **Highlighting UI** — select-to-highlight (and `H` on focused paragraph), render highlights in the article, highlight notes, edit/remove | plumbed, no UI | Model/sync/storage + `createHighlight`/`listHighlights` already exist; needs reader UI + rendering + anchoring. The defining Reader action. |
| 3 | **Right panel: Info + Notebook** — Info = metadata (type, domain, published, length, progress %, saved, author w/ drill-down); Notebook = this doc's highlights & notes; toggle `]` | missing | Signature 3-pane reading layout. |
| 4 | **Left Table of Contents** from headings; toggle `[`; click to jump | missing | Completes the 3-pane layout; great for long reads. |

## P1 — Reading polish
- ✅ **Find in document** (`Cmd/Ctrl+F` in-article search). *Shipped.*
- ✅ **Progress readout**: % + "~N min left" (we have the bar; add the numbers). *Shipped.*
- **Long-form / focus mode** toggle (hide chrome) — partly there; formalize.
- **Mark feed item seen on open** (so hide-read flows naturally as you read).
- **Auto-advance to next document** after triage/archive (toggleable).

## P1 — Library / navigation UX
- ✅ **Bulk actions** — "Mark all as seen" / "Archive all" on the Feed/lists. *Shipped.*
- ✅ **Split views by status** — generalize hide-read into Unseen/Seen (and Inbox/Later/Archive) tabs. *Shipped.*
- ✅ **Smart default views** (cheap, query-based, high delight): Continue reading, Quick reads (<10m), Long reads (>30m), Recently highlighted. *Shipped (`/collections/[key]`).*
- **Saved-view polish**: count badges, emoji icon (first char of name), reorder/pin.
- **Cover thumbnails** in list rows (needs `coverImage` on Card + extraction).
- **Power filter bar** — expose the query language (domain/author/words/minutes/progress/has/date ops/`__not`) over the existing view AST.

## Lectern-original — Daily desk (beyond Reader)
Ways to read down a backlog that Readwise Reader doesn't have. Both are pure,
client-side views over the offline mirror (`lib/newspaper.ts`, `lib/magazine.ts`),
reachable from a new **Daily** sidebar group, the command palette, and direct URLs.
- ✅ **Daily Newspaper** (`/newspaper`) — yesterday's **unread feed** items set in a
  print-style edition: masthead + dateline with day-by-day navigation, a promoted
  lead story (the day's longest read), and sections grouped by publication in
  reflowing columns. "Mark issue read" clears the day. *Shipped.*
- ✅ **Magazines** (`/magazine`) — the saved **library** bound into themed issues:
  every tag shared by 2+ articles becomes a collection of related reading, each with
  a colour-coded cover. *Shipped.*
- Next: group the Newspaper by MiniFlux feed **folder** (true topical sections) once
  `folderTitle` rides on the Card; "today"/"this week" spans; printable edition.

## Deliberately deferred (per ADR/MVP — note, don't build now)
Ghostreader/**AI** (chat, summarize, auto-tag), **TTS**, **YouTube/video** +
transcript, **PDF** annotate/zoom/snapshot, **EPUB**/paged scroll, Kindle,
public **share bundles**/links + highlight-as-image, e-ink mode, browser
extension, native mobile apps, Daily Digest.

## Captured ideas (logged, not scheduled)
- **"Listen" — per-article read-aloud (TTS).** A Listen action in the reader view
  (alongside `H` highlight) that reads the current article aloud, ideally with
  play/pause + paragraph follow. Candidate engine: **ElevenLabs** — the owner has
  an account + API key ready to try. Revisits the MVP-deferred TTS line above with
  a concrete provider; route audio through the BFF (keep the key server-side, never
  ship it to the SPA) and consider caching synthesized audio per document. Not
  started — picking up later.

## Proposed build order
1. **Reading view overhaul (P0):** 3-pane shell (TOC | article | Info/Notebook) +
   `[`/`]` toggles → paragraph focus + `Space`/arrow advance + auto-scroll →
   highlighting UI (`H`, select-to-highlight, render, notes) wired to the existing
   highlight API. This is the biggest leap and covers both your explicit asks.
2. **Reading polish (P1):** find-in-doc, progress readout, mark-seen-on-open, auto-advance.
3. **Library UX (P1):** bulk actions + split tabs, smart default views, saved-view badges/icons, then cover thumbnails and the power filter bar.
