-- Adaptive reader accent: a per-document accent colour derived server-side from
-- the article's cover image (dominant, contrast-clamped). Kept in its own table
-- so it survives backend re-ingest (the documents row is rebuilt from the
-- backends each sync). Computed lazily on first read and cached here. The
-- `color` is null-row-absent: a row exists only once computed; a row with
-- color='' records "checked, no usable colour" so we don't refetch every open.
-- Idempotent.
CREATE TABLE IF NOT EXISTS "document_accent" (
	"document_id" text PRIMARY KEY NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
