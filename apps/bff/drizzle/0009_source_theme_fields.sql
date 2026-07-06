-- Source ("dress") theming: extend the per-host cache with two more tokens drawn
-- from the publication's <head> — a dark-mode brand accent (the media-scoped
-- `theme-color`, which the reader can use under dark themes) and the site's own
-- name (og:site_name / application-name / <title>) for a cleaner masthead label
-- than the raw hostname. NOT NULL with '' defaults, matching the existing
-- "empty string = checked, none" convention. Idempotent (re-run on every upgrade).
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "accent_dark" text DEFAULT '' NOT NULL;
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "site_name" text DEFAULT '' NOT NULL;
