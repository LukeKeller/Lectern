import { describe, expect, it } from 'vitest';
import { resolveKey, SINGLE_KEYS, PREFIX_KEYS } from './keyboard';

describe('resolveKey', () => {
	it('maps j/k to relative selection moves', () => {
		expect(resolveKey(null, { key: 'j' })).toEqual({
			action: { type: 'move', delta: 1 },
			pending: null
		});
		expect(resolveKey(null, { key: 'k' })).toEqual({
			action: { type: 'move', delta: -1 },
			pending: null
		});
	});

	it('maps o and Enter to open', () => {
		expect(resolveKey(null, { key: 'o' }).action).toEqual({ type: 'open' });
		expect(resolveKey(null, { key: 'Enter' }).action).toEqual({ type: 'open' });
	});

	it('maps e/l/s to triage locations', () => {
		expect(resolveKey(null, { key: 'e' }).action).toEqual({
			type: 'setLocation',
			location: 'archive'
		});
		expect(resolveKey(null, { key: 'l' }).action).toEqual({
			type: 'setLocation',
			location: 'later'
		});
		expect(resolveKey(null, { key: 's' }).action).toEqual({
			type: 'setLocation',
			location: 'shortlist'
		});
	});

	it('maps / to focus search', () => {
		expect(resolveKey(null, { key: '/' }).action).toEqual({ type: 'focusSearch' });
	});

	it('opens the palette on Cmd/Ctrl-K from any state', () => {
		expect(resolveKey(null, { key: 'k', metaKey: true }).action).toEqual({ type: 'palette' });
		expect(resolveKey(null, { key: 'K', ctrlKey: true }).action).toEqual({ type: 'palette' });
		// Even mid-prefix, the palette wins and clears the prefix.
		expect(resolveKey('g', { key: 'k', ctrlKey: true })).toEqual({
			action: { type: 'palette' },
			pending: null
		});
	});

	it('handles the g-prefix navigation chord', () => {
		const first = resolveKey(null, { key: 'g' });
		expect(first).toEqual({ pending: 'g' });
		expect(resolveKey(first.pending, { key: 'i' }).action).toEqual({ type: 'navigate', path: '/' });
		expect(resolveKey('g', { key: 'f' }).action).toEqual({ type: 'navigate', path: '/feed' });
		expect(resolveKey('g', { key: 'l' }).action).toEqual({ type: 'navigate', path: '/library' });
	});

	it('the g-prefix takes precedence over the single-key l shortcut', () => {
		// Plain l => later; g then l => library.
		expect(resolveKey(null, { key: 'l' }).action).toEqual({
			type: 'setLocation',
			location: 'later'
		});
		expect(resolveKey('g', { key: 'l' }).action).toEqual({ type: 'navigate', path: '/library' });
	});

	it('clears the prefix when the follow-up key is not a known chord', () => {
		expect(resolveKey('g', { key: 'z' })).toEqual({ pending: null });
	});

	it('ignores unmodified unknown keys and bare modifier combos', () => {
		expect(resolveKey(null, { key: 'z' })).toEqual({ pending: null });
		expect(resolveKey(null, { key: 'a', metaKey: true })).toEqual({ pending: null });
	});

	it('exposes the shortcut tables as data', () => {
		expect(SINGLE_KEYS.j).toEqual({ type: 'move', delta: 1 });
		expect(PREFIX_KEYS.g!.i).toEqual({ type: 'navigate', path: '/' });
	});
});
