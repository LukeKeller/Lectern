-- =============================================================================
-- dedupe-newsletter-documents.sql
--
-- WHAT THIS FIXES
--   A bug in newsletter ingestion re-imported the same email repeatedly. Each
--   re-import minted a NEW Readeck bookmark, so each landed in `documents` as a
--   NEW row with a fresh `source_id` (id = 'readeck:<bookmarkId>', unique on
--   (source, source_id)) but the SAME synthetic `url`
--   ('https://newsletter.lectern.local/<urlencoded-message-id>').
--
--   Result: duplicate rows per real newsletter, with the user's read progress /
--   finished flag / delete tombstone / triage state scattered across whichever
--   copy they happened to act on.
--
--   This script collapses each `url` group down to ONE canonical row, merges the
--   group's state onto it, re-points or drops every child row that referenced a
--   non-survivor, and deletes the non-survivors.
--
-- -----------------------------------------------------------------------------
-- PRODUCTION SHAPE THIS WAS WRITTEN AGAINST (verified read-only, 2026-07-19)
-- -----------------------------------------------------------------------------
--   74 in-scope email docs across 65 distinct URLs; 70 tombstoned, 4 live.
--   9 URL groups hold exactly 2 copies each:
--     - 4 groups are MIXED (1 live + 1 tombstoned). All 4 live docs live here.
--     - 5 groups are FULLY TOMBSTONED.
--   In 3 of the 4 mixed groups the TOMBSTONED copy is the NEWER one (the 07-19
--   re-import) and the original is live — the user deleted the *duplicate*, not
--   the newsletter. In 1 group it is reversed.
--
--   Upstream Readeck held exactly 4 email-labelled bookmarks, matching the 4 live
--   docs exactly; the 70 tombstoned rows have no upstream bookmark (the
--   source-deletes succeeded). So this script does NOT need to delete anything in
--   Readeck — it only touches the local glue DB.
--   *** RE-VERIFY THAT BEFORE RUNNING. *** The script cannot detect, let alone
--   repair, an upstream/local divergence that appeared after the counts above
--   were taken. If Readeck has gained bookmarks for URLs this script tombstones
--   or deletes, pollReadeck will simply re-index them afterwards.
--
-- -----------------------------------------------------------------------------
-- SURVIVOR / MERGE RULE: "LIVE WINS" (user-approved)
-- -----------------------------------------------------------------------------
--   An earlier draft of this script used "if ANY row in the group has
--   deleted_at, the survivor ends up deleted". That rule is WRONG for this data
--   and is deliberately NOT implemented here. It cannot distinguish
--
--       "I deleted this newsletter"   from   "I deleted the redundant duplicate"
--
--   and in production every one of the 4 mixed groups is the second case. Applied
--   as written it would have tombstoned all 4 mixed groups and emptied the user's
--   entire live newsletter library. It would not even have stuck: those 4 URLs
--   still have live Readeck bookmarks, so the next pollReadeck would re-index
--   them and `backendTruthSet` (which sets `deleted_at = null` on every refresh)
--   would clear the tombstone inside 5 minutes.
--
--   The implemented rule instead is:
--     1. If the group contains ANY live row, the survivor is the OLDEST LIVE row
--        (saved_at ASC NULLS LAST, tiebreak id). Only when EVERY row in the group
--        is tombstoned does the survivor become the oldest tombstoned row.
--     2. A live survivor is NEVER flipped to deleted. A group with at least one
--        live row ends LIVE. A fully-tombstoned group stays tombstoned, keeping
--        the earliest deleted_at in the group.
--
-- -----------------------------------------------------------------------------
-- CRITICAL: TOMBSTONES ARE LOAD-BEARING. NEVER EMPTY A URL.
-- -----------------------------------------------------------------------------
--   `ingestNewsletters` (apps/bff/src/jobs.ts:246) now calls
--   `store.findByUrl(newsletterUrl(msg.messageId))` before saving and skips on
--   ANY match. `findByUrl` (apps/bff/src/overlay-store.ts:246) deliberately does
--   NOT filter out tombstoned rows — the comment there spells out why: a deleted
--   newsletter must not resurrect itself on the next mailbox replay. That guard
--   is the thing that stops the re-import bug.
--
--   Therefore the ROW ITSELF is the dedupe key, live or tombstoned. This script
--   must leave EXACTLY ONE row per URL and must NEVER remove the last row for a
--   URL — doing so would unblock re-ingestion of every newsletter still sitting
--   in the mailbox and recreate the exact bug we are cleaning up. Post-check
--   assertions below enforce this and abort the transaction if violated.
--
-- -----------------------------------------------------------------------------
-- WHEN IT IS SAFE TO RUN
--   *** ONLY AFTER the ingestNewsletters findByUrl fix is deployed and live. ***
--   Otherwise duplicates simply come back. Deploy, confirm no new 'readeck:*'
--   rows appear for an existing newsletter url, then run this.
--
--   The script is IDEMPOTENT: after a successful run no URL group has more than
--   one row, so a second run selects nothing and changes nothing.
--
-- SCOPE (nothing outside this predicate is ever read or written)
--   documents.category = 'email'
--   AND documents.url LIKE 'https://newsletter.lectern.local/%'
--
-- -----------------------------------------------------------------------------
-- 0. TAKE A BACKUP FIRST. Non-negotiable: this deletes rows.
-- -----------------------------------------------------------------------------
--   pg_dump --format=custom --no-owner --no-privileges \
--     --dbname="$DATABASE_URL" \
--     --file="lectern-$(date +%Y%m%d-%H%M%S).dump"
--
--   (DATABASE_URL is the BFF's glue DB, e.g.
--    postgres://lectern:lectern@localhost:5433/lectern — see .env / apps/bff.
--    On the YunoHost box the DB name is `lectern`; explicit-flag form:
--      pg_dump -h 127.0.0.1 -U lectern -d lectern -Fc \
--        -f lectern-$(date +%Y%m%d-%H%M%S).dump )
--
--   Restore, if you need it:
--     pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" lectern-....dump
--
-- -----------------------------------------------------------------------------
-- 1. DRY RUN (default). Reports only; the transaction is ROLLED BACK.
-- -----------------------------------------------------------------------------
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" \
--     -f apps/bff/scripts/dedupe-newsletter-documents.sql
--
--   This still executes the merge/delete inside a transaction and then rolls it
--   back, so the "AFTER" numbers and the assertions are real, not estimated.
--   Nothing is persisted. Read every report block before proceeding.
--
-- -----------------------------------------------------------------------------
-- 2. FOR REAL. Same file, one extra flag. COMMITs.
-- -----------------------------------------------------------------------------
--   psql -v ON_ERROR_STOP=1 -v apply=true -d "$DATABASE_URL" \
--     -f apps/bff/scripts/dedupe-newsletter-documents.sql
--
--   Clients pick the merge up through /sync because every touched survivor gets
--   `updated_at = now()`.
--
-- =============================================================================
-- DELETES vs TOMBSTONES (for the rows being removed)
--   Non-survivors are HARD deleted, not tombstoned. They are duplicates that
--   should never have existed, and a tombstone would leave their
--   (source, source_id) rows in place for a stale Readeck poll to un-tombstone
--   (backendTruthSet sets deleted_at = null on every refresh). Hard delete is the
--   only state the poller cannot undo.
--
--   This does NOT weaken the re-import guard: the guard keys on `url`, and the
--   SURVIVING row keeps that url — live or tombstoned, findByUrl still matches.
--   Removing duplicates of a url is safe; removing the last row for a url is not,
--   which is exactly what the post-check assertions forbid.
-- =============================================================================

