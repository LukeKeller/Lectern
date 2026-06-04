import { browser } from '$app/environment';
import {
	chromeForTheme,
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
	 * Keep the PWA system-chrome colour (`<meta name="theme-color">`) in lockstep
	 * with the active background so the standalone status/nav bars read as one
	 * surface instead of a two-tone top/bottom. A single tag (see app.html) set
	 * imperatively — standalone windows ignore media-scoped theme-color tags after
	 * a forced theme, so we resolve the effective scheme ourselves. `color-scheme`
	 * is set alongside so native form controls / overscroll match. Mirrors `--bg`.
	 */
	private syncThemeColor(): void {
		if (!browser) return;
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const { bg, dark } = chromeForTheme(this.current.theme, prefersDark);
		document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
		const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		if (meta) meta.content = bg;
	}

	/**
	 * For `auto`, the effective colour depends on the OS scheme — re-sync when it
	 * changes so the bars follow the system without a reload.
	 */
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
