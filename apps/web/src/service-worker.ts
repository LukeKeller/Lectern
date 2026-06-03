/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `lectern-cache-${version}`;
// App shell: SvelteKit's built JS/CSS plus everything in static/.
const PRECACHE = [...build, ...files];
const PRECACHE_SET: Record<string, true> = Object.fromEntries(PRECACHE.map((p) => [p, true]));

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

/** Cache-first for precached shell assets. */
async function fromCache(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	return cached ?? fetch(request);
}

/** Network-first with cache fallback for article/content GETs. */
async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
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
	const url = new URL(request.url);

	if (url.origin === sw.location.origin && PRECACHE_SET[url.pathname]) {
		event.respondWith(fromCache(request));
		return;
	}
	if (isContentRequest(url)) {
		event.respondWith(networkFirst(request));
	}
});