\set ON_ERROR_STOP on
-- Default to dry run unless the caller passed -v apply=true.
\if :{?apply}
\else
  \set apply false
\endif

\timing on
\pset pager off

BEGIN;

-- Belt and braces: never let this script sit on locks if something is wedged.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';

-- =============================================================================
-- BUILD THE WORKING SET (temp tables; ON COMMIT DROP covers commit AND rollback)
-- =============================================================================

-- BEFORE snapshot of EVERY in-scope url (not just the duplicated ones). This is
-- the baseline the post-check assertions compare against: every url in here must
-- still exist after the run, and every url that had a live row must still have
-- one. Built first, before anything is touched.
CREATE TEMP TABLE nl_url_before ON COMMIT DROP AS
SELECT
  url,
  count(*)                                   AS rows_before,
  count(*) FILTER (WHERE deleted_at IS NULL) AS live_before
FROM documents
WHERE category = 'email'
  AND url LIKE 'https://newsletter.lectern.local/%'
GROUP BY url;

CREATE UNIQUE INDEX ON nl_url_before (url);
ANALYZE nl_url_before;

-- Every in-scope row that belongs to a url with more than one copy, ranked.
-- rn = 1 is the SURVIVOR.
--
-- ---------------------------------------------------------------------------
-- SURVIVOR SELECTION — the "live wins" ordering, in three keys:
--
--   (deleted_at IS NULL) DESC   A live row outranks a tombstoned one, always.
--                               Boolean DESC puts true first, so if the group
--                               holds any live row the survivor is guaranteed
--                               live; if every row is tombstoned the key is
--                               constant false and simply falls through to the
--                               next key. This one line is the whole fix: it is
--                               what stops a "user deleted the duplicate"
--                               tombstone from swallowing the real newsletter.
--
--   saved_at ASC NULLS LAST     Among the winning class, oldest first — the
--                               original import, not the 07-19 re-import. NULLS
--                               LAST so a row missing saved_at never beats a row
--                               that has one (missing data is not "ancient").
--
--   id ASC                      Deterministic tiebreak, so repeated runs and the
--                               dry run/real run pick the same survivor.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE nl_member ON COMMIT DROP AS
WITH scoped AS (
  SELECT *
  FROM documents
  WHERE category = 'email'
    AND url LIKE 'https://newsletter.lectern.local/%'
),
dupe_urls AS (
  SELECT url FROM scoped GROUP BY url HAVING count(*) > 1
),
ranked AS (
  SELECT
    s.id,
    s.url,
    row_number() OVER (
      PARTITION BY s.url
      ORDER BY (s.deleted_at IS NULL) DESC, s.saved_at ASC NULLS LAST, s.id ASC
    ) AS rn
  FROM scoped s
  JOIN dupe_urls d USING (url)
)
SELECT id, url, rn, (rn = 1) AS is_survivor
FROM ranked;

