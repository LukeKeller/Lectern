import { z } from "zod";

/**
 * Web Push (browser notifications). Single-user app: the BFF stores browser push
 * subscriptions and per-feed notification preferences, and fires one batched push
 * per feed per poll when genuinely-new entries land. The VAPID public key is
 * exposed so the SPA can subscribe; the private key never leaves the server.
 */

/** The server's VAPID public key, or null when push is disabled/unconfigured. */
export const PushPublicKeyResponse = z.object({ publicKey: z.string().nullable() });
export type PushPublicKeyResponse = z.infer<typeof PushPublicKeyResponse>;

/** A browser PushSubscription serialized for the server (upserted by endpoint). */
export const PushSubscriptionRequest = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequest>;

/** Remove a stored subscription by its endpoint. */
export const PushUnsubscribeRequest = z.object({ endpoint: z.string().url() });
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequest>;

/** Generic success acknowledgement for subscribe/unsubscribe. */
export const PushOkResponse = z.object({ ok: z.literal(true) });
export type PushOkResponse = z.infer<typeof PushOkResponse>;

/** Whether notifications are enabled for a single feed. */
export const FeedNotificationPref = z.object({ feedId: z.string(), enabled: z.boolean() });
export type FeedNotificationPref = z.infer<typeof FeedNotificationPref>;

/** All stored per-feed notification preferences. */
export const FeedNotificationPrefsResponse = z.object({
  feeds: z.array(FeedNotificationPref),
});
export type FeedNotificationPrefsResponse = z.infer<typeof FeedNotificationPrefsResponse>;

/** Toggle notifications for the feed named in the route. */
export const SetFeedNotificationRequest = z.object({ enabled: z.boolean() });
export type SetFeedNotificationRequest = z.infer<typeof SetFeedNotificationRequest>;
