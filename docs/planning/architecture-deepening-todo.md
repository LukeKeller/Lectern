# Architecture deepening — TODO

Backlog of **deepening opportunities**: refactors that turn shallow modules into deep ones
(more behaviour behind a smaller interface) to improve testability and AI-navigability.
Surfaced 2026-06-04 from an architecture review. Pick these up after the in-progress UI rework.

Vocabulary (so suggestions stay consistent):

- **Module** — anything with an interface + implementation. **Shallow** = interface nearly as
  complex as the implementation. **Deep** = lots of behaviour behind a small interface.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place.
- **Deletion test** — imagine deleting the module: if complexity vanishes it was a pass-through;
  if it reappears across N callers it earned its keep.
- **Leverage** (what callers get) / **locality** (what maintainers get) — the payoff of depth.

Ordered by leverage. Items 1–3 are the core of the unification layer and reinforce each other.

---

## 1. The write path has no deep home — field ownership lives in comments

**Files:** `apps/bff/src/mutations.ts` (the `apply*` functions + `applyMutation` dispatch);
consumed at `routes.ts:454` and `routes.ts:129-135`; ownership rules in the header comment
(`mutations.ts:8-12`).

**Problem:** The seven `apply*` functions are shallow — each is a 3-8 line conditional that parses
the source from a unified id and routes the write to Readeck and/or the overlay. The load-bearing
knowledge — *who owns each field* (Readeck owns reading progress/archive/labels/highlights;
MiniFlux owns nothing writable; the glue DB owns location/note/RSS progress/highlights) — exists
only as prose at `mutations.ts:9-11`. Dual-write semantics (write overlay *and* backend, overlay
wins on merge) are re-derived per function.

**Deletion test:** Delete the module and the routing reappears inline at the two call sites — and
the ownership map has nowhere to live. Real seam wearing a shallow interface.

**Direction:** One "apply a `Mutation` to its owning store(s)" module that carries the ownership map
as code. Locality: a fourth source (the email-newsletter path creeping into `jobs.ts`) means
editing one place. Tests: the write path becomes the test surface — today `routes.test.ts` only
exercises mutations end-to-end via `app.inject`, so dual-write-then-conflict is never tested directly.

---

## 2. `OverlayStore` is a ~30-method god-interface mixing six responsibilities

**Files:** `apps/bff/src/unify.ts:174-260` (interface), `overlay-store.ts` (implementation),
`routes.test.ts` (the fake reimplements the whole surface).

**Problem:** One interface conflates: unified index reads (`listDocuments`, `documentsChangedSince`),
per-source legacy reads (`getIndexedCard`), index writes (`upsertIndex`, `indexFromBackend`,
`markIndexedRead`, `softDeleteMissing`), overlay writes (`upsertOverlay`, `getOverlays`), captured
content + search, tags/views CRUD, RSS highlights, and pure server-side asset caches (cached audio,
accent, TTS config, player state). ~30 methods behind one name. Shallow as a whole even though
sub-areas are deep — every caller and every test must know the entire surface.

**Deletion test:** Splitting into focused stores (index/overlay, content, assets, views) concentrates
complexity per responsibility rather than vanishing it. Two adapters already exist (pg impl +
in-memory test fake), so these are real seams, not hypothetical ones.

**Direction:** Split by responsibility. Leverage: a route that needs only index reads depends on a
small interface. Tests: `FakeOverlayStore` stops stubbing 30 methods to test one endpoint.

---

## 3. The "index never clobbers the overlay" invariant is enforced by method-name discipline

**Files:** `overlay-store.ts` (`upsertIndex` vs `indexFromBackend`, different SET clauses),
`db/schema.ts:14-25` (comment); callers split — routes use `upsertIndex` (`routes.ts:114,423`),
backend polls use `indexFromBackend` (`jobs.ts:89,113`).

**Problem:** The `documents` table holds two ownership zones per row: backend-truth columns
(refreshed by polls) and BFF-owned overlay columns (`location`, `tags`, `note`, `readProgress`,
`readAnchor`). `indexFromBackend` preserves the overlay columns; `upsertIndex` does not. Same
signature, near-identical names, opposite safety. The only guard against a poll silently wiping
every user's triage location and tags is remembering which method to call.

**Deletion test:** Merge them and the danger becomes explicit (a `preserveOverlay` flag, or — deeper
— make "overwrite a user-owned column from a backend card" inexpressible). The invariant should be a
property of the seam, not of caller discipline.

**Direction:** Enforce overlay-preservation in one place. Locality: a `jobs.ts` refactor can't
quietly reintroduce data loss.

---

## 4. The combined sync cursor is an undocumented state machine

**Files:** `apps/bff/src/unify.ts:108-132` (`encodeCombinedCursor`/`decodeCombinedCursor`),
persisted in `jobs.ts`, read at `routes.ts:435-446`.