CREATE INDEX ON nl_member (url);
CREATE UNIQUE INDEX ON nl_member (id);
ANALYZE nl_member;

-- One row per duplicated url: the survivor plus the merged state to write onto it.
--
-- ---------------------------------------------------------------------------
-- PER-COLUMN MERGE DECISIONS
-- (BFF-authoritative overlay columns are location, tags, note, read_progress,
--  read_anchor — see OVERLAY_COLUMNS in apps/bff/src/overlay-store.ts:1669 and
--  the header comment on `documents` in apps/bff/src/db/schema.ts. Everything
--  else on the row is backend-derived truth, refreshed by the next poll.)
--
-- Throughout, `group_has_live` = "this group contains at least one row with
-- deleted_at IS NULL", which (given the survivor ordering above) is exactly
-- "the survivor is live".
-- ---------------------------------------------------------------------------
--
--   id, source, source_id  -> SURVIVOR'S OWN, untouched. This is the identity of
--                             the row and the (source, source_id) unique key. For
--                             a live group this is deliberately the id that still
--                             has a matching upstream Readeck bookmark.
--
--   category, title, url,  -> SURVIVOR'S OWN, untouched. Backend truth. All
--   saved_at                  copies share the url by construction and are the
--                             same newsletter; the next poll rewrites these.
--
--   metadata               -> SURVIVOR'S OWN, except metadata->'card'->>'readState'
--                             (below). The card blob is a per-bookmark backend
--                             snapshot; merging arbitrary keys across bookmarks
--                             would invent a card that never existed. cardFromRow()
--                             overlays the row's location/tags/note/read_progress/
--                             read_anchor on top of metadata.card when serving, so
--                             the stale mirrors inside the blob are already ignored.
--
--   deleted_at             -> "LIVE WINS", the rule this revision exists for:
--                               * group_has_live  -> NULL. The survivor is live and
--                                 STAYS live. A tombstone on a duplicate copy is
--                                 read as "delete the duplicate", never as "delete
--                                 the newsletter", and is discarded with its row.
--                               * fully tombstoned -> earliest deleted_at in the
--                                 group. The user really did delete this one; the
--                                 earliest timestamp is when they actually did it.
--                             There is no live -> deleted path here.
--
--   read_progress          -> MAX across the group, for groups whose survivor ends
--                             up LIVE. Reading any copy is reading the newsletter.
--                             Fully-tombstoned groups keep the survivor's own value
--                             and take a plain tombstone: the progress is not
--                             user-visible and rewriting it would only add churn.
--
--   metadata card.readState-> forced to 'finished' (jsonb_set) if ANY copy is
--                             'finished', for groups whose survivor ends up LIVE.
--                             This is the flag listQuery/unify.ts check
--                             (overlay-store.ts:292,311,1308), so a "finished"
--                             recorded on a duplicate would otherwise be lost.
--                             Sticky: only ever set, never downgraded.
--
--   location               -> SURVIVOR'S OWN, unless the survivor is still 'inbox'
--                             (the untriaged default) and another copy was triaged
--                             elsewhere — then the most recently updated non-'inbox'
--                             location. location is NOT NULL with no empty value, so
--                             'inbox' is the moral equivalent of "never acted on". A
--                             deliberate triage decision on any copy beats an
--                             untouched default; an explicit choice on the survivor
--                             is never second-guessed.
--
--   tags                   -> UNION of all tags in the group, deduped and sorted.
--                             Tags are additive user labels; there is no sensible
--                             "which copy is correct" answer, and silently dropping
--                             a tag the user typed is worse than carrying an extra.
--                             The only column that merges rather than picks.
--
--   note                   -> SURVIVOR'S OWN if non-null and not whitespace-only;
--                             otherwise the most recently updated non-blank note in
--                             the group, stored VERBATIM (the blank test trims, the
--                             stored value does not). Notes are free text and cannot
--                             be merged; nothing is concatenated. REPORT 5 flags any
--                             group holding two or more DISTINCT non-blank notes so
--                             the losses can be eyeballed before committing.
--
--   read_anchor            -> SURVIVOR'S OWN if non-blank; otherwise the anchor of
--                             the copy with the highest read_progress. An anchor is
--                             only meaningful paired with the progress it was
--                             captured at, so it travels with the progress adopted.
--
--   updated_at             -> now(), for survivors this script touches.
--                             documentsChangedSince() drives /sync off updated_at,
--                             so without the bump clients never learn about the
--                             merge. Skipped on a re-run, which finds no groups.
--
CREATE TEMP TABLE nl_merge ON COMMIT DROP AS
SELECT
  m.url,
  surv.id AS survivor_id,
  count(*) AS member_count,

  -- Does this group contain a live row? Equivalently: is the survivor live?
  bool_or(d.deleted_at IS NULL) AS group_has_live,

  -- Reporting only: how the group was composed before the merge.
  count(*) FILTER (WHERE d.deleted_at IS NULL)     AS live_members,
  count(*) FILTER (WHERE d.deleted_at IS NOT NULL) AS tombstoned_members,

  -- deleted_at: NULL when any row is live (live wins); otherwise the earliest
  -- tombstone in the group.
  CASE
    WHEN bool_or(d.deleted_at IS NULL) THEN NULL
    ELSE min(d.deleted_at)
  END AS merged_deleted_at,

  -- read_progress: max anywhere in the group (applied only to live survivors).
  max(d.read_progress) AS merged_read_progress,

  -- readState: did ANY copy finish? (applied only to live survivors)
  bool_or(d.metadata -> 'card' ->> 'readState' = 'finished') AS any_finished,

  -- location: survivor's, unless it is the untriaged default and someone else triaged.
  CASE
    WHEN surv.location <> 'inbox' THEN surv.location
    ELSE coalesce(
      (
        SELECT d2.location
        FROM nl_member m2
        JOIN documents d2 ON d2.id = m2.id
        WHERE m2.url = m.url
          AND d2.location <> 'inbox'
        ORDER BY d2.updated_at DESC NULLS LAST, d2.id DESC
        LIMIT 1
      ),
      surv.location
    )
  END AS merged_location,

  -- tags: union across the group, deduped + sorted for a stable result.
  coalesce(
    (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM nl_member m3
      JOIN documents d3 ON d3.id = m3.id
      CROSS JOIN LATERAL unnest(d3.tags) AS t
      WHERE m3.url = m.url
    ),
    '{}'::text[]
  ) AS merged_tags,

  -- note: survivor's if non-blank, else newest non-blank in the group (verbatim).
  CASE
    WHEN nullif(btrim(coalesce(surv.note, '')), '') IS NOT NULL THEN surv.note
    ELSE (
      SELECT d4.note
      FROM nl_member m4
      JOIN documents d4 ON d4.id = m4.id
      WHERE m4.url = m.url
        AND nullif(btrim(coalesce(d4.note, '')), '') IS NOT NULL
      ORDER BY d4.updated_at DESC NULLS LAST, d4.id DESC
      LIMIT 1
    )
  END AS merged_note,

  -- How many genuinely different non-blank notes exist here? >1 = review by hand.
  (
    SELECT count(DISTINCT btrim(d5.note))
    FROM nl_member m5
    JOIN documents d5 ON d5.id = m5.id
    WHERE m5.url = m.url
      AND nullif(btrim(coalesce(d5.note, '')), '') IS NOT NULL
  ) AS distinct_note_count,

  -- read_anchor: survivor's if non-blank, else the anchor of the furthest-read copy.
  CASE
    WHEN nullif(btrim(coalesce(surv.read_anchor, '')), '') IS NOT NULL THEN surv.read_anchor
    ELSE (
      SELECT d6.read_anchor
      FROM nl_member m6
      JOIN documents d6 ON d6.id = m6.id
      WHERE m6.url = m.url
        AND nullif(btrim(coalesce(d6.read_anchor, '')), '') IS NOT NULL
      ORDER BY d6.read_progress DESC, d6.updated_at DESC NULLS LAST, d6.id DESC
      LIMIT 1
    )
  END AS merged_read_anchor

