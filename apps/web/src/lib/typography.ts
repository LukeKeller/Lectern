/**
 * Reader typography + theme model. The pure helpers here (parse, clamp, derive
 * CSS variables) are unit-testable; the reactive store in `reader-settings.svelte.ts`
 * wraps them with localStorage persistence and `$state`.
 */

/**
 * App + reader colour themes. `auto` follows the OS light/dark; the rest are
 * explicit palettes defined in app.css. Light family: light (warm paper), sepia,
 * newsprint. Dark family: dark (dim), black (true-black OLED), contrast (max
 * legibility). The reader can override the app theme independently (see
 * `readerTheme`).
 */
export type ThemeMode = 'auto' | 'light' | 'sepia' | 'newsprint' | 'dark' | 'black' | 'contrast';

/** Reader-pane theme: `match` inherits the app theme; anything else overrides it. */
export type ReaderTheme = 'match' | Exclude<ThemeMode, 'auto'>;

/**
 * Reading font. `serif`/`sans`/`mono` are system stacks (zero bytes); the rest
 * are bundled web fonts chosen for legibility: `literata` (a screen-tuned reading
 * serif), `atkinson` (Atkinson Hyperlegible, designed for low vision), `lexend`
 * (tuned to reduce reading effort), and `opendyslexic` (weighted bottoms for
 * dyslexic readers).
 */
export type FontFamily =
	| 'serif'
	| 'sans'
	| 'mono'
	| 'literata'
	| 'atkinson'
	| 'lexend'
	| 'opendyslexic';

/** Paragraph separation: `spaced` (web convention, inter-paragraph gap) or
 *  `indented` (book convention, first-line indents and no gap). */
export type ParagraphStyle = 'spaced' | 'indented';

export interface ReaderSettings {
	/** App-wide theme (drives `<html data-theme>`). */
	theme: ThemeMode;
	/** Reader-pane theme override; `match` defers to {@link theme}. */
	readerTheme: ReaderTheme;
	/** Tint the reader accent from the article's cover image (Iteration B). */
	adaptiveAccent: boolean;
	fontFamily: FontFamily;
	/** Body font size in px. */
	fontSize: number;
	/** Unitless line-height multiplier. */
	lineHeight: number;
	/** Article max content width in px. */
	maxWidth: number;
	/** Tracking, in em (can be slightly negative for tight display faces). */
	letterSpacing: number;
	/** Extra word spacing, in em. */
	wordSpacing: number;
	/** Inter-paragraph gap, in em. */
	paragraphSpacing: number;
	/** Paragraph separation: spacing between blocks, or book-style indents. */
	paragraphStyle: ParagraphStyle;
	/** After triaging in the reader, jump to the next document in the list. */
	autoAdvance: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
	theme: 'auto',
	readerTheme: 'match',
	adaptiveAccent: false,
	fontFamily: 'serif',
	fontSize: 19,
	lineHeight: 1.6,
	maxWidth: 680,
	letterSpacing: 0,
	wordSpacing: 0,
	paragraphSpacing: 1,
	paragraphStyle: 'spaced',
	autoAdvance: true
};

export const FONT_STACKS: Record<FontFamily, string> = {
	serif: '"Iowan Old Style", Charter, "Literata", Georgia, serif',
	sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
	mono: '"SF Mono", "JetBrains Mono", ui-monospace, monospace',
	literata: '"Literata", "Literata-fallback", Georgia, "Times New Roman", serif',
	atkinson: '"Atkinson Hyperlegible", system-ui, -apple-system, sans-serif',
	lexend: '"Lexend", system-ui, -apple-system, sans-serif',
	opendyslexic: '"OpenDyslexic", Comic Sans MS, system-ui, sans-serif'
};

/** Human labels + a one-line rationale for the settings UI. */
export const FONT_LABELS: Record<FontFamily, { label: string; note: string }> = {
	serif: { label: 'Serif', note: 'Classic reading serif' },
	sans: { label: 'Sans', note: 'Clean system sans' },
	mono: { label: 'Mono', note: 'Fixed width' },
	literata: { label: 'Literata', note: 'Screen-tuned book serif' },
	atkinson: { label: 'Atkinson', note: 'Hyperlegible, low-vision' },
	lexend: { label: 'Lexend', note: 'Reduces reading effort' },
	opendyslexic: { label: 'OpenDyslexic', note: 'Dyslexia-friendly' }
};

