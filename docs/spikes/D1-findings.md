# D1 — Backend API spike findings

Date: 2026-06-03
Stack: local Docker (`infra/docker-compose.yml`) — MiniFlux `:latest`, Readeck `:latest`,
Postgres 17. Reproduce with `spikes/miniflux.mjs` and `spikes/readeck.mjs`.

## Decision

**Lock Readeck as the read-later backend** (ADR 0002 → Accepted). The decisive capability —
writable reading progress *and* highlights over a token API — is confirmed working, and
extraction quality on a representative sample is good. Wallabag was not stood up for a full
side-by-side: its lack of API-exposed reading progress already disqualifies it on the primary
criterion. Re-run `spikes/readeck.mjs` with your own URLs to validate extraction on your real
sources before scaling up.

## MiniFlux (RSS) — confirmed

Auth: HTTP Basic (`admin:adminpass`) works directly against `/v1/*` in dev; production uses a
per-user `X-Auth-Token`.

| Capability | Result |
| --- | --- |
| `GET /v1/me` | ok |
| `POST /v1/categories`, `POST /v1/feeds` | feed created, 30 entries fetched |
| `GET /v1/entries?feed_id=&limit=&order=&direction=` | ok (filter + sort) |
| `GET /v1/feeds/counters` | `{ reads, unreads }` |
| `PUT /v1/entries {entry_ids, status:"read"}` | status → `read` (204) |
| `PUT /v1/entries/{id}/bookmark` | `starred` → true (204) |
| `GET /v1/entries/{id}/fetch-content` | re-scrapes original (content 4410 chars) |
| `GET /v1/entries?changed_after=<unix>` | **works** — use for delta sync |
| `GET /v1/entries?published_after=<unix>` | works (publish-time filter) |
| `GET /v1/entries?search=` | full-text search ok |
| `GET /v1/export` | OPML ok |

Entry fields: `id, user_id, feed_id, status, hash, title, url, comments_url, published_at,
created_at, changed_at, content, author, share_code, starred, reading_time, enclosures, feed, tags`.

Gaps (must be supplied by the BFF): **no per-entry reading progress / scroll anchor**; status is
binary (`unread`/`read`/`removed`) + a `starred` flag; entry `tags` exist but are feed-derived,
not a user-writable triage mechanism. `reading_time` is an integer (minutes).

## Readeck (read-later) — confirmed

Auth: `Authorization: Bearer <token>`; tokens minted in the UI (Profile → API Tokens) with
scoped roles. First run requires UI onboarding/login before the API unlocks.

| Capability | Result |
| --- | --- |
| `POST /api/bookmarks {url}` | `202 Accepted`; id returned in **header/location**, not body |
| `GET /api/bookmarks/{id}` | full bookmark; `state===0`/`loaded===true` when ready |
| `GET /api/bookmarks/{id}/article` | clean article HTML (42,940 chars for danluu) |
| `PATCH {read_progress:42, read_anchor:"#node-5"}` | **round-trips** ✓ (the decisive capability) |
| `PATCH {add_labels:[...]}` | labels round-trip ✓ |
| `GET /api/bookmarks/{id}/annotations` | `200`, array (highlights) |
| `POST .../annotations` | requires `start_selector, start_offset, end_selector, end_offset` (+ `color`, optional `note`) |
| `GET /api/bookmarks?search=` | full-text; pagination via headers `total-count, total-pages, current-page, link` |

Bookmark fields: `id, href, created, updated, state, loaded, url, title, site_name, site,
authors, lang, text_direction, document_type, type, has_article, description, is_deleted,
is_marked, is_archived, labels, read_progress, resources, links, word_count, reading_time`.

Extraction sample (all `has_article: true`):

| URL | words | reading_time | title |
| --- | --- | --- | --- |
| danluu.com/web-bloat | 4314 | 21 | How web bloat impacts users with slow connections |
| overreacted.io/a-complete-guide-to-useeffect | 10198 | 50 | A Complete Guide to useEffect |
| blog.codinghorror.com/the-best-code-is-no-code-at-all | 728 | 3 | The Best Code is No Code At All |
| en.wikipedia.org/wiki/RSS | 3880 | 19 | RSS |

## Implications for D2 (model + adapters)

- **Reading progress unit**: Readeck `read_progress` is an integer `0..100`. Normalize to the
  `Card.readingProgress` `0..1` in the Readeck adapter.
- **`reading_time`**: both backends expose integer **minutes**. Change `Card.readingTime` to a
  number (minutes) rather than a string.
- **Readeck has no read_status enum**: triage state is derived from `is_archived` (archive),
  `is_marked` (favorite/shortlist candidate), and `read_progress`. The unified `Location` mapping
  for saved articles is BFF logic over these flags, not a 1:1 field. Revisit the `ReadStatus`
  enum in the model accordingly.
- **Create-bookmark is async**: `202` + id in the `Bookmark-Id`/`Location` header; the adapter
  must poll `state`/`loaded` before the article is available.
- **Highlights need DOM range selectors**: the client renders Readeck's `/article` HTML and
  derives `start_selector/offset` + `end_selector/offset` from the user's selection.
- **Delta sync**: MiniFlux → `changed_after` (unix). Readeck → list ordered by `updated` with
  header-based pagination; confirm an `updated_since`-style filter actually narrows results in D3
  (the endpoint accepted the param; effectiveness not yet asserted).
- **MiniFlux auth in prod**: per-user `X-Auth-Token`; Basic is a dev convenience only.