FROM nl_member m
JOIN documents d ON d.id = m.id
JOIN nl_member sm ON sm.url = m.url AND sm.is_survivor
JOIN documents surv ON surv.id = sm.id
GROUP BY m.url, surv.id, surv.location, surv.note, surv.read_anchor;

CREATE UNIQUE INDEX ON nl_merge (url);
CREATE UNIQUE INDEX ON nl_merge (survivor_id);
ANALYZE nl_merge;

-- The rows that will be removed.
CREATE TEMP TABLE nl_loser ON COMMIT DROP AS
SELECT m.id, m.url, mg.survivor_id
FROM nl_member m
JOIN nl_merge mg ON mg.url = m.url
WHERE NOT m.is_survivor;

CREATE UNIQUE INDEX ON nl_loser (id);
ANALYZE nl_loser;

-- =============================================================================
-- ============================ DRY RUN REPORTS ================================
-- Everything below this banner up to "MUTATIONS" is read-only reporting.
-- =============================================================================

\echo ''
\echo '======================================================================'
\echo ' REPORT 1/9 - overall scope'
\echo ' (compare against the verified production shape in the header:'
\echo '  74 rows / 65 urls / 70 tombstoned / 4 live / 9 duplicate groups)'
\echo '======================================================================'
SELECT
  (SELECT sum(rows_before) FROM nl_url_before)                    AS scoped_rows_total,
  (SELECT count(*) FROM nl_url_before)                            AS distinct_newsletters,
  (SELECT sum(live_before) FROM nl_url_before)                    AS live_rows,
  (SELECT sum(rows_before) - sum(live_before) FROM nl_url_before) AS tombstoned_rows,
  (SELECT count(*) FROM nl_merge)                                 AS groups_with_duplicates,
  (SELECT count(*) FROM nl_member)                                AS rows_in_those_groups,
  (SELECT count(*) FROM nl_loser)                                 AS rows_to_be_deleted,
  (SELECT count(*) FROM nl_merge)                                 AS rows_to_survive;

\echo ''
\echo '======================================================================'
\echo ' REPORT 2/9 - group composition, and how "live wins" resolves each one'
\echo ' (expected: 4 mixed -> survivor LIVE, 5 fully tombstoned -> stays dead)'
\echo '======================================================================'
SELECT
  CASE
    WHEN NOT group_has_live     THEN 'fully tombstoned -> survivor stays tombstoned'
    WHEN tombstoned_members > 0 THEN 'mixed -> OLDEST LIVE row survives, tombstone discarded'
    ELSE                             'all live -> oldest live row survives'
  END AS resolution,
  count(*)              AS groups,
  sum(member_count)     AS rows_involved,
  sum(member_count - 1) AS rows_deleted