/** Theme labels + the swatch colour shown in the picker. */
export const THEME_SWATCHES: Record<ThemeMode, { label: string; bg: string; fg: string }> = {
	auto: { label: 'Auto', bg: 'linear-gradient(135deg,#f6f4ee 50%,#1a1815 50%)', fg: '#888' },
	light: { label: 'Paper', bg: '#f6f4ee', fg: '#2a2620' },
	sepia: { label: 'Sepia', bg: '#f4ecd8', fg: '#43361f' },
	newsprint: { label: 'Newsprint', bg: '#f1e4c8', fg: '#2b1f10' },
	dark: { label: 'Dark', bg: '#1a1815', fg: '#e8e3d7' },
	black: { label: 'Black', bg: '#000000', fg: '#cfcdc8' },
	contrast: { label: 'Contrast', bg: '#000000', fg: '#ffffff' }
};

/** Quick reading-width presets (px), surfaced as buttons in the settings UI.
 *  Stored as raw px for now; an em-of-reader-size model (Narrow 28em /
 *  Medium 34em / Wide 40em) is a future refactor. 760 is the measure cap. */
export const WIDTH_PRESETS: { label: string; value: number }[] = [
	{ label: 'Narrow', value: 580 },
	{ label: 'Medium', value: 680 },
	{ label: 'Wide', value: 760 }
];

const THEMES: Record<ThemeMode, true> = {
	auto: true,
	light: true,
	sepia: true,
	newsprint: true,
	dark: true,
	black: true,
	contrast: true
};
const READER_THEMES: Record<ReaderTheme, true> = {
	match: true,
	light: true,
	sepia: true,
	newsprint: true,
	dark: true,
	black: true,
	contrast: true
};
const FONTS: Record<FontFamily, true> = {
	serif: true,
	sans: true,
	mono: true,
	literata: true,
	atkinson: true,
	lexend: true,
	opendyslexic: true
};

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** Coerce an arbitrary parsed object into valid, in-range settings. */
export function normalizeSettings(raw: unknown): ReaderSettings {
	const o = (raw ?? {}) as Partial<ReaderSettings>;
	return {
		theme: o.theme && THEMES[o.theme] ? o.theme : DEFAULT_SETTINGS.theme,
		readerTheme:
			o.readerTheme && READER_THEMES[o.readerTheme] ? o.readerTheme : DEFAULT_SETTINGS.readerTheme,
		adaptiveAccent:
			typeof o.adaptiveAccent === 'boolean' ? o.adaptiveAccent : DEFAULT_SETTINGS.adaptiveAccent,
		fontFamily: o.fontFamily && FONTS[o.fontFamily] ? o.fontFamily : DEFAULT_SETTINGS.fontFamily,
		fontSize: clampNumber(o.fontSize, DEFAULT_SETTINGS.fontSize, 12, 28),
		lineHeight: clampNumber(o.lineHeight, DEFAULT_SETTINGS.lineHeight, 1.2, 2.2),
		maxWidth: clampNumber(o.maxWidth, DEFAULT_SETTINGS.maxWidth, 480, 760),
		letterSpacing: clampNumber(o.letterSpacing, DEFAULT_SETTINGS.letterSpacing, -0.05, 0.15),
		wordSpacing: clampNumber(o.wordSpacing, DEFAULT_SETTINGS.wordSpacing, 0, 0.5),
		paragraphSpacing: clampNumber(o.paragraphSpacing, DEFAULT_SETTINGS.paragraphSpacing, 0.4, 2.4),
		paragraphStyle: o.paragraphStyle === 'indented' ? 'indented' : DEFAULT_SETTINGS.paragraphStyle,
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

/** Faces designed for reading accessibility. When one is active, in-article
 *  headings follow the body face instead of the editorial serif — headings are
 *  the elements readers scan by, so they must not regress to a hard face. */
const ACCESSIBILITY_FONTS: ReadonlySet<FontFamily> = new Set([
	'atkinson',
	'lexend',
	'opendyslexic'
]);

/** The CSS custom properties that drive the reader's typography. */
export function readerCssVars(s: ReaderSettings): Record<string, string> {
	return {
		'--reader-font': FONT_STACKS[s.fontFamily],
		'--reader-size': `${s.fontSize}px`,
		'--reader-leading': String(s.lineHeight),
		'--reader-width': `${s.maxWidth}px`,
		'--reader-tracking': `${s.letterSpacing}em`,
		'--reader-word-spacing': `${s.wordSpacing}em`,
		'--reader-para-gap': `${s.paragraphSpacing}em`,
		// Consumed by .lectern-prose headings (lib/styles/prose.css). Resolves
		// on the reader's .doc, overriding the :root default (--font-serif).
		'--prose-heading-font': ACCESSIBILITY_FONTS.has(s.fontFamily)
			? 'var(--reader-font)'
			: 'var(--font-serif)'
	};
}

/** The `data-theme` attribute value, or `null` for `auto` (defers to media query). */
export function themeAttr(theme: ThemeMode): string | null {
	return theme === 'auto' ? null : theme;
}

/**
 * The effective reader-pane theme: the explicit override, or the resolved app
 * theme when set to `match`. Returns `null` only when the app theme is `auto`
 * and the reader is matching it (defer to the OS media query).
 */
export function readerThemeAttr(theme: ThemeMode, readerTheme: ReaderTheme): string | null {
	if (readerTheme !== 'match') return readerTheme;
	return themeAttr(theme);
}

/** Whether a theme renders dark chrome (drives the `<meta theme-color>` value). */
export function isDarkTheme(theme: Exclude<ThemeMode, 'auto'>): boolean {
	return theme === 'dark' || theme === 'black' || theme === 'contrast';
}

/** Each theme's background colour, mirroring `--bg` in app.css. Used to drive the
 *  PWA `<meta theme-color>` / `color-scheme`. Keep in sync with the theme blocks. */
export const THEME_BG: Record<Exclude<ThemeMode, 'auto'>, string> = {
	light: '#f6f4ee',
	sepia: '#f4ecd8',
	newsprint: '#f1e4c8',
	dark: '#1a1815',
	black: '#000000',
	contrast: '#000000'
};

/** Each theme's body-text colour, mirroring `--text` in app.css. Used as the
 *  mix target when clamping adaptive accents for contrast. Keep in sync. */
export const THEME_TEXT: Record<Exclude<ThemeMode, 'auto'>, string> = {
	light: '#2a2620',
	sepia: '#43361f',
	newsprint: '#2b1f10',
	dark: '#e8e3d7',
	black: '#cfcdc8',
	contrast: '#ffffff'
};

/** Parse `#rgb` / `#rrggbb` (leading `#` optional) into 0-255 channels. */
export function parseHex(hex: string): [number, number, number] | null {
	const t = hex.trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(t)) {
		return [parseInt(t[0] + t[0], 16), parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16)];
	}
	if (/^[0-9a-f]{6}$/i.test(t)) {
		const n = parseInt(t, 16);
		return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
	}
	return null;
}

