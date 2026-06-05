import webpush from "web-push";
import { eq } from "drizzle-orm";
import { config, pushEnabled } from "./config";
import { db } from "./db/client";
import { feedNotificationPrefs, pushSubscriptions } from "./db/schema";
import type { FeedNotificationPrefRow, PushSubscriptionRow } from "./db/schema";

/**
 * Web Push delivery + storage. Browser push subscriptions and per-feed
 * notification preferences live in the glue DB; the poll job (jobs.ts) tallies
 * genuinely-new entries per flagged feed and fires one batched push per feed via
 * `sendPush`. Everything no-ops when push is disabled (so there is zero behavior
 * change when the VAPID keys aren't configured).
 */

let configured = false;

/**
 * Lazily wire web-push with the VAPID details from config. Idempotent; safe to
 * call before every send. Returns false (and configures nothing) when push is
 * disabled or unconfigured.
 */
function ensureConfigured(): boolean {
  if (!pushEnabled()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      config.LECTERN_VAPID_SUBJECT,
      config.LECTERN_VAPID_PUBLIC_KEY,
      config.LECTERN_VAPID_PRIVATE_KEY,
    );
    configured = true;
  }
  return true;
}

/** The VAPID public key the SPA needs to subscribe, or null when push is off. */
export function publicVapidKey(): string | null {
  return pushEnabled() ? config.LECTERN_VAPID_PUBLIC_KEY : null;
}

// --- subscription storage ---------------------------------------------------

export async function listSubscriptions(): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions);
}

/** Upsert a browser subscription by endpoint (re-subscribe refreshes its keys). */
export async function upsertSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.p256dh, auth: sub.auth },
    });
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

// --- per-feed notification preferences --------------------------------------

export async function listFeedPrefs(): Promise<FeedNotificationPrefRow[]> {
  return db.select().from(feedNotificationPrefs);
}

/** Upsert a feed's notification preference, returning the stored value. */
export async function setFeedPref(
  feedId: string,
  enabled: boolean,
): Promise<{ feedId: string; enabled: boolean }> {
  await db
    .insert(feedNotificationPrefs)
    .values({ feedId, enabled })
    .onConflictDoUpdate({ target: feedNotificationPrefs.feedId, set: { enabled } });
  return { feedId, enabled };
}

/** Whether a feed is flagged for notifications. Default ON when no row exists. */
export async function getFeedPref(feedId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(feedNotificationPrefs)
    .where(eq(feedNotificationPrefs.feedId, feedId));
  return row ? row.enabled : true;
}

// --- delivery ---------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Send one notification to every stored subscription. No-op when push is
 * disabled or there are no subscriptions. A 404/410 (expired/gone endpoint)
 * prunes that subscription; any other per-subscription error is logged and
 * swallowed so one bad endpoint never aborts the rest of the fan-out.
 */
export async function sendPush(payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await listSubscriptions();
  if (subs.length === 0) return;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (err) {
        const status =
          typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (status === 404 || status === 410) {
          await deleteSubscription(sub.endpoint);
        } else {
          console.warn(`[push] send failed for ${sub.endpoint}:`, err);
        }
      }
    }),
  );
}