FROM nl_merge
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '======================================================================'
\echo ' REPORT 3/9 - !! SAFETY !! every mixed group, row by row'
\echo ' (survivor marked *. Confirm the * is on the LIVE row and that no live'
\echo '  newsletter is about to be tombstoned. This is the check that catches'
\echo '  the failure mode the previous merge rule had.)'
\echo '======================================================================'
SELECT
  CASE WHEN m.is_survivor THEN '*' ELSE ' ' END AS keep,
  d.id,
  CASE WHEN d.deleted_at IS NULL THEN 'live' ELSE 'tombstoned' END AS state_before,
  CASE WHEN m.is_survivor
       THEN CASE WHEN mg.merged_deleted_at IS NULL THEN 'live' ELSE 'tombstoned' END
       ELSE '(deleted by this script)'
  END AS state_after,
  left(coalesce(d.title, '(no title)'), 44) AS title,
  d.saved_at,
  d.deleted_at,
  right(d.url, 32) AS url_tail
FROM nl_merge mg
JOIN nl_member m ON m.url = mg.url
JOIN documents d ON d.id = m.id
WHERE mg.group_has_live AND mg.tombstoned_members > 0
ORDER BY mg.url, m.rn;

\echo ''
\echo '======================================================================'
\echo ' REPORT 4/9 - state actually being rescued from non-survivors'
\echo '======================================================================'
SELECT
  count(*) FILTER (WHERE mg.group_has_live AND mg.merged_read_progress > surv.read_progress)
    AS survivors_gaining_read_progress,
  count(*) FILTER (WHERE mg.group_has_live AND mg.any_finished
                     AND coalesce(surv.metadata -> 'card' ->> 'readState', '') <> 'finished')
    AS survivors_newly_marked_finished,
  count(*) FILTER (WHERE mg.merged_location <> surv.location)
    AS survivors_changing_location,
  count(*) FILTER (WHERE mg.merged_tags <> surv.tags)
    AS survivors_gaining_tags,
  count(*) FILTER (WHERE mg.merged_note IS DISTINCT FROM surv.note)
    AS survivors_adopting_a_note,
  count(*) FILTER (WHERE mg.merged_read_anchor IS DISTINCT FROM surv.read_anchor)
    AS survivors_adopting_an_anchor,
  count(*) FILTER (WHERE mg.merged_deleted_at IS DISTINCT FROM surv.deleted_at)
    AS survivors_changing_tombstone,
  -- MUST be 0. A live survivor is never flipped to deleted.
  count(*) FILTER (WHERE surv.deleted_at IS NULL AND mg.merged_deleted_at IS NOT NULL)
    AS live_survivors_being_tombstoned_must_be_0
FROM nl_merge mg
JOIN documents surv ON surv.id = mg.survivor_id;

\echo ''
\echo '======================================================================'
\echo ' REPORT 5/9 - !! MANUAL REVIEW !! groups with conflicting notes'
\echo ' (more than one distinct non-blank note; only ONE is kept, the rest are'
\echo '  lost with their rows. Empty result = nothing to worry about.)'
\echo '======================================================================'
SELECT mg.url, mg.distinct_note_count, mg.survivor_id, mg.merged_note AS note_being_kept
FROM nl_merge mg
WHERE mg.distinct_note_count > 1
ORDER BY mg.distinct_note_count DESC, mg.url
LIMIT 100;

\echo ''
\echo '======================================================================'
\echo ' REPORT 6/9 - child rows referencing a row about to be deleted'
\echo ' (see the MUTATIONS section for what happens to each table)'
\echo '======================================================================'
SELECT 'document_content'  AS child_table,
       count(*)            AS rows_on_losers,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM document_content c2 WHERE c2.document_id = l.survivor_id))
                           AS survivor_already_has_one_loser_dropped,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM document_content c2 WHERE c2.document_id = l.survivor_id))
                           AS candidates_to_move
FROM nl_loser l JOIN document_content c ON c.document_id = l.id
UNION ALL
SELECT 'podcast_episodes', count(*),
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM podcast_episodes p2 WHERE p2.document_id = l.survivor_id)),
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM podcast_episodes p2 WHERE p2.document_id = l.survivor_id))
FROM nl_loser l JOIN podcast_episodes p ON p.document_id = l.id
UNION ALL
SELECT 'document_accent', count(*),
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM document_accent a2 WHERE a2.document_id = l.survivor_id)),
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM document_accent a2 WHERE a2.document_id = l.survivor_id))
FROM nl_loser l JOIN document_accent a ON a.document_id = l.id
UNION ALL
SELECT 'rss_highlights', count(*), 0::bigint, count(*)
FROM nl_loser l JOIN rss_highlights h ON h.document_id = l.id
UNION ALL
SELECT 'tts_audio', count(*), 0::bigint, count(*)
FROM nl_loser l JOIN tts_audio t ON t.document_id = l.id;

