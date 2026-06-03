import { browser } from '$app/environment';
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	parseSettings,
	themeAttr,
	type ReaderSettings
} from './typography';

/**
 * App-wide reactive reader settings backed by localStorage. A single `$state`
 * object is shared by the reader and the settings page; every write persists and
 * re-applies the active theme to `<html data-theme>` so light/dark/auto take
 * effect everywhere immediately.
 */

const KEY = 'lectern.reader';

function read(): ReaderSettings {
	if (!browser) return { ...DEFAULT_SETTINGS };
	return parseSettings(localStorage.getItem(KEY));
}

class ReaderSettingsStore {
	current = $state<ReaderSettings>(read());

	/** Apply the current theme to the document root (no-op on the server). */
	applyTheme(): void {
		if (!browser) return;
		const attr = themeAttr(this.current.theme);
		if (attr) document.documentElement.setAttribute('data-theme', attr);
		else document.documentElement.removeAttribute('data-theme');
	}

	/** Merge a partial update, persist it, and re-apply the theme. */
	update(patch: Partial<ReaderSettings>): void {
		this.current = normalizeSettings({ ...this.current, ...patch });
		if (browser) localStorage.setItem(KEY, JSON.stringify(this.current));
		this.applyTheme();
	}

	reset(): void {
		this.update({ ...DEFAULT_SETTINGS });
	}
}

export const readerSettings = new ReaderSettingsStore();
