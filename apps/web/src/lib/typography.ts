/**
 * Reader typography + theme model. The pure helpers here (parse, clamp, derive
 * CSS variables) are unit-testable; the reactive store in `reader-settings.svelte.ts`
 * wraps them with localStorage persistence and `$state`.
 */

export type ThemeMode = 'light' | 'dark' | 'auto';
export type FontFamily = 'serif' | 'sans' | 'mono';

export interface ReaderSettings {
	theme: ThemeMode;
	fontFamily: FontFamily;
	/** Body font size in px. */
	fontSize: number;
	/** Unitless line-height multiplier. */
	lineHeight: number;
	/** Article max content width in px. */
	maxWidth: number;
	/** After triaging in the reader, jump to the next document in the list. */
	autoAdvance: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
	theme: 'auto',
	fontFamily: 'serif',
	fontSize: 19,
	lineHeight: 1.6,
	maxWidth: 680,
	autoAdvance: true
};

export const FONT_STACKS: Record<FontFamily, string> = {
	serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
	sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
	mono: '"SF Mono", "JetBrains Mono", ui-monospace, monospace'
};

const THEMES: Record<ThemeMode, true> = { light: true, dark: true, auto: true };
const FONTS: Record<FontFamily, true> = { serif: true, sans: true, mono: true };

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** Coerce an arbitrary parsed object into valid, in-range settings. */
export function normalizeSettings(raw: unknown): ReaderSettings {
	const o = (raw ?? {}) as Partial<ReaderSettings>;
	return {
		theme: o.theme && THEMES[o.theme] ? o.theme : DEFAULT_SETTINGS.theme,
		fontFamily: o.fontFamily && FONTS[o.fontFamily] ? o.fontFamily : DEFAULT_SETTINGS.fontFamily,
		fontSize: clampNumber(o.fontSize, DEFAULT_SETTINGS.fontSize, 12, 28),
		lineHeight: clampNumber(o.lineHeight, DEFAULT_SETTINGS.lineHeight, 1.2, 2.2),
		maxWidth: clampNumber(o.maxWidth, DEFAULT_SETTINGS.maxWidth, 480, 1000),
		autoAdvance: typeof o.autoAdvance === 'boolean' ? o.autoAdvance : DEFAULT_SETTINGS.autoAdvance
	};
}

function clampNumber(value: unknown, fallback: number, lo: number, hi: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

/** Parse a localStorage JSON blob into settings, falling back to defaults. */
export function parseSettings(raw: string | null): ReaderSettings {
	if (!raw) return { ...DEFAULT_SETTINGS };
	try {
		return normalizeSettings(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

/** The CSS custom properties that drive the reader's typography. */
export function readerCssVars(s: ReaderSettings): Record<string, string> {
	return {
		'--reader-font': FONT_STACKS[s.fontFamily],
		'--reader-size': `${s.fontSize}px`,
		'--reader-leading': String(s.lineHeight),
		'--reader-width': `${s.maxWidth}px`
	};
}

/** The `data-theme` attribute value, or `null` for `auto` (defers to media query). */
export function themeAttr(theme: ThemeMode): string | null {
	return theme === 'auto' ? null : theme;
}