\echo ''
\echo '======================================================================'
\echo ' REPORT 7/9 - merged state that will be written to each survivor'
\echo '======================================================================'
SELECT
  mg.survivor_id,
  mg.member_count,
  mg.live_members,
  mg.tombstoned_members,
  surv.location      AS location_before, mg.merged_location      AS location_after,
  surv.read_progress AS progress_before, mg.merged_read_progress AS progress_max_in_group,
  surv.metadata -> 'card' ->> 'readState' AS read_state_before,
  mg.any_finished    AS any_copy_finished,
  surv.tags          AS tags_before,     mg.merged_tags          AS tags_after,
  surv.deleted_at    AS deleted_before,  mg.merged_deleted_at    AS deleted_after
FROM nl_merge mg
JOIN documents surv ON surv.id = mg.survivor_id
ORDER BY mg.group_has_live DESC, mg.member_count DESC, mg.url;

-- =============================================================================
-- ============================== MUTATIONS ====================================
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Merge state onto the survivor.
--
--    Guard clauses worth knowing:
--      * jsonb_set on a NULL metadata returns NULL, and on a blob with no 'card'
--        key it would invent one. So readState is only rewritten when the card
--        key exists — a row with no card blob is unreadable to cardFromRow()
--        anyway (it returns null and the card is dropped).
--      * `deleted_at = mg.merged_deleted_at` is a no-op for live groups (both
--        sides NULL) and only ever writes a tombstone onto a survivor that was
--        already tombstoned. There is no live -> deleted transition in this
--        statement, by construction of merged_deleted_at.
--      * read_progress uses greatest() against the survivor's own value, so the
--        merge can only ever move progress forward.
-- -----------------------------------------------------------------------------
UPDATE documents d
SET
  deleted_at = mg.merged_deleted_at,

  read_progress = CASE
    WHEN mg.group_has_live THEN greatest(d.read_progress, mg.merged_read_progress)
    ELSE d.read_progress
  END,

  metadata = CASE
    WHEN mg.group_has_live
     AND mg.any_finished
     AND jsonb_exists(d.metadata, 'card')   -- function form, not `?`, so the file
                                            -- is safe to paste into clients that
                                            -- treat `?` as a bind placeholder
      THEN jsonb_set(d.metadata, '{card,readState}', to_jsonb('finished'::text), true)
    ELSE d.metadata
  END,

  location    = mg.merged_location,
  tags        = mg.merged_tags,
  note        = mg.merged_note,
  read_anchor = mg.merged_read_anchor,

  updated_at  = now()
FROM nl_merge mg
WHERE d.id = mg.survivor_id;

