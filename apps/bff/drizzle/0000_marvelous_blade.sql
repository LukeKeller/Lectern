CREATE TABLE IF NOT EXISTS "backend_tokens" (
	"source" text PRIMARY KEY NOT NULL,
	"base_url" text,
	"token" text,
	"basic" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"category" text NOT NULL,
	"location" text NOT NULL,
	"read_progress" real DEFAULT 0 NOT NULL,
	"read_anchor" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"title" text,
	"url" text,
	"metadata" jsonb,
	"saved_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "documents_source_source_id_key" UNIQUE("source","source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingestion_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"source_id" text,
	"status" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rss_highlights" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"color" text DEFAULT 'yellow' NOT NULL,
	"start_selector" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_selector" text NOT NULL,
	"end_offset" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"query" jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"sort_by" text DEFAULT 'savedAt' NOT NULL,
	"sort_dir" text DEFAULT 'desc' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_cursors" (
	"source" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
