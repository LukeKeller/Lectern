import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	ensureReadableText,
	parseHex,
	reskinVars,
	softenBackground
} from './typography';

/** WCAG contrast between two hex colours (test helper). */
function contrast(a: string, b: string): number {
	const ra = parseHex(a);
	const rb = parseHex(b);
	if (!ra || !rb) throw new Error(`bad hex: ${a} / ${b}`);
	return contrastRatio(ra, rb);
}

describe('ensureReadableText', () => {
	it('darkens light text on a light ground until readable', () => {
		const out = ensureReadableText('#cfcfcf', '#fcf9fd', 7);
		expect(contrast(out, '#fcf9fd')).toBeGreaterThanOrEqual(7);
	});

	it('lightens dark text on a dark ground until readable', () => {
		const out = ensureReadableText('#222222', '#031f4d', 7);
		expect(contrast(out, '#031f4d')).toBeGreaterThanOrEqual(4.5);
	});

	it('leaves already-readable text unchanged', () => {
		expect(ensureReadableText('#444444', '#fcf9fd', 7)).toBe('#444444');
	});

	it('passes through non-hex input', () => {
		expect(ensureReadableText('rebeccapurple', '#fff')).toBe('rebeccapurple');
	});
});

describe('softenBackground', () => {
	it('desaturates a vivid ground (moves it toward grey)', () => {
		const soft = parseHex(softenBackground('#031f4d'))!;
		const spread = Math.max(...soft) - Math.min(...soft);
		// Original navy has a wide channel spread; softened is calmer.
		expect(spread).toBeLessThan(0x4d - 0x03);
	});

	it('keeps a light paper light and a dark ground dark', () => {
		const light = parseHex(softenBackground('#fcf9fd'))!;
		const dark = parseHex(softenBackground('#031f4d'))!;
		expect(light[0]).toBeGreaterThan(200);
		expect(Math.max(...dark)).toBeLessThan(90);
	});

	it('returns valid hex and passes non-hex through', () => {
		expect(softenBackground('#f4ecd8')).toMatch(/^#[0-9a-f]{6}$/);
		expect(softenBackground('not-a-colour')).toBe('not-a-colour');
	});
});

describe('reskinVars — readability invariant', () => {
	it('never emits light-on-light: text is AAA against the painted ground', () => {
		// An INCOHERENT source pair (light text + light bg) must still come out readable.
		const v = reskinVars({ background: '#fcf9fd', text: '#e8e3d7' }, false);
		expect(v['--source-bg']).toBeTruthy();
		expect(contrast(v['--source-text'], v['--source-bg'])).toBeGreaterThanOrEqual(6.9);
	});

	it('holds contrast for a genuinely dark source palette', () => {
		const v = reskinVars({ background: '#031f4d', text: '#ccced1' }, false);
		expect(contrast(v['--source-text'], v['--source-bg'])).toBeGreaterThanOrEqual(4.5);
	});

	it('returns nothing to paint when the source gave no background', () => {
		expect(reskinVars({ text: '#111', accent: '#c00' }, false)['--source-bg']).toBeUndefined();
	});
});
