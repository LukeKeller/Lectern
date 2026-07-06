import { describe, expect, it } from 'vitest';
import { buildBookmarklet } from './bookmarklet';

const PREFIX = 'javascript:';

function decode(url: string): string {
	return decodeURIComponent(url.slice(PREFIX.length));
}

describe('buildBookmarklet', () => {
	const origin = 'https://lectern.example.com';

	it('produces a javascript: URL', () => {
		expect(buildBookmarklet(origin).startsWith(PREFIX)).toBe(true);
	});

	it('opens the share-target page in a new tab with the current page url', () => {
		const decoded = decode(buildBookmarklet(origin));
		expect(decoded).toContain('window.open');
		expect(decoded).toContain('/share-target?url=');
		expect(decoded).toContain('encodeURIComponent(location.href)');
		expect(decoded).toContain(origin);
	});

	it('strips a trailing slash on the origin so the path has no double slash', () => {
		const decoded = decode(buildBookmarklet('https://lectern.example.com/'));
		// The trailing slash is stripped so the base + '/share-target' has no double slash.
		expect(decoded).toContain('"https://lectern.example.com"');
		expect(decoded).not.toContain('//share-target');
		expect(decoded).not.toContain('.com/"');
	});

	it('URL-encodes the source so the href carries no raw spaces', () => {
		const url = buildBookmarklet(origin);
		expect(url.slice(PREFIX.length)).not.toContain(' ');
		// And it round-trips back to executable source.
		expect(decode(url)).toContain('window.open(');
	});
});
