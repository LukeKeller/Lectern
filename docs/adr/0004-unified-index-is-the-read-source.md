# 4. The unified index is the authoritative read source

Date: 2026-06-06
Status: Accepted

## Context

ADR 0001 frames the BFF as "normalizing both backends into a unified `Card` on read." That
left _how_ reads are served implicit, and the codebase ended up with two parallel read paths
for the same logical `Card`:

1. A **live merge path** — `UnificationService.list()` queried MiniFlux and Readeck in
   parallel on every request, overlaid glue state, and stitched the two backend cursors into
   one opaque combined cursor (`encodeCombinedCursor` / `decodeCombinedCursor`).
2. An **index-backed path** — a background poll (`jobs.ts`) denormalizes both backends into
   the glue `documents` table, and routes read list/sync straight from that index
   (`OverlayStore.listDocuments` / `documentsChangedSince`).

The app committed to path 2: `GET /documents` and `/sync` read only the index, and the live
`list()` was never called from `routes.ts`. The two designs also disagreed on failure
semantics — the combined cursor used a tri-state (`offset` / `null` = exhausted /
`undefined` = unstarted) where a single transient backend failure could permanently skip a
source until the cursor was reset.

## Decision

The **unified `documents` index is the single source of truth for all list and sync reads.**
Backends are queried live in exactly two places:

- The **background poll** (`jobs.ts`), which keeps the index fresh (backend-truth columns)
  while preserving BFF-owned overlay columns.
- The **live get-by-id path** for a Readeck article, which fetches the bookmark fresh and
  overlays glue state via `UnificationService.applyOverlays`. RSS get-by-id is served from
  the index (`getIndexedCard`).

The dead live merge path is removed: `UnificationService.list()`, the `settledPage` helper,
and the combined-cursor codec are deleted. `UnificationService` is now an overlay applier
only (`applyOverlays`), depending solely on the `OverlayStore`.

## Consequences

- One read path, one cursor model: list/sync paginate over the index's own offset / ISO
  timestamp cursors. The combined-cursor tri-state and its recovery hazard are gone.
- Filter/sort/paginate logic lives once (the index), not duplicated in a live path.
- New read-affecting behaviour is added at the index (`OverlayStore`) and the poll, not in a
  second live merge implementation.
- Reads do not fan out to backends on the hot path, so a slow/faulting backend degrades
  freshness (next poll) rather than request latency.
