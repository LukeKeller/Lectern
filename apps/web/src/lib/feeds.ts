import type { Feed, FeedFolder } from '@lectern/shared';

/**
 * Pure feed-grouping shared by the feeds management page and the sidebar tree.
 * Feeds are bucketed by their folder; folders with no feeds are dropped and a
 * trailing "Uncategorized" group collects loose feeds. Folders referenced by a
 * feed but absent from the folder list are still surfaced (so a feed never
 * silently disappears from the tree).
 */
export interface FeedGroup {
	/** MiniFlux folder id, or null for the synthetic "Uncategorized" group. */
	id: string | null;
	title: string;
	feeds: Feed[];
}

export function groupFeeds(feeds: Feed[], folders: FeedFolder[]): FeedGroup[] {
	const byFolder: Record<string, Feed[]> = {};
	const loose: Feed[] = [];
	for (const feed of feeds) {
		if (feed.folderId) (byFolder[feed.folderId] ??= []).push(feed);
		else loose.push(feed);
	}
	const groups: FeedGroup[] = folders.map((folder) => ({
		id: folder.id,
		title: folder.title,
		feeds: byFolder[folder.id] ?? []
	}));
	// Surface folders that feeds reference but the folder list omitted.
	for (const feed of feeds) {
		if (feed.folderId && !groups.some((g) => g.id === feed.folderId)) {
			groups.push({
				id: feed.folderId,
				title: feed.folderTitle ?? feed.folderId,
				feeds: byFolder[feed.folderId] ?? []
			});
		}
	}
	if (loose.length) groups.push({ id: null, title: 'Uncategorized', feeds: loose });
	return groups.filter((g) => g.feeds.length > 0);
}

/** Stable storage key for a group's expand state (null folder => loose bucket). */
export function feedGroupKey(group: FeedGroup): string {
	return group.id ?? '__loose';
}
