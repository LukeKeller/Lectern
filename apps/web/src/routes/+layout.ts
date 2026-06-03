// Lectern is an offline-first PWA: the app shell renders on the client and reads
// from IndexedDB, so server-side rendering is disabled. Server endpoints (e.g.
// the Web Share Target) are unaffected by this.
export const ssr = false;

// Resolve the API token (SSO-gated /bootstrap) before any page load runs, so the
// first data fetch is authenticated.
export const load = async () => {
	const { bootstrapToken } = await import('$lib/config');
	await bootstrapToken();
	return {};
};
