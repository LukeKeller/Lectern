import { browser } from '$app/environment';
import { getClient } from '$lib/config';

/**
 * Web Push helpers for the installed PWA (target: Android Chrome). The custom
 * service worker (src/service-worker.ts) handles `push`/`notificationclick`;
 * SvelteKit registers that worker automatically in production builds. Everything
 * here goes through `navigator.serviceWorker.ready`, so it works regardless of
 * how/when the registration happened (in `vite dev` the worker may be absent —
 * the calls reject and the UI surfaces that gracefully).
 */

/**
 * Standard VAPID conversion: URL-safe base64 server key -> bytes. Returns a
 * Uint8Array backed by a plain ArrayBuffer (not SharedArrayBuffer) so it
 * satisfies `applicationServerKey: BufferSource`.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const output = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
	return output;
}

/** ArrayBuffer -> URL-safe base64 (no padding), for the subscription keys. */
function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
	if (!buffer) return '';
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True only when the browser has the full service worker + push + notification stack. */
export function isPushSupported(): boolean {
	return (
		browser && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
	);
}

/** Current Notification permission ('default' | 'granted' | 'denied'). */
export function getPermission(): NotificationPermission {
	if (!browser || !('Notification' in window)) return 'default';
	return Notification.permission;
}

/** Whether this device currently has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
	if (!isPushSupported()) return false;
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	return sub !== null;
}

/**
 * Enable push on this device: prompt for permission, fetch the server VAPID key,
 * subscribe, and register the subscription with the backend. Returns true on
 * success. Throws on a real error; returns false when permission is denied or
 * push isn't configured server-side (publicKey null).
 */
export async function enablePush(): Promise<boolean> {
	if (!isPushSupported()) throw new Error('Push is not supported on this device.');

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return false;

	const { publicKey } = await getClient().getPushPublicKey();
	if (!publicKey) return false;

	const reg = await navigator.serviceWorker.ready;
	const sub =
		(await reg.pushManager.getSubscription()) ??
		(await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey)
		}));

	await getClient().registerPushSubscription({
		endpoint: sub.endpoint,
		keys: {
			p256dh: arrayBufferToBase64Url(sub.getKey('p256dh')),
			auth: arrayBufferToBase64Url(sub.getKey('auth'))
		}
	});
	return true;
}

/** Disable push on this device: deregister with the backend, then unsubscribe. */
export async function disablePush(): Promise<void> {
	if (!isPushSupported()) return;
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;
	try {
		await getClient().unregisterPushSubscription({ endpoint: sub.endpoint });
	} finally {
		// Always drop the browser-side subscription even if the server call fails,
		// so the toggle reflects the local state the user just asked for.
		await sub.unsubscribe();
	}
}
