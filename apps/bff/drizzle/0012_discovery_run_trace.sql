-- Deep forensic trace for a discovery run: the exact queries, each searcher's
-- raw results, the crawler's robots/host/rejection internals, and the
-- per-candidate scoring funnel. Written once at run end so the run-detail view
-- can show what the crawler and searchers actually did. Idempotent.
ALTER TABLE "discovery_runs" ADD COLUMN IF NOT EXISTS "trace" jsonb;
