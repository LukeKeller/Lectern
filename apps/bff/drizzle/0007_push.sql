-- Web Push notifications: browser push subscriptions (one row per browser/device,
-- keyed by endpoint so re-subscribing upserts) and per-feed notification prefs
-- (feed_id is the stringified MiniFlux feed id, matching GET /feeds). The poll
-- job fires one batched push per feed per run when genuinely-new entries land.
-- Idempotent (re-run on every upgrade).
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "feed_notification_prefs" (
	"feed_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
