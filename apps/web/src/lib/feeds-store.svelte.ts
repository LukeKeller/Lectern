import type { Feed, FeedFolder } from '@lectern/shared';
import { getClient } from './config';
import { groupFeeds, type FeedGroup } from './feeds';

/**
 * Reactive cache of the user's RSS feeds + folders, loaded from the API and used
 * by the sidebar feed tree (and the feeds management page). Failures are
 * swallowed into `error` rather than thrown so the app keeps working offline —
 * the tree simply stays empty until the next successful load.
 */
class FeedsStore {
	feeds = $state<Feed[]>([]);
	folders = $state<FeedFolder[]>([]);
	loaded = $state(false);
	error = $state<string | undefined>(undefined);

	async load(): Promise<void> {
		try {
			const res = await getClient().listFeeds();
			this.feeds = res.feeds;
			this.folders = res.folders;
			this.error = undefined;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loaded = true;
		}
	}

	get grouped(): FeedGroup[] {
		return groupFeeds(this.feeds, this.folders);
	}
}

export const feedsStore = new FeedsStore();
