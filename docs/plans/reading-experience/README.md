# Reading Experience Implementation Plan

Source review: `docs/reading-experience-review.md` (2026-06-09). This plan converts that review
into self-contained work packets sized for a junior implementer or a smaller model. Each packet
quotes the exact current code and the exact replacement — if the quoted "Current code" does not
match what is in the file, STOP and report the mismatch instead of improvising.

## How to execute a packet

1. Read the packet fully before editing. Apply steps in order.
2. Make only the changes the packet specifies. Do not refactor, reformat, or "improve" nearby
   code. Do not fix unrelated issues you notice — note them and move on.
3. After the edits run, from the repo root:
   `pnpm format && pnpm -r typecheck && pnpm -r lint && pnpm -r test`
4. Perform the packet's manual verification (dev server: `pnpm dev`).
5. Commit with a scoped `git add <each file the packet names>` — NEVER `git add -A` or
   `git add .` (the working tree may contain unrelated concurrent edits). One packet = one
   commit, message `feat(web): <packet title> (<packet id>)` or `fix(web)` as appropriate.

## Global guardrails

- Svelte 5 runes idiom (`$state`, `$derived`, `$effect`) — match the surrounding file.
- CSS: custom properties only, no frameworks. Tabs for indentation. Prettier must pass.
- Never use `border-left`/`border-right` wider than 1px as a colored decorative stripe.
- No gradient text, no glassmorphism, no neon. Warm paper aesthetic; one ink-blue accent.
- Motion ≤ 180ms with `var(--ease)`; respect `prefers-reduced-motion`.
- Do not change data models, sync mutations, or API clients unless the packet says so.
- Test on multiple themes when the packet names them (theme switch: Display popover or Settings).

## Phases and ordering

| Phase | File | Theme | Packets | Prerequisites |
|-------|------|-------|---------|---------------|
| A | `phase-a.md` | Quick wins (one-liners and small fixes) | A1-A10 | none |
| B | `phase-b.md` | Shared prose layer (`.lectern-prose` + `--prose-*` tokens) | B1-B7 | none (B2-B5, B7 depend on B1) |
| C | `phase-c.md` | Reading flow and chrome | C1-C8 | C3 depends on C2; C7 depends on C6 |
| D | `phase-d.md` | Print-surface polish (Magazine / Newspaper) | D1-D14 | A2 (ragged text) first is ideal; D14 is diagnostic-only |
| E | `phase-e.md` | System: fonts, themes, tokens | E1-E13 | E9/E10 coordinate with A4; suggested order inside the file |

Recommended overall order: **A → B → C → D → E**, but phases are largely independent; within a
phase respect each packet's "Depends on" line. Cross-phase coordination points:

- A4 (highlight multiply) restructures the `mark.lectern-hl` rule that E9 later edits — E9's
  packet explains how to apply on top of A4.
- B1 creates `lib/styles/prose.css`; D1 creates `lib/styles/drop-cap.css` standalone-safe and
  notes folding into prose.css once B lands.
- B2 modifies the `<article>` line that A9 and C1 also touch; if line numbers have drifted,
  match on the quoted code, not the line number.
- C3/C8 both add `max-width: 640px` media blocks (reader bar + app top bar) — they pair.

## Not yet packetized (deferred review items)

These review findings have no packet yet; do not improvise them while executing other packets:

- Relocating the "Add tag…" editor out of the reader masthead (E11 keeps it in place).
- Em-based width presets / leading-to-measure coupling (B6 records the decision to defer).
- Cover image display in the full-reader header (review P1 "header is a template" — only the
  byline/eyebrow part is packetized as E11).
- Collapsing the app sidebar in reading view on desktop (C4 handles panel overlap only).
- The newspaper page-turn blank-page bug — D14 is a diagnostic writeup for a stronger model.

## Known intentional decisions (do not "fix")

- The OKLCH palette refactor is deliberately skipped (E9 changes only two mixes to oklab).
- Print modes keep their own layout voice (columns, drop caps, kickers); only body-copy
  typography unifies with the reader settings.
- `--text-2xs` is retained (E13 evaluated and skipped the collapse — 37 usages).
- Punycode domains are dropped, not decoded (A7) — no browser-safe decoder is worth bundling.
- D14 is an investigation writeup, not a code change.
