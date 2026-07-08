-- Content discovery: candidates found on the open web, up/down vote signals, the
-- persisted Rocchio interest profile, and per-run progress records. All BFF-owned;
-- the discovery worker writes them only via the API. Idempotent.
CREATE TABLE IF NOT EXISTS "discovery_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"url_normalized" text NOT NULL,
	"title" text,
	"excerpt" text,
	"fetcher" text NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"term_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"vote" text,
	"run_id" text,
	"metadata" jsonb,
	"first_seen_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_candidates_url_normalized_key" UNIQUE("url_normalized")
);

CREATE TABLE IF NOT EXISTS "discovery_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"value" text NOT NULL,
	"term_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "discovery_profile" (
	"name" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idf" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"seeded_at" timestamptz,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"last_vote_processed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "discovery_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"stage" text DEFAULT 'starting' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"finished_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "discovery_candidates_status_idx" ON "discovery_candidates" ("status");
CREATE INDEX IF NOT EXISTS "discovery_votes_processed_idx" ON "discovery_votes" ("processed");
CREATE INDEX IF NOT EXISTS "discovery_runs_started_at_idx" ON "discovery_runs" ("started_at");
