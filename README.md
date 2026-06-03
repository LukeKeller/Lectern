# Lectern

A self-hosted Readwise Reader alternative for **RSS + read-later**, built as a thin
unification layer over two open-source backends:

- **[MiniFlux](https://miniflux.app)** — RSS feeds.
- **[Readeck](https://readeck.org)** — saved articles (with reading progress + highlights).

Lectern adds the unified experience the backends lack: one inbox, a triage workflow,
cross-source tags, saved views, offline reading, and a single Reader-style API — delivered
as an installable PWA and website, packaged as a native YunoHost app.

> Status: **D0 — scaffold.** See [`docs/planning/implementation-plan.html`](docs/planning/implementation-plan.html)
> for the deliverable breakdown and [`docs/planning/architecture-plan.html`](docs/planning/architecture-plan.html)
> for the architecture. Architecture decisions are recorded in [`docs/adr/`](docs/adr).

## Layout

```
apps/
  web/            SvelteKit PWA (web + Android)
  bff/            Fastify aggregator / backend-for-frontend
packages/
  shared/         Domain model + API contracts (Zod) shared by web and bff
  api-client/     Typed client generated from the contract (filled in D2)
infra/            Docker Compose for local dev backends (MiniFlux + Readeck)
ynh/              YunoHost package (filled in D8)
docs/             Planning artifacts and ADRs
```

## Develop

Requires Node >= 22 and pnpm.

```sh
pnpm install            # install the workspace
pnpm typecheck          # tsc across all packages
pnpm test               # unit tests
pnpm build              # build web + bff
pnpm lint               # eslint across packages
pnpm format             # prettier write

cp .env.example .env    # then fill in backend tokens (see infra/)
docker compose -f infra/docker-compose.yml up -d   # dev backends (validated in D1)
pnpm dev                # run web + bff
```

## License

[AGPL-3.0-only](LICENSE).
