export interface FocusTrapHandle {
	destroy(): void;
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for modal dialogs (Svelte action). On mount it remembers the
 * element that had focus (the opener), moves focus into `node`, and traps Tab /
 * Shift+Tab so keyboard users cannot escape the dialog. On destroy it restores
 * focus to the opener. The focusable set is recomputed on every Tab so dynamic
 * dialog contents (filtered lists, conditionally rendered controls) stay correct.
 *
 * Esc-to-close is intentionally left to the host component: this action only owns
 * focus, not dismissal.
 */
export function trapFocus(node: HTMLElement): FocusTrapHandle {
	const opener = document.activeElement as HTMLElement | null;

	const first = node.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
	(first ?? node).focus();

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Tab') return;
		const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
		if (items.length === 0) {
			event.preventDefault();
			node.focus();
			return;
		}
		const firstItem = items[0];
		const lastItem = items[items.length - 1];
		const active = document.activeElement;
		if (event.shiftKey) {
			if (active === firstItem || !node.contains(active)) {
				event.preventDefault();
				lastItem.focus();
			}
		} else if (active === lastItem || !node.contains(active)) {
			event.preventDefault();
			firstItem.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			if (opener && document.contains(opener)) opener.focus();
		}
	};
}
