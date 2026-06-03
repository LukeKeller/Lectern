import { describe, expect, it } from 'vitest';
import { readOpmlFile } from './opml';

describe('readOpmlFile', () => {
	it('returns the trimmed file contents', async () => {
		const file = new File(['  <opml version="2.0"></opml>\n'], 'feeds.opml', { type: 'text/xml' });
		expect(await readOpmlFile(file)).toBe('<opml version="2.0"></opml>');
	});

	it('rejects a blank file', async () => {
		const file = new File(['   \n\t'], 'empty.opml');
		await expect(readOpmlFile(file)).rejects.toThrow(/empty/i);
	});
});
