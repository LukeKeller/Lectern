import type { Location } from '@lectern/shared';

/**
 * Bridge between the global keyboard layer (in the layout) and whichever list
 * view is currently mounted. A list registers a controller on mount; the layout's
 * keydown handler routes selection/open/triage actions to it. Only one list is
 * active at a time, so a single slot suffices.
 */

export interface ListController {
	move(delta: number): void;
	open(): void;
	triage(location: Location): void;
	/** Optional "mark the focused document read"; the reading view omits it. */
	markRead?(): void;
	/** Optional "go back" (the reading view returns to its list); lists omit it. */
	back?(): void;
}

class ActiveListController {
	current = $state<ListController | null>(null);

	set(controller: ListController): void {
		this.current = controller;
	}

	clear(controller: ListController): void {
		// Only clear if we still own the slot (guards against mount/unmount races).
		if (this.current === controller) this.current = null;
	}
}

export const activeList = new ActiveListController();