**Problem:** The cursor packs two sub-cursors with tri-state meaning: a value = offset, `null` =
"this backend is exhausted, skip next page," `undefined` = "never ran, use default." The distinction
lives only in a comment (`unify.ts:124-127`). When one backend's `list` rejects mid-pagination the
fallback writes `null`, so a transient failure makes that source **permanently skipped** until the
cursor is reset. No type prevents an illegal mixed state; tests never cover a recovering backend.

**Deletion test:** The encode/decode pair earns its keep, but it's a shallow wrapper over a state
machine whose rules aren't in the interface.

**Direction:** A cursor module that owns "advance," "mark exhausted," and "recover" as named
operations with the tri-state invariant enforced. Tests: recovery/exhaustion become exercisable.
Locality: a third backend touches one module instead of three sites.

---

## 5. Two read paths for the same Card — and the live one is effectively dead

**Files:** index-backed reads (`routes.ts:85-102` list, `routes.ts:435-446` sync) vs the live
dual-backend `UnificationService.list()` (`unify.ts:294-322`, queries both backends then
`applyOverlays`); plus `loadDocument`'s per-source branch (`routes.ts:470-481`). Routes call
`unify.applyOverlays` (`routes.ts:474`) but never `unify.list()`.

**Problem:** The same logical Card is read three ways: list/sync from the index, get-by-id
conditionally (Readeck live, RSS from index), and a full live-merge path in
`UnificationService.list()` that nothing in `routes.ts` calls. The service was built to query
backends live and overlay them, but the app committed to the index as source of truth — leaving a
parallel, unexercised implementation of filter/sort/paginate logic.

**Touches ADR-0001.** The ADR frames the BFF as normalizing backends into a unified Card on read;
the index-as-source-of-truth design that won is implicit. The dead live-path is evidence the
source-of-truth decision was never recorded. Resolve to either "delete the live path" or "write an
ADR documenting index authority."

**Direction:** Collapse to one read path. Locality: filter/sort/paginate logic lives once; removing
the unused path removes a second mental model from the BFF.

---

## 6. "API as data" stops at the mock — the registry and mock dispatch have drifted

**Files:** `packages/shared/src/api.ts:202-492` (the `endpoints[]` registry driving routes, OpenAPI,
and client) vs `packages/api-client/src/mock-server.ts:271-549` (a hand-rolled `if (path === …)`
dispatch tree). Confirmed drift: **POST `/search` is in the registry but has no handler in the mock**
(it 404s).

**Problem:** The registry is the documented single source of truth, but the mock doesn't consume it.
Every new endpoint must be added to the registry *and* hand-wired into the mock's if-chain, with no
compile-time link. "API as data" is deep for routes/OpenAPI/client and leaky at exactly the spot
meant to validate the contract offline.

**Deletion test:** Delete `endpoints[]` and the mock keeps working (it never imported the registry) —
proof it's a parallel structure, not a derived one.

**Direction:** Derive mock dispatch from `endpoints[]`. Leverage: one place to add an endpoint.
Locality: drift like the missing `/search` handler becomes structurally impossible.

---

## 7. `SyncEngine`'s interface hides the Dexie coordination that holds the real bugs

**Files:** `apps/web/src/lib/sync.ts` (`SyncEngine`: `enqueue`/`flush`/`pull`, transactions inline at
`:118`, `:127`, `:145-152`), coupled to the `LecternDB` singleton; tests mock only `SyncClient`
(`sync.test.ts`).

**Problem:** `enqueue`/`flush`/`pull` read as a tidy three-method interface, but each wraps a Dexie
transaction spanning cards + outbox + meta. The genuine complexity — optimistic apply on enqueue,
outbox ordering on flush, cursor advance + bulk merge on pull — lives inside those transactions
against a concrete Dexie handle. Tests inject a `FakeClient` for the network seam but run against
real (fake-indexeddb) Dexie with no seam, so ordering/merge bugs surface only through full DB
behaviour, never through the interface.

**Deletion test:** Delete `SyncEngine` and the complexity scatters into every component that would
push mutations and manage its own optimistic writes — it earns its keep. But its interface doesn't
match its depth: the store it coordinates isn't a seam.

**Direction:** Introduce a store seam so the coordination is testable in isolation. Tests: "two
enqueues then a flush preserves order" becomes a unit test. Locality: Dexie transaction semantics
stop leaking to callers.

---

## Parking lot (not full candidates)

- **Reader route monolith** — `apps/web/src/routes/read/[id]/+page.svelte` (~1690 lines): content
  fetch, highlights, scroll/progress mutation, find, TOC, focus mode, keyboard, and queue nav all
  interleaved with no testable interface. Real locality problem, but a decomposition job more than a
  depth-at-a-seam one.
- **Rune stores re-implement lifecycle inconsistently** — `views-store`, `feeds-store`, `tts-player`
  each hand-roll load / error-swallowing / persistence with no shared "stateful store with
  persistence + error recovery" seam. Cleanup more than deepening.
