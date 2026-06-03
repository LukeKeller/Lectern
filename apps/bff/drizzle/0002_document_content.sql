-- Owned full text: one row per document whose article HTML we've captured.
-- Kept in a side table (not on `documents`) so the hot index stays body-free;
-- list/sync read `documents.*` and must not drag multi-KB bodies. Idempotent so
-- it re-runs safely on every install/upgrade.
CREATE TABLE IF NOT EXISTS "document_content" (
	"document_id" text PRIMARY KEY NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
	"html" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Full-text vector over the tag-stripped body, capped at 1MB (to_tsvector's
	-- input limit). Generated + STORED: no triggers, recomputed only when html
	-- changes. The 'english' config is a literal so the expression is IMMUTABLE.
	"body_tsv" tsvector GENERATED ALWAYS AS (
		to_tsvector('english', left(regexp_replace("html", '<[^>]+>', ' ', 'g'), 1000000))
	) STORED
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_content_body_tsv_idx" ON "document_content" USING gin ("body_tsv");
