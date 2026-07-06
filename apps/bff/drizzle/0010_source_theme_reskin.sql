-- Source ("dress") theming, full re-skin: extend the per-host cache with the
-- tokens needed to dress the whole reading column after each publication —
-- background (light + dark), body text colour, link colour, and a body font —
-- plus a `derivation` marker recording whether the palette was read literally
-- from the source's own CSS or synthesized from its brand accent when the CSS
-- was unreadable. NOT NULL with '' defaults, matching the existing
-- "empty string = checked, none" convention. Idempotent (re-run on every upgrade).
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "background" text DEFAULT '' NOT NULL;
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "background_dark" text DEFAULT '' NOT NULL;
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "text" text DEFAULT '' NOT NULL;
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "link" text DEFAULT '' NOT NULL;
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "body_font" text DEFAULT '' NOT NULL;
ALTER TABLE "source_theme" ADD COLUMN IF NOT EXISTS "derivation" text DEFAULT '' NOT NULL;
