import type { CreateViewRequest, SavedView, UpdateViewRequest } from '@lectern/shared';
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

	async update(id: string, patch: UpdateViewRequest): Promise<SavedView | undefined> {
		try {
			const view = await getClient().updateView(id, patch);
			this.views = this.views.map((v) => (v.id === view.id ? view : v));
			this.error = undefined;
			return view;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			return undefined;
		}
	}

	async remove(id: string): Promise<boolean> {
		try {
			await getClient().deleteView(id);
			this.views = this.views.filter((v) => v.id !== id);
			this.error = undefined;
			return true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			return false;
		}
	}

	/** Move a view one slot up/down in the saved-view order (persists positions). */
	async move(id: string, dir: 'up' | 'down'): Promise<void> {
		const order = this.sorted;
		const i = order.findIndex((v) => v.id === id);
		const j = dir === 'up' ? i - 1 : i + 1;
		if (i < 0 || j < 0 || j >= order.length) return;
		const tmp = order[i]!;
		order[i] = order[j]!;
		order[j] = tmp;
		// Normalise positions to the new index so degenerate (all-zero) orders settle.
		await Promise.all(
			order.map((v, idx) => (v.position === idx ? undefined : this.update(v.id, { position: idx })))
		);
	}

	get sorted(): SavedView[] {
		return [...this.views].sort((a, b) => a.position - b.position);
	}

	get pinned(): SavedView[] {
		return this.sorted.filter((v) => v.pinned);
	}

	byId(id: string): SavedView | undefined {
		return this.views.find((v) => v.id === id);
	}
}

export const viewsStore = new ViewsStore();
