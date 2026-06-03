import type { Location } from '@lectern/shared';

/**
 * Keyboard shortcut resolution. The shortcut tables below are pure data and the
 * `resolveKey` function is a pure reducer over them, so the full mapping from a
 * keystroke (plus any pending prefix) to an action is unit-testable without a DOM.
 *
 * Supported chords:
 *   j / k          move selection down / up
 *   o / Enter      open the selected card
 *   e              archive   (setLocation)
 *   l              later     (setLocation)
 *   s              shortlist (setLocation)
 *   /              focus search
 *   g then i/f/l   navigate to Inbox / Feed / Library
 *   Cmd/Ctrl-K     open the command palette
 */

/** A navigable route handled by the global keyboard layer. */
export type NavTarget = '/' | '/feed' | '/library' | '/search';

export type KeyAction =
	| { type: 'move'; delta: number }
	| { type: 'open' }
	| { type: 'setLocation'; location: Location }
	| { type: 'focusSearch' }
	| { type: 'navigate'; path: NavTarget }
	| { type: 'palette' };

/** The minimal slice of a `KeyboardEvent` the resolver reads. */
export interface KeyEventLike {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
}

export interface KeyResolution {
	/** The action to dispatch, if the keystroke completed a chord. */
	action?: KeyAction;
	/** The prefix awaiting a follow-up key, or `null` when none is pending. */
	pending: string | null;
}

/** Single-key shortcuts (no modifiers, no pending prefix). */
export const SINGLE_KEYS: Record<string, KeyAction> = {
	j: { type: 'move', delta: 1 },
	k: { type: 'move', delta: -1 },
	o: { type: 'open' },
	Enter: { type: 'open' },
	e: { type: 'setLocation', location: 'archive' },
	l: { type: 'setLocation', location: 'later' },
	s: { type: 'setLocation', location: 'shortlist' },
	'/': { type: 'focusSearch' }
};

/** Two-key chords keyed by their leading prefix (e.g. `g` then `i`). */
export const PREFIX_KEYS: Record<string, Record<string, KeyAction>> = {
	g: {
		i: { type: 'navigate', path: '/' },
		f: { type: 'navigate', path: '/feed' },
		l: { type: 'navigate', path: '/library' }
	}
};

/**
 * Resolve a keystroke against the shortcut tables. `pending` is the prefix
 * returned by the previous call (or `null`). The result carries the next
 * `pending` value, so callers thread it through successive keystrokes.
 */
export function resolveKey(pending: string | null, ev: KeyEventLike): KeyResolution {
	// Cmd/Ctrl-K opens the palette regardless of any pending prefix.
	if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
		return { action: { type: 'palette' }, pending: null };
	}
	// Other modifier combos are not shortcuts; clear any pending prefix.
	if (ev.metaKey || ev.ctrlKey || ev.altKey) return { pending: null };

	if (pending) {
		const table = PREFIX_KEYS[pending];
		const action = table?.[ev.key];
		return action ? { action, pending: null } : { pending: null };
	}

	if (PREFIX_KEYS[ev.key]) return { pending: ev.key };

	const action = SINGLE_KEYS[ev.key];
	return action ? { action, pending: null } : { pending: null };
}
