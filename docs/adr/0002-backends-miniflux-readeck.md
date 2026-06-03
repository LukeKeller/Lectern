# 2. Backends: MiniFlux (RSS) + Readeck (read-later)

Date: 2026-06-03
Status: Accepted (validated in D1 — see docs/spikes/D1-findings.md)

## Context

RSS is fixed to MiniFlux (lightweight Go binary, excellent token API, full-content scraping,
webhooks, OPML, official YunoHost package). The read-later backend was the open decision.
Candidates: Wallabag, Readeck, Karakeep, Shiori, Linkding, Omnivore, ArchiveBox.

The clone needs: readability extraction, persisted full text, tags, highlights/annotations,
reading progress, full-text search, and a good documented REST API.

## Decision

Use **Readeck** as the read-later backend.

It is the only candidate exposing **writable reading progress** (`read_progress` +
`read_anchor`) _and_ highlights/annotations over a clean OpenAPI Bearer-token API — the two
hardest features to bolt on externally. It is also a single Go binary + Postgres (same
operational shape as MiniFlux) with an official YunoHost package.

**Runner-up: Wallabag** — stronger extraction (FiveFilters site-config) and LDAP/SSO, but no
API-exposed reading progress and a heavier PHP stack. Kept as the documented swap target.

## Consequences

- For saved articles, reading progress + highlights are a backend concern, not ours.
- Readeck's generic extraction is weaker than Wallabag's on paywalled/JS-heavy sites; **D1**
  runs an extraction bake-off on real sources before final lock-in, and we keep an
  "open original" fallback.
- Readeck has no SSO yet (local accounts + tokens); on YunoHost it sits behind the reverse
  proxy and the BFF talks to it with an API token.
