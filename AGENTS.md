# Repository Guidelines

## Project Overview

Lectern is a self-hosted Readwise Reader alternative for **RSS + read-later**. It is a thin
unification layer over two open-source backends — **MiniFlux** (RSS) and **Readeck** (saved
articles, reading progress, highlights) — adding the unified experience they lack: one inbox,
triage workflow, cross-source tags, saved views, offline reading, and a single Reader-style
API. Shipped as an installable PWA and packaged natively for **YunoHost** (no Docker in prod).

Single-user for v1. EPUB, AI, TTS, and PDF are explicitly out of the MVP.

## Architecture & Data Flow

Three runtime pieces, plus two shared TS packages:

- **`apps/web`** — SvelteKit 5 (runes) static SPA, offline-first. Reads from IndexedDB (Dexie),
  syncs deltas to the BFF, client-side search (minisearch). SSR is disabled (`+layout.ts`).
- **`apps/bff`** — Fastify aggregator. Normalizes both backends into a unified `Card`, owns a
  Postgres "glue" DB (Drizzle) for cross-source state the backends cannot hold, and exposes one
  Reader-style API + a sync/delta API. Optional pg-boss background ingestion jobs.
- **Backends** — MiniFlux + Readeck stay unmodified; the BFF talks to their HTTP APIs.
- **`packages/shared`** — Zod domain model + API contract (the single source of truth).
- **`packages/api-client`** — typed client over the contract, plus an in-process mock server.

Data flow:

```
MiniFlux / Readeck  --adapters-->  UnificationService  <--overlay--  glue Postgres
       (RssBackend / ReadLaterBackend interfaces)            (BFF-owned: location, tags,
                              |                               note, RSS progress, highlights)
                              v
        BFF /api/v1 (shared contract)  -->  LecternClient  -->  web (Dexie mirror + outbox)
```

- The **adapter seam** (`packages/shared/src/adapters.ts`: `RssBackend`, `ReadLaterBackend`)
  is load-bearing: Readeck can be swapped for Wallabag by writing one adapter. Adapters return
  normalized `Card`s (reading progress `0..1`, reading time in integer minutes).
- **Overlay merge**: backend-derived fields are denormalized into the glue `documents` table for
  fast querying; BFF-owned fields (unified location, tags, note, RSS progress/anchor, highlight
  count) are authoritative and win on merge (`apps/bff/src/unify.ts` → `mergeOverlay`).
- **Unified ids** are `"<source>:<sourceId>"` (e.g. `miniflux:42`), split on the first colon
  (`apps/bff/src/ids.ts`).
- **Offline sync**: client queues `Mutation`s in a Dexie outbox, pushes on reconnect; pulls
  deltas by cursor and merges (`apps/web/src/lib/sync.ts`). `Mutation` is a Zod discriminated
  union in `packages/shared/src/sync.ts`.
- **Auth**: `/api/v1/*` requires `Authorization: Bearer <LECTERN_API_TOKEN>` (constant-time
  compare); non-API routes trust the `Ynh-User` SSO header, falling back to `LECTERN_DEV_USER`
  in dev (`apps/bff/src/auth.ts`). The SPA fetches the token once from SSO-gated `/bootstrap`.

## Key Directories

| Path | Purpose |
| --- | --- |
| `apps/web/src/routes/` | SvelteKit pages (`inbox`, `later`, `shortlist`, `archive`, `feed`, `feeds`, `library`, `read/[id]`, `search`, `views/[id]`, `settings`) |
| `apps/web/src/lib/` | Client logic: `db.ts` (Dexie), `sync.ts`, `config.ts` (client/token), stores (`*.svelte.ts`), `search.ts`, `opml.ts`, `lists.ts`, components |
| `apps/bff/src/` | `app.ts` (Fastify builder + DI), `server.ts` (entry), `routes.ts`, `unify.ts`, `auth.ts`, `jobs.ts`, `mutations.ts`, `config.ts`, `deps.ts` |
| `apps/bff/src/backends/` | `miniflux.ts`, `readeck.ts` adapters (+ tests) |
| `apps/bff/src/db/` | `schema.ts` (Drizzle), `client.ts`; migrations in `apps/bff/drizzle/` |
| `packages/shared/src/` | `model.ts`, `api.ts` (endpoint registry + OpenAPI builder), `query.ts`, `feeds.ts`, `views.ts`, `sync.ts`, `adapters.ts` |
| `packages/api-client/src/` | `client.ts` (`LecternClient`), `mock-server.ts` / `mock-cli.ts` |
| `infra/` | `docker-compose.yml` dev backends (MiniFlux 8088, Readeck 8089, Postgres 5433) |
| `packaging/` | `build-artifact.sh`, `lectern_ynh/` (YunoHost package) |
| `docs/adr/` | Architecture decision records (read these first for "why") |

