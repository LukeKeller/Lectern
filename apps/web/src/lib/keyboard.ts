import type { Location } from '@lectern/shared';

/**
 * Keyboard shortcut resolution. The shortcut tables below are pure data and the
 * `resolveKey` function is a pure reducer over them, so the full mapping from a
 * keystroke (plus any pending prefix) to an action is unit-testable without a DOM.
 *
 * The scheme mirrors Readwise Reader: j/k (and arrows) move the selection,
 * Enter/o open, Esc goes back, single keys triage the focused document, a `g`
 * prefix jumps between views, `?` shows the shortcut sheet, and Cmd/Ctrl-K opens
 * the command palette. (`?` and `Esc`-for-overlays are handled in the layout
 * since they toggle UI state rather than act on a list.)
 *
 * Supported chords:
 *   j / ↓          move selection down
 *   k / ↑          move selection up
 *   Space          move selection down (Shift+Space moves up)
 *   o / Enter      open the focused document
 *   Esc            go back (reading view -> list)
 *   e              archive    (setLocation)
 *   l              later      (setLocation)
 *   s              shortlist  (setLocation)
 *   i              inbox      (setLocation)
 *   r              mark read  (markRead)
 *   /              focus search
 *   g then i/l/s/a/f/b/h   jump to a view
 *   Cmd/Ctrl-K     open the command palette
 */

/** A navigable route handled by the global keyboard layer. */
export type NavTarget =
	| '/'
	| '/later'
	| '/shortlist'
	| '/archive'
	| '/feed'
	| '/library'
	| '/search';

export type KeyAction =
	| { type: 'move'; delta: number }
	| { type: 'open' }
	| { type: 'back' }
	| { type: 'setLocation'; location: Location }
	| { type: 'markRead' }
	| { type: 'focusSearch' }
	| { type: 'navigate'; path: NavTarget }
	| { type: 'palette' };

/** The minimal slice of a `KeyboardEvent` the resolver reads. */
export interface KeyEventLike {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
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
	ArrowDown: { type: 'move', delta: 1 },
	ArrowUp: { type: 'move', delta: -1 },
	o: { type: 'open' },
	Enter: { type: 'open' },
	Escape: { type: 'back' },
	e: { type: 'setLocation', location: 'archive' },
	l: { type: 'setLocation', location: 'later' },
	s: { type: 'setLocation', location: 'shortlist' },
	i: { type: 'setLocation', location: 'inbox' },
	r: { type: 'markRead' },
	'/': { type: 'focusSearch' }
};

/** Two-key chords keyed by their leading prefix (e.g. `g` then `i`). */
export const PREFIX_KEYS: Record<string, Record<string, KeyAction>> = {
	g: {
		i: { type: 'navigate', path: '/' },
		h: { type: 'navigate', path: '/' },
		l: { type: 'navigate', path: '/later' },
		s: { type: 'navigate', path: '/shortlist' },
		a: { type: 'navigate', path: '/archive' },
		f: { type: 'navigate', path: '/feed' },
		b: { type: 'navigate', path: '/library' }
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

	// Space steps the selection like j/k (Shift+Space steps back), mirroring the
	// reader's Space-to-advance one level up at the list. Kept out of SINGLE_KEYS
	// because its direction depends on the Shift modifier.
	if (ev.key === ' ') {
		return { action: { type: 'move', delta: ev.shiftKey ? -1 : 1 }, pending: null };
	}

	if (PREFIX_KEYS[ev.key]) return { pending: ev.key };

	const action = SINGLE_KEYS[ev.key];
	return action ? { action, pending: null } : { pending: null };
}
