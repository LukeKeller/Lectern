import { describe, expect, it } from 'vitest';
import { buildBookmarklet } from './bookmarklet';

const PREFIX = 'javascript:';

function decode(url: string): string {
	return decodeURIComponent(url.slice(PREFIX.length));
}

describe('buildBookmarklet', () => {
	const apiUrl = 'https://api.example.com/api/v1';
	const token = 'secret/token+=value';

	it('produces a javascript: URL', () => {
		expect(buildBookmarklet(apiUrl, token).startsWith(PREFIX)).toBe(true);
	});

	it('embeds the documents endpoint, token, and SaveDocumentRequest body', () => {
		const decoded = decode(buildBookmarklet(apiUrl, token));
		expect(decoded).toContain('https://api.example.com/api/v1/documents');
		expect(decoded).toContain(token);
		expect(decoded).toContain("'Bearer '");
		expect(decoded).toContain('url:location.href');
		expect(decoded).toContain("location:'later'");
		expect(decoded).toContain('tags:[]');
	});

	it('URL-encodes the body so the href carries no raw spaces or quotes-as-delimiters', () => {
		const url = buildBookmarklet(apiUrl, token);
		// Everything after the scheme is percent-encoded.
		expect(url.slice(PREFIX.length)).not.toContain(' ');
		// And it round-trips back to executable source.
		expect(decode(url)).toContain('fetch(');
	});

	it('normalizes a trailing slash on the api url', () => {
		const decoded = decode(buildBookmarklet('https://api.example.com/api/v1/', token));
		expect(decoded).toContain('https://api.example.com/api/v1/documents');
		expect(decoded).not.toContain('v1//documents');
	});
});
