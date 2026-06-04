ALTER TABLE "saved_views" ADD COLUMN IF NOT EXISTS "icon" text;
ALTER TABLE "saved_views" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
