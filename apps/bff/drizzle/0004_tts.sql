-- Text-to-speech ("Listen"): server-side settings (ElevenLabs key + voice/model)
-- and a content-hash-keyed audio cache so re-listens never re-bill. Idempotent.
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tts_audio" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"mime" text NOT NULL,
	"audio_base64" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
