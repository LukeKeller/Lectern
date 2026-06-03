import type { CreateViewRequest, SavedView } from '@lectern/shared';
import { getClient } from './config';

/**
 * Reactive cache of the user's custom saved views. Loaded from the API and
 * refreshed after a create, so the nav (pinned views) and the views route stay
 * in sync. Failures are swallowed into `error` rather than thrown — the app
 * still works against the local mirror when offline.
 */
class ViewsStore {
	views = $state<SavedView[]>([]);
	loaded = $state(false);
	error = $state<string | undefined>(undefined);

	async load(): Promise<void> {
		try {
			const res = await getClient().listViews();
			this.views = res.views;
			this.error = undefined;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loaded = true;
		}
	}

	async create(body: CreateViewRequest): Promise<SavedView | undefined> {
		try {
			const view = await getClient().createView(body);
			this.views = [...this.views, view];
			this.error = undefined;
			return view;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			return undefined;
		}
	}

	get pinned(): SavedView[] {
		return this.views.filter((v) => v.pinned);
	}

	byId(id: string): SavedView | undefined {
		return this.views.find((v) => v.id === id);
	}
}

export const viewsStore = new ViewsStore();
