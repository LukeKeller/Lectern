import { browser } from '$app/environment';

/**
 * App-wide UI preferences (distinct from reader/typography settings), backed by
 * localStorage. Currently holds the landing view the app opens to on launch.
 */

export interface LandingView {
	id: string;
	label: string;
}

// The left-nav destinations that make sense as a launch target. Mirrors the
// primary nav in +layout.svelte plus the Daily editions.
export const LANDING_VIEWS: readonly LandingView[] = [
	{ id: '/', label: 'Home' },
	{ id: '/inbox', label: 'Inbox' },
	{ id: '/feed', label: 'Feed' },
	{ id: '/later', label: 'Later' },
	{ id: '/shortlist', label: 'Shortlist' },
	{ id: '/archive', label: 'Archive' },
	{ id: '/library', label: 'Library' },
	{ id: '/newspaper', label: 'Newspaper' },
	{ id: '/magazine', label: 'Magazine' }
] as const;

export interface AppSettings {
	/** Route the app navigates to on initial load. */
	defaultView: string;
}

const KEY = 'lectern.app';
const DEFAULT_SETTINGS: AppSettings = { defaultView: '/feed' };

function read(): AppSettings {
	if (!browser) return { ...DEFAULT_SETTINGS };
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		const valid = LANDING_VIEWS.some((v) => v.id === parsed.defaultView);
		return { defaultView: valid ? (parsed.defaultView as string) : DEFAULT_SETTINGS.defaultView };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

class AppSettingsStore {
	current = $state<AppSettings>(read());

	update(patch: Partial<AppSettings>): void {
		this.current = { ...this.current, ...patch };
		if (browser) localStorage.setItem(KEY, JSON.stringify(this.current));
	}
}

export const appSettings = new AppSettingsStore();
