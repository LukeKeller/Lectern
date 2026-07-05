-- Source ("dress") theming: a small set of tokens extracted from a publication's
-- site <head> — brand accent, favicon, and an optional Google-hosted display
-- font — keyed by host so every article from a source shares one row. Computed
-- lazily on first read and cached here; a manual refresh re-fetches. Columns are
-- NOT NULL with '' defaults: an empty string records "checked, none" while a
-- missing row means "never fetched", so the lazy compute doesn't re-run on every
-- open. Idempotent (re-run on every upgrade).
CREATE TABLE IF NOT EXISTS "source_theme" (
	"host" text PRIMARY KEY NOT NULL,
	"accent" text DEFAULT '' NOT NULL,
	"favicon_url" text DEFAULT '' NOT NULL,
	"display_font" text DEFAULT '' NOT NULL,
	"fetched_at" timestamptz DEFAULT now() NOT NULL
);
