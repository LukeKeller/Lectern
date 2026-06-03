/**
 * Build a `javascript:` bookmarklet that saves the current page to Lectern.
 *
 * The bookmarklet POSTs the active tab's `location.href` to `<apiUrl>/documents`
 * as a `SaveDocumentRequest` body, authenticated with the personal bearer
 * `token`. The token is embedded verbatim, so the resulting link is sensitive
 * and must not be shared.
 *
 * The script body is URL-encoded so it survives being used as an `href` (spaces,
 * quotes, and reserved characters are escaped); browsers decode the `javascript:`
 * URI before executing it.
 */
export function buildBookmarklet(apiUrl: string, token: string): string {
	const endpoint = `${apiUrl.replace(/\/+$/, '')}/documents`;
	// Body shape matches SaveDocumentRequest; `url` is resolved at click time.
	const source =
		`(function(){` +
		`fetch(${JSON.stringify(endpoint)},{` +
		`method:'POST',` +
		`headers:{'Content-Type':'application/json','Authorization':'Bearer '+${JSON.stringify(token)}},` +
		`body:JSON.stringify({url:location.href,tags:[],location:'later'})` +
		`}).then(function(r){alert(r.ok?'Saved to Lectern':'Lectern save failed: '+r.status)})` +
		`.catch(function(e){alert('Lectern save failed: '+e)})` +
		`})();`;
	return `javascript:${encodeURIComponent(source)}`;
}
