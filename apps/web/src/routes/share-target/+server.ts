import { redirect } from '@sveltejs/kit';
import { getClient } from '$lib/config';
import type { RequestHandler } from './$types';

/**
 * Web Share Target endpoint. Android/desktop share sheets POST the shared
 * payload here (see the `share_target` in manifest.webmanifest). We extract a
 * URL, save it as a document, then redirect back to the inbox.
 */

const URL_RE = /https?:\/\/[^\s]+/;

function field(form: FormData, key: string): string | undefined {
	const value = form.get(key);
	return typeof value === 'string' ? value : undefined;
}

function firstUrl(...candidates: (string | undefined)[]): string | undefined {
	for (const c of candidates) {
		const match = c?.match(URL_RE);
		if (match) return match[0];
	}
	return undefined;
}

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const url = firstUrl(field(form, 'url'), field(form, 'text'), field(form, 'title'));

	if (url) {
		await getClient().saveDocument({
			url,
			title: field(form, 'title'),
			tags: [],
			location: 'inbox'
		});
	}

	throw redirect(303, '/');
};
