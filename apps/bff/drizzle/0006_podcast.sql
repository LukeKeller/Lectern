-- Podcast feed: published episodes (one saved article rendered to audio, exposed
-- through the tokenized RSS feed). A self-contained snapshot of the source card
-- so the feed survives the document being un-saved or re-voiced; the audio bytes
-- live in tts_audio, joined by content_hash. The feed token itself lives in
-- app_settings under key 'podcast'. Idempotent (re-run on every upgrade).
CREATE TABLE IF NOT EXISTS "podcast_episodes" (
	"document_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"excerpt" text,
	"cover_image" text,
	"author" text,
	"mime" text NOT NULL,
	"byte_length" integer NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"added_at" timestamptz DEFAULT now() NOT NULL
);
