// Share-target landing. Purely client-side: the installed PWA receives the
// shared URL as query params (manifest share_target, method GET) and saves it
// from the browser, so there is nothing to prerender or render on the server.
export const prerender = false;
export const ssr = false;
