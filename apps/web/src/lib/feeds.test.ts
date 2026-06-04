import { describe, expect, it } from 'vitest';
import { Feed, FeedFolder } from '@lectern/shared';
import { feedGroupKey, groupFeeds } from './feeds';

function feed(overrides: Partial<Feed> & { id: string }): Feed {
	return Feed.parse({
		title: `Feed ${overrides.id}`,
		feedUrl: `https://example.com/${overrides.id}.xml`,
		...overrides
	});
}

function folder(id: string, title: string): FeedFolder {
	return FeedFolder.parse({ id, title });
}

describe('groupFeeds', () => {
	it('buckets feeds under their folder and drops empty folders', () => {
		const feeds = [
			feed({ id: 'a', folderId: 'tech', folderTitle: 'Tech' }),
			feed({ id: 'b', folderId: 'tech', folderTitle: 'Tech' })
		];
		const folders = [folder('tech', 'Tech'), folder('empty', 'Empty')];
		const groups = groupFeeds(feeds, folders);
		expect(groups.map((g) => g.title)).toEqual(['Tech']);
		expect(groups[0]!.feeds.map((f) => f.id)).toEqual(['a', 'b']);
	});

	it('surfaces a folder referenced by a feed but missing from the folder list', () => {
		const feeds = [feed({ id: 'a', folderId: 'orphan', folderTitle: 'Orphan' })];
		const groups = groupFeeds(feeds, []);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.id).toBe('orphan');
		expect(groups[0]!.title).toBe('Orphan');
	});

	it('collects loose feeds into a trailing Uncategorized group', () => {
		const feeds = [feed({ id: 'a', folderId: 'tech', folderTitle: 'Tech' }), feed({ id: 'loose' })];
		const groups = groupFeeds(feeds, [folder('tech', 'Tech')]);
		expect(groups.at(-1)).toMatchObject({ id: null, title: 'Uncategorized' });
		expect(groups.at(-1)!.feeds.map((f) => f.id)).toEqual(['loose']);
	});

	it('keys groups stably, mapping the loose bucket to a sentinel', () => {
		expect(feedGroupKey({ id: 'tech', title: 'Tech', feeds: [] })).toBe('tech');
		expect(feedGroupKey({ id: null, title: 'Uncategorized', feeds: [] })).toBe('__loose');
	});
});