-- -----------------------------------------------------------------------------
-- 2. Deal with every table that keys off documents.id BEFORE deleting anything.
--
--    Grepped the schema (apps/bff/src/db/schema.ts) and the migrations
--    (apps/bff/drizzle/*.sql). Exactly ONE real foreign key exists:
--
--      document_content.document_id -> documents(id) ON DELETE CASCADE
--        (apps/bff/drizzle/0002_document_content.sql:6)
--
--    The other four are document-id-keyed by convention only, with NO FK
--    constraint, so deleting a document silently orphans them today. All five
--    are handled explicitly here.
--
--    Tables that do NOT reference documents.id and are therefore untouched:
--      ingestion_log      - keyed on (source, source_id) as free text; it is an
--                           append-only audit log and deliberately keeps its
--                           record of the bogus re-imports.
--      discovery_candidates / discovery_votes - keyed on url/candidate id, a
--                           separate namespace ('disc:<sha1>'), never a document id.
--      saved_views        - stores a QueryNode over fields, not document ids.
--      source_theme, backend_tokens, sync_cursors, app_settings,
--      push_subscriptions, feed_notification_prefs - no document linkage.
-- -----------------------------------------------------------------------------

-- 2a. document_content (REAL FK, ON DELETE CASCADE; PK = document_id).
--     The survivor keeps its own body if it has one. Otherwise we MOVE the
--     largest/freshest loser body onto the survivor. This matters more for
--     newsletters than for articles: the body was captured from the mailbox by
--     putContent (jobs.ts) and there is no real upstream URL to re-fetch, so a
--     dropped body is gone for good. Remaining loser bodies go via the cascade
--     in step 3. ON CONFLICT DO NOTHING makes this safe if run twice.
WITH pick AS (
  SELECT DISTINCT ON (l.survivor_id)
    l.survivor_id, c.html, c.char_count, c.fetched_at
  FROM nl_loser l
  JOIN document_content c ON c.document_id = l.id
  WHERE NOT EXISTS (SELECT 1 FROM document_content s WHERE s.document_id = l.survivor_id)
  ORDER BY l.survivor_id, c.char_count DESC, c.fetched_at DESC
)
INSERT INTO document_content (document_id, html, char_count, fetched_at)
SELECT survivor_id, html, char_count, fetched_at FROM pick
ON CONFLICT (document_id) DO NOTHING;

-- 2b. rss_highlights (no FK; PK = highlight id, document_id is a plain column).
--     RE-POINTED at the survivor. Highlights are user-authored content — the
--     most expensive thing to lose here — and there is no uniqueness constraint
--     on document_id, so every highlight from every copy can move.
UPDATE rss_highlights h
SET document_id = l.survivor_id
FROM nl_loser l
WHERE h.document_id = l.id;

-- 2c. tts_audio (no FK; PK = content_hash, document_id is a plain column).
--     RE-POINTED at the survivor. The cache is keyed by content hash, so
--     re-pointing cannot collide; keeping it avoids re-billing the TTS provider
--     for audio already synthesized. podcast_episodes joins it by content_hash,
--     so published episodes keep their bytes.
UPDATE tts_audio t
SET document_id = l.survivor_id
FROM nl_loser l
WHERE t.document_id = l.id;

-- 2d. podcast_episodes (no FK; PK = document_id, one episode per document).
--     If the survivor already has an episode it wins and the loser's row is
--     DELETED (step 2f) — the survivor's is what the feed has been serving.
--     Otherwise the newest loser episode is MOVED onto the survivor so the
--     published feed does not lose an entry. The row is a self-contained
--     snapshot, so moving it changes nothing the listener sees.
WITH pick AS (
  SELECT DISTINCT ON (l.survivor_id) l.survivor_id, p.*
  FROM nl_loser l
  JOIN podcast_episodes p ON p.document_id = l.id
  WHERE NOT EXISTS (SELECT 1 FROM podcast_episodes s WHERE s.document_id = l.survivor_id)
  ORDER BY l.survivor_id, p.added_at DESC, p.document_id
)
INSERT INTO podcast_episodes (
  document_id, content_hash, title, source_url, excerpt, cover_image,
  author, mime, byte_length, duration_seconds, added_at
)
SELECT
  survivor_id, content_hash, title, source_url, excerpt, cover_image,
  author, mime, byte_length, duration_seconds, added_at
FROM pick
ON CONFLICT (document_id) DO NOTHING;

-- 2e. document_accent (no FK; PK = document_id). Same shape as 2d, but this is a
--     derived cache, not user data: MOVED only if the survivor has no accent,
--     purely to skip a recompute. Anything left over is dropped in 2f.
WITH pick AS (
  SELECT DISTINCT ON (l.survivor_id) l.survivor_id, a.color, a.created_at
  FROM nl_loser l
  JOIN document_accent a ON a.document_id = l.id
  WHERE NOT EXISTS (SELECT 1 FROM document_accent s WHERE s.document_id = l.survivor_id)
  ORDER BY l.survivor_id, a.created_at DESC
)
INSERT INTO document_accent (document_id, color, created_at)
SELECT survivor_id, color, created_at FROM pick
ON CONFLICT (document_id) DO NOTHING;

-- 2f. Drop the child rows that could not be moved (survivor already had one) and
--     the ones we deliberately do not migrate. Done explicitly rather than left
--     to orphan, because only document_content has a cascading FK — without these
--     statements, podcast_episodes / document_accent / tts_audio rows would
--     linger forever pointing at a document id that no longer exists.
DELETE FROM podcast_episodes p USING nl_loser l WHERE p.document_id = l.id;
DELETE FROM document_accent  a USING nl_loser l WHERE a.document_id = l.id;
-- tts_audio and rss_highlights were fully re-pointed above; these are no-op
-- safety nets for any row a concurrent write slipped in mid-transaction.
DELETE FROM tts_audio      t USING nl_loser l WHERE t.document_id = l.id;
DELETE FROM rss_highlights h USING nl_loser l WHERE h.document_id = l.id;

-- -----------------------------------------------------------------------------
-- 3. Delete the non-survivors. document_content rows still attached to them go
--    with them via the ON DELETE CASCADE FK.
--    Re-asserting the scope predicate here is redundant (nl_loser was built from
--    it) but cheap, and means a hand-edited temp table still cannot reach outside
--    the newsletter set. nl_loser never contains a survivor, so no url can be
--    emptied by this statement — and the assertions below prove it rather than
--    assume it.
-- -----------------------------------------------------------------------------
DELETE FROM documents d
USING nl_loser l
WHERE d.id = l.id
  AND d.category = 'email'
  AND d.url LIKE 'https://newsletter.lectern.local/%';

-- =============================================================================
-- ======================== POST-CHECK ASSERTIONS ==============================
-- These RAISE EXCEPTION, which aborts the transaction. With ON_ERROR_STOP psql
-- exits non-zero and nothing is committed — including in the -v apply=true run.
-- =============================================================================
DO $assert$
DECLARE
  emptied_urls      bigint;
  still_duplicated  bigint;
  lost_live_urls    bigint;
  live_urls_before  bigint;
  live_rows_after   bigint;
  sample            text;
BEGIN
  -- A. THE LOAD-BEARING ONE. Every url that existed before must still have at
  --    least one row. A url with zero rows is no longer matched by findByUrl(),
  --    which would unblock re-ingestion of that newsletter from the mailbox and
  --    recreate the duplicate bug this script exists to clean up. See
  --    "TOMBSTONES ARE LOAD-BEARING" in the header.
  SELECT count(*), min(b.url) INTO emptied_urls, sample
  FROM nl_url_before b
  WHERE NOT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.url = b.url AND d.category = 'email'
  );
  IF emptied_urls > 0 THEN
    RAISE EXCEPTION
      'ABORT: % newsletter url(s) have no rows left (e.g. %). The re-import guard keys on url; emptying one lets the mailbox re-import it. Nothing has been committed.',
      emptied_urls, sample;
  END IF;

  -- B. Exactly one row per url: the whole point of the script.
  SELECT count(*), min(q.url) INTO still_duplicated, sample
  FROM (
    SELECT url FROM documents
    WHERE category = 'email' AND url LIKE 'https://newsletter.lectern.local/%'
    GROUP BY url HAVING count(*) > 1
  ) q;
  IF still_duplicated > 0 THEN
    RAISE EXCEPTION
      'ABORT: % url(s) still have duplicate rows after the merge (e.g. %). Nothing has been committed.',
      still_duplicated, sample;
  END IF;

  -- C. "Live wins", enforced rather than merely intended: every url that had a
  --    live row before must still have a live row after. This is the assertion
  --    that would have caught the previous merge rule emptying the library.
  SELECT count(*), min(b.url) INTO lost_live_urls, sample
  FROM nl_url_before b
  WHERE b.live_before > 0
    AND NOT EXISTS (
      SELECT 1 FROM documents d
      WHERE d.url = b.url AND d.category = 'email' AND d.deleted_at IS NULL
    );
  IF lost_live_urls > 0 THEN
    RAISE EXCEPTION
      'ABORT: % url(s) had a live row before and have none now (e.g. %). A live newsletter was tombstoned or deleted. Nothing has been committed.',
      lost_live_urls, sample;
  END IF;

  -- D. Live row count must equal the number of urls that had a live row. After
  --    dedupe there is one row per url, so this is the exact expected figure
  --    (production: 4). Implied by B and C, but it is cheap and states the
  --    invariant numerically.
  SELECT count(*) INTO live_urls_before FROM nl_url_before WHERE live_before > 0;
  SELECT count(*) INTO live_rows_after
  FROM documents
  WHERE category = 'email'
    AND url LIKE 'https://newsletter.lectern.local/%'
    AND deleted_at IS NULL;
  IF live_rows_after <> live_urls_before THEN
    RAISE EXCEPTION
      'ABORT: expected % live newsletter row(s) after dedupe, found %. Nothing has been committed.',
      live_urls_before, live_rows_after;
  END IF;

  RAISE NOTICE 'Post-check assertions passed: no url emptied, no duplicates left, % live newsletter(s) preserved.',
    live_rows_after;
END
$assert$;

\echo ''
\echo '======================================================================'
\echo ' REPORT 8/9 - AFTER state (still inside the transaction)'
\echo ' duplicate_groups_remaining MUST be 0; urls_emptied MUST be 0;'
\echo ' live_rows_now MUST equal live_urls_before (expected 4)'
\echo '======================================================================'
SELECT
  (SELECT count(*) FROM documents
    WHERE category = 'email' AND url LIKE 'https://newsletter.lectern.local/%')
    AS scoped_rows_now,
  (SELECT count(DISTINCT url) FROM documents
    WHERE category = 'email' AND url LIKE 'https://newsletter.lectern.local/%')
    AS distinct_newsletters_now,
  (SELECT count(*) FROM nl_url_before)                       AS distinct_newsletters_before,
  (SELECT count(*) FROM nl_url_before WHERE live_before > 0) AS live_urls_before,
  (SELECT count(*) FROM documents
    WHERE category = 'email' AND url LIKE 'https://newsletter.lectern.local/%'
      AND deleted_at IS NULL)                                AS live_rows_now,
  (SELECT count(*) FROM documents
    WHERE category = 'email' AND url LIKE 'https://newsletter.lectern.local/%'
      AND deleted_at IS NOT NULL)                            AS tombstoned_now,
  (SELECT count(*) FROM (
     SELECT url FROM documents
     WHERE category = 'email' AND url LIKE 'https://newsletter.lectern.local/%'
     GROUP BY url HAVING count(*) > 1
   ) q)                                                      AS duplicate_groups_remaining,
  (SELECT count(*) FROM nl_url_before b
     WHERE NOT EXISTS (SELECT 1 FROM documents d
                       WHERE d.url = b.url AND d.category = 'email'))
                                                             AS urls_emptied;

\echo ''
\echo '======================================================================'
\echo ' REPORT 9/9 - orphaned child rows anywhere in the DB (all MUST be 0)'
\echo '======================================================================'
SELECT
  (SELECT count(*) FROM rss_highlights   x WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = x.document_id)) AS orphan_rss_highlights,
  (SELECT count(*) FROM tts_audio        x WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = x.document_id)) AS orphan_tts_audio,
  (SELECT count(*) FROM podcast_episodes x WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = x.document_id)) AS orphan_podcast_episodes,
  (SELECT count(*) FROM document_accent  x WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = x.document_id)) AS orphan_document_accent,
  (SELECT count(*) FROM document_content x WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = x.document_id)) AS orphan_document_content;

-- =============================================================================
-- COMMIT or ROLLBACK
-- =============================================================================
\if :apply
  \echo ''
  \echo '>>> apply=true - COMMITTING.'
  COMMIT;
\else
  \echo ''
  \echo '>>> DRY RUN (default) - ROLLING BACK. Nothing was changed.'
  \echo '>>> Re-run with  -v apply=true  to commit, AFTER taking a pg_dump.'
  ROLLBACK;
\endif
