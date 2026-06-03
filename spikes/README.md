# D1 API spikes

Throwaway scripts that exercise the real backend APIs against the local dev stack
(`infra/docker-compose.yml`). They ground the D2 domain model and contract.

```sh
docker compose -f infra/docker-compose.yml up -d
# fill .env with backend tokens (see .env.example / infra/README.md)
node --env-file=.env spikes/miniflux.mjs
node --env-file=.env spikes/readeck.mjs
```

`readeck.mjs` also samples extraction quality — edit the `SAMPLE` array to test your
own real-world URLs (paywalled, Substack, JS-heavy) before relying on the backend.

Findings + the locked decision: [`docs/spikes/D1-findings.md`](../docs/spikes/D1-findings.md).
