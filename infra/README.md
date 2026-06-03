# Local dev backends

`docker-compose.yml` brings up the two backends Lectern aggregates, plus a Postgres
instance that hosts both MiniFlux's DB and Lectern's own glue DB.

```sh
docker compose -f infra/docker-compose.yml up -d
```

| Service  | URL                   | Notes                                           |
| -------- | --------------------- | ----------------------------------------------- |
| MiniFlux | http://localhost:8088 | admin / adminpass (dev only)                    |
| Readeck  | http://localhost:8089 | create the first user via its UI                |
| Postgres | localhost:5433        | user/pass `lectern`; DBs: `lectern`, `miniflux` |

After both are up:

1. In MiniFlux, create an API key (Settings → API Keys) → `MINIFLUX_API_TOKEN`.
2. In Readeck, create an API token → `READECK_API_TOKEN`.
3. Copy both into your root `.env` (see `.env.example`).

> The image tags and Readeck env keys here are a starting point. **D1** (backend
> provisioning + API spike) validates them and locks the read-later backend choice.
