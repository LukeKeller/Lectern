/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Per-deploy cache names. `version` comes from kit.version (changes every build),
// so a new release produces new cache names and the activate handler evicts the
// old ones — installed PWAs refresh on deploy with no hand-maintained constant.
const SHELL = `lectern-shell-${version}`;
const IMAGES = `lectern-images-${version}`;
const KEEP = new Set([SHELL, IMAGES]);

// The SPA fallback document. adapter-static writes index.html and the BFF serves
// it for any in-scope path; precaching it is what lets a *cold* offline launch
// of the installed app boot (the in-page router then takes over). It is not in
// `build`/`files`/`prerendered`, so we add it explicitly.
const SHELL_URL = `${base}/`;

// App shell: SvelteKit's hashed JS/CSS, everything in static/, any prerendered
// pages, plus the SPA fallback document.
const PRECACHE = [...build, ...files, ...prerendered, SHELL_URL];
const PRECACHE_SET = new Set(PRECACHE.map((p) => new URL(p, sw.location.origin).pathname));

// Opaque (cross-origin) image responses can each occupy several MB of quota in
// Chromium, so keep the article-image cache modest and evict FIFO.
const MAX_IMAGES = 150;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(SHELL).then((cache) =>
			// Individual adds (allSettled) so a single 404 doesn't abort the install.
			Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
		)
		// Intentionally no skipWaiting() here — the page handshakes the upgrade so a
		// reader is never reloaded out from under an open article (see UpdatePrompt).
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Parallelise SW boot with the navigation fetch on first load.
			if (sw.registration.navigationPreload) {
				try {
					await sw.registration.navigationPreload.enable();
				} catch {
					/* not supported — ignore */
				}
			}
			for (const key of await caches.keys()) {
				if (!KEEP.has(key)) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

// The page posts SKIP_WAITING when the user accepts the "new version" prompt.
sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') sw.skipWaiting();
});

/** Cache-first for precached shell assets (hashed URLs — safe to serve forever). */
async function fromCache(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	return cached ?? fetch(request);
}

/** FIFO trim so the image cache stays under `max` entries. */
async function trimCache(name: string, max: number): Promise<void> {
	const cache = await caches.open(name);
	const keys = await cache.keys();
	for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/**
 * NetworkFirst for top-level navigations: serve fresh HTML when online, fall back
 * to the cached SPA shell offline so an installed cold launch still boots.
 */
async function navigate(event: FetchEvent): Promise<Response> {
	try {
		const preload = (await event.preloadResponse) as Response | undefined;
		if (preload) return preload;
		return await fetch(event.request);
	} catch {
		const cache = await caches.open(SHELL);
		const shell = (await cache.match(SHELL_URL)) ?? (await cache.match(event.request));
		if (shell) return shell;
		return Response.error();
	}
}

/** CacheFirst with an LRU cap for images, including cross-origin covers/posters. */
async function cacheFirstImage(request: Request): Promise<Response> {
	const cache = await caches.open(IMAGES);
	const cached = await cache.match(request);
	if (cached) return cached;
	// A network failure here propagates to the browser, which renders its own
	// broken-image state — fine for a missing cover, and we have no cached copy.
	const response = await fetch(request);
	// Allow opaque responses (cross-origin images without CORS) into the cache.
	if (response.ok || response.type === 'opaque') {
		cache.put(request, response.clone()).then(() => trimCache(IMAGES, MAX_IMAGES));
	}
	return response;
}

/** NetworkFirst with cache fallback for article/content GETs. */
async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(SHELL);
	try {
		const response = await fetch(request);
		if (response.ok) cache.put(request, response.clone());
		return response;
	} catch (err) {
		const cached = await cache.match(request);
		if (cached) return cached;
		throw err;
	}
}

function isContentRequest(url: URL): boolean {
	return (
		(url.pathname.includes('/documents/') && url.pathname.endsWith('/content')) ||
		url.pathname.endsWith('/article')
	);
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	// Top-level navigations get the offline-aware SPA-shell path.
	if (request.mode === 'navigate') {
		event.respondWith(navigate(event));
		return;
	}

	const url = new URL(request.url);

	// Article images and remote covers: cache-first, capped.
	if (request.destination === 'image') {
		event.respondWith(cacheFirstImage(request));
		return;
	}

	// Same-origin precached shell assets.
	if (url.origin === sw.location.origin && PRECACHE_SET.has(url.pathname)) {
		event.respondWith(fromCache(request));
		return;
	}

	// Article/content GETs stay readable offline.
	if (isContentRequest(url)) {
		event.respondWith(networkFirst(request));
	}
	// Everything else (API list/mutation traffic, auth) falls through to the
	// network untouched — never cache mutations or auth responses.
});