## Development Commands

Run from the repo root (pnpm workspace; `-r` fans out in dependency order):

```sh
pnpm install                                       # install workspace
pnpm dev                                            # run web + bff (parallel)
pnpm build                                          # build all packages
pnpm test                                           # vitest run, all packages
pnpm typecheck                                      # tsc --noEmit / svelte-check
pnpm lint                                           # eslint across packages
pnpm format                                         # prettier --write .
pnpm format:check                                   # prettier --check .

cp .env.example .env                                # then fill backend tokens
docker compose -f infra/docker-compose.yml up -d    # dev backends

pnpm --filter @lectern/bff dev                      # tsx watch (BFF only)
pnpm --filter @lectern/web dev                      # vite dev (SPA only)
pnpm --filter @lectern/api-client mock              # mock API on :8788 (MOCK_PORT)
pnpm --filter @lectern/shared openapi               # regenerate openapi.json
pnpm --filter @lectern/bff exec drizzle-kit generate # write ./drizzle SQL from schema
pnpm --filter @lectern/bff exec drizzle-kit push     # apply schema to DB
```

The Vite dev server proxies `/api` → `http://127.0.0.1:8788` (the mock); point
`PUBLIC_LECTERN_API_URL` at a real `<origin>/api/v1` to override.

## Code Conventions & Common Patterns

- **TypeScript everywhere, strict**, ES modules (`"type": "module"`). `moduleResolution: bundler`,
  `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true` (see `tsconfig.base.json`). Use
  `import type { … }` for type-only imports — `verbatimModuleSyntax` enforces it.
- **Zod is the contract.** Schemas in `packages/shared` are the single source of truth; types are
  always `z.infer<typeof Schema>` (schema and type share the name, e.g. `export const Card = …;`
  `export type Card = z.infer<typeof Card>;`). Validate at every boundary — adapters re-`parse`
  normalized cards, the client validates responses, the mock validates fixtures.
- **API as data.** Endpoints live in one registry (`endpoints: Endpoint[]` in `api.ts`); routes,
  the OpenAPI 3.1 doc (`buildOpenApiDocument` → `openapi.json`), the client, and the mock all
  derive from it. Add an endpoint here first.
- **Dependency injection in the BFF.** `buildApp(deps?: AppDeps)` takes injectable deps
  (`rss`, `readLater`, `overlay`, `unify`); production wires them in `deps.ts` (`buildRealDeps`),
  tests pass in-memory fakes that implement the real interfaces. Adapter/pool construction is
  connection-lazy, so importing performs no I/O.
- **Error handling.** Adapters throw `BackendHttpError` (carries upstream status + `Retry-After`).
  The Fastify error handler maps: Zod → 400, backend 429 → propagate, 404 → 404, other backend
  faults → 502, else 500 (no stack leak). The client throws `LecternApiError(status, …)`.
- **Async**: `async`/`await` throughout; `Promise.allSettled` for fan-out across backends
  (`unify.ts` `settledPage`); deterministic backoff (no jitter) in `sync.ts`.
- **State (web)**: Svelte 5 runes. Reactive stores are classes in `*.svelte.ts` files using
  `$state`/`$derived` (e.g. `views-store.svelte.ts`); Dexie `liveQuery` is bridged to runes via
  `liveCards` in `live.svelte.ts`. Store failures are swallowed into an `error` field so the app
  keeps working offline.
- **Exports**: named only (no default exports in TS packages); barrel files re-export
  (`packages/shared/src/index.ts`, `$lib`).
- **Naming**: `camelCase` values, `PascalCase` types/schemas/classes, `kebab-case` filenames
  (`*.svelte.ts` for rune modules, `+page.svelte`/`+layout.ts` for SvelteKit routes).
- **Formatting** is split: root TS packages use Prettier defaults (2-space, double quotes);
  `apps/web` has its own `.prettierrc` (**tabs, single quotes, no trailing comma, printWidth 100**)
  and a Svelte-aware ESLint config. Match the local style of the file you edit.

## Important Files

