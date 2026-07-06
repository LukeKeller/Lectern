/**
 * Build a `javascript:` bookmarklet that saves the current page to Lectern.
 *
 * Clicking the bookmarklet opens Lectern's own share-target page in a new tab
 * (`<appOrigin>/share-target?url=<current page>`). That page runs inside the
 * already-authenticated Lectern session, so the save happens same-origin using
 * the existing cookie/session — no bearer token is embedded and there is no
 * cross-origin `fetch`, CORS, or SSO to trip over. Because the link carries NO
 * secret, it is safe to keep on the bookmarks bar or share.
 *
 * The script body is URL-encoded so it survives being used as an `href` (spaces,
 * quotes, and reserved characters are escaped); browsers decode the `javascript:`
 * URI before executing it.
 */
export function buildBookmarklet(appOrigin: string): string {
	// Strip any trailing slashes so we don't produce `//share-target`.
	const base = appOrigin.replace(/\/+$/, '');
	const source =
		`(function(){` +
		`window.open(${JSON.stringify(base)}+'/share-target?url='+encodeURIComponent(location.href),'_blank','noopener')` +
		`})();`;
	return `javascript:${encodeURIComponent(source)}`;
}