function toHex(rgb: [number, number, number]): string {
	return (
		'#' +
		rgb
			.map((c) =>
				Math.max(0, Math.min(255, Math.round(c)))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

/** WCAG 2.x relative luminance of an sRGB colour (channels 0-255). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1-21) between two sRGB colours (channels 0-255). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/** Linear per-channel mix: `a` moved fraction `t` (0-1) toward `b`. */
function mixRgb(
	a: [number, number, number],
	b: [number, number, number],
	t: number
): [number, number, number] {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Clamp an adaptive accent for legibility: while its contrast against `bgHex`
 * is below 4.5:1, mix it 15% toward `textHex` (at most 5 iterations, which is
 * enough to lift any colour on every bundled theme). Non-hex input (or a
 * malformed map entry) passes through unchanged — fail open to the raw colour.
 */
export function clampAccentContrast(accentHex: string, bgHex: string, textHex: string): string {
	const bg = parseHex(bgHex);
	const text = parseHex(textHex);
	let cur = parseHex(accentHex);
	if (!bg || !text || !cur) return accentHex;
	for (let i = 0; i < 5 && contrastRatio(cur, bg) < 4.5; i++) {
		cur = mixRgb(cur, text, 0.15);
	}
	return toHex(cur);
}

/**
 * Resolve a theme to its `{ bg, dark }` chrome values. `auto` defers to the OS
 * scheme via the supplied `prefersDark` (callers pass `matchMedia` result so this
 * stays pure/testable).
 */
export function chromeForTheme(
	theme: ThemeMode,
	prefersDark: boolean
): { bg: string; dark: boolean } {
	const resolved = theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme;
	return { bg: THEME_BG[resolved], dark: isDarkTheme(resolved) };
}
