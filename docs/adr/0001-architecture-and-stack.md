# 1. Architecture and tech stack

Date: 2026-06-03
Status: Accepted

## Context

Lectern clones the Readwise Reader experience for RSS + read-later. Readwise's value is
the _unified_ experience over two content sources, not any single backend feature. We must
run it self-hosted on a YunoHost VPS, serving web + Android (installable PWA acceptable).

## Decision

Build a **thin unification layer over two open-source backends** rather than a reader from
scratch:

- **MiniFlux** for RSS, **Readeck** for saved articles (see ADR 0002).
- One custom app: a **SvelteKit PWA** + a **Fastify backend-for-frontend (BFF)** + a small
  **Postgres** "glue" DB for the cross-source state the backends cannot hold (unified
  triage location, unified tags, saved views, RSS-item reading progress + highlights).
- The BFF normalizes both backends into a unified `Card` model and exposes one Reader-style
  API + a sync/delta API. The client is offline-first (IndexedDB cache + client search).
- Auth: YunoHost SSO (`Ynh-User` header) for the web UI; an app-issued bearer token for the
  `/api` path used by the PWA/Android client.
- Packaged **natively** for YunoHost (no Docker in production).

EPUB (OPDS + KOReader sync), AI, TTS, and PDF are explicitly out of the MVP.

## Consequences

- We own the unification/sync logic and the glue schema; the backends stay unmodified.
- Backend adapters sit behind interfaces (`RssBackend`, `ReadLaterBackend`) so the read-later
  backend can be swapped (e.g. to Wallabag) with one adapter change.
- Full rationale and feature mapping: `docs/planning/architecture-plan.html`.