- `apps/bff/src/app.ts` — Fastify app builder, DI, error handler, route registration.
- `apps/bff/src/server.ts` — process entry (port bind, signal handling, job start/stop).
- `apps/bff/src/unify.ts` — unification + overlay merge + combined cursor; the core BFF logic.
- `apps/bff/src/db/schema.ts` — glue Postgres schema (`documents`, `rss_highlights`,
  `saved_views`, `backend_tokens`, `sync_cursors`, `ingestion_log`).
- `packages/shared/src/model.ts` — unified `Card` and enums (`Source`, `Category`, `Location`,
  `ReadState`, `Highlight`, `Tag`).
- `packages/shared/src/api.ts` — endpoint registry + OpenAPI generator.
- `packages/shared/src/adapters.ts` — `RssBackend` / `ReadLaterBackend` seam.
- `apps/web/src/lib/{db,sync,config}.ts` — local mirror, sync engine, client/token plumbing.
- `apps/bff/src/config.ts` & `.env.example` — Zod-validated env (defaults boot against local dev).
- `docs/adr/0001..0003` — architecture, backend choice, monorepo/tooling decisions.

## Runtime/Tooling Preferences

- **Runtime: Node ≥ 22** (engines pinned; tsup targets `node22`). Not Bun.
- **Package manager: pnpm 11.5.1** (`packageManager` field). Use `pnpm`, never npm/yarn.
- Workspace deps use the `workspace:*` protocol. Packages export **TS source directly**
  (`exports → ./src/index.ts`) — bundlers (Vite/tsup/Vitest) consume source, so there is **no
  pre-build step** for dev/test. The BFF bundles `@lectern/*` via tsup (`noExternal: /^@lectern\//`).
- Build tools: **tsup** (BFF bundle), **Vite + adapter-static** (web SPA, `fallback: index.html`),
  **tsc/svelte-check** for typechecking, **Drizzle Kit** for migrations.
- ESLint flat config: two configs by design — root (`eslint.config.js`) for the TS packages
  (`typescript-eslint` recommended; ignores `apps/web/**`, `dist`, `build`, `.svelte-kit`,
  `docs`), and `apps/web/eslint.config.js` for Svelte.

## Testing & QA

- **Framework: Vitest** (`*.test.ts`, colocated next to source). `pnpm test` runs `vitest run`
  per package. The web app defines a Vitest `server` project (node env) and excludes
  `*.svelte.{test,spec}.ts`; it enforces `expect.requireAssertions`.
- **No mocking libraries / no network.** BFF unit tests use **hand-written in-memory fakes** that
  implement `RssBackend`/`ReadLaterBackend`/`OverlayStore`, injected via `buildApp(deps)`, and
  exercise routes with `app.inject(...)` (no port bind). See `apps/bff/src/routes.test.ts`.
- **Test behavior against the contract**: build fixtures with `Card.parse(...)` / `Feed.parse(...)`
  and assert against schemas, not literal shapes.
- **Web tests** use `fake-indexeddb/auto` for Dexie and a scriptable `FakeClient` implementing the
  sync surface (`apps/web/src/lib/sync.test.ts`).
- **Live integration** (`apps/bff/src/integration.test.ts`) is `describe.skipIf`-guarded: it runs
  only when `READECK_API_TOKEN` is set and both backends are reachable, so CI without backends
  still passes. Bring up `infra/docker-compose.yml` and fill `.env` to run it.
- **Manual API spikes** live in `spikes/*.mjs` (run with `node --env-file=.env spikes/<x>.mjs`);
  findings in `docs/spikes/D1-findings.md`.
- No coverage thresholds are configured. When adding a feature, add a colocated `*.test.ts`
  covering branches/edge values; run only the tests you touched unless asked otherwise.

## Design Context

Strategic design context lives in **`PRODUCT.md`** (the source of truth) and the visual
system in **`DESIGN.md`**. Read them before any UI/design work.

- **Register: product** — app UI where design serves the reading workflow.
- **Personality: calm, literary, trustworthy** — editorial and paper-like, reading-first;
  the text leads and the chrome recedes. A calm queue, never a feed.
- **Not**: busy social feed, sterile corporate SaaS, flashy AI aesthetic (neon/glass/gradients),
  or a cluttered power-user IDE.
- **Accessibility: WCAG AAA where feasible** — a headline feature (reading-tuned faces, high
  contrast theme, reader-controlled type/measure/theme, reduced-motion). Don't erode it.
