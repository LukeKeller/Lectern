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
	private schemeListenerBound = false;

	/** Apply the current theme to the document root (no-op on the server). */
	applyTheme(): void {
		if (!browser) return;
		const attr = themeAttr(this.current.theme);
		if (attr) document.documentElement.setAttribute('data-theme', attr);
		else document.documentElement.removeAttribute('data-theme');
		this.syncThemeColor();
		this.ensureSchemeListener();
	}

	/**
	 * Keep the PWA status-bar colour (`<meta name="theme-color">`) in lockstep
	 * with the active background so full-screen chrome reads as one surface
	 * instead of a two-tone top/bottom. Colours mirror `--bg` in app.css.
	 */
	private syncThemeColor(): void {
		if (!browser) return;
		const dark =
			this.current.theme === 'dark' ||
			(this.current.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		const color = dark ? '#1a1815' : '#f6f4ee';
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
	}

	/** While theme is `auto`, the status-bar colour must track OS scheme changes. */
	private ensureSchemeListener(): void {
		if (!browser || this.schemeListenerBound) return;
		this.schemeListenerBound = true;
		window
			.matchMedia('(prefers-color-scheme: dark)')
			.addEventListener('change', () => this.syncThemeColor());
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
