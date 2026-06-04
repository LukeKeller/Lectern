export type SwipeDirection = 'left' | 'right';

export interface SwipeParams {
	/** Called once when a horizontal swipe passes the commit threshold. */
	onCommit: (dir: SwipeDirection) => void;
	enabled?: boolean;
}

export interface SwipeHandle {
	update(params: SwipeParams): void;
	destroy(): void;
}

/**
 * Touch swipe-to-act for list rows (Svelte action). Attach to a wrapper that
 * contains a `.swipe-front` element; the front is dragged horizontally to reveal
 * action panels behind it, committing when the drag passes a threshold. Pointer
 * events are gated to `touch` so desktop clicks, hover, and the per-card buttons
 * are untouched — this is a progressive enhancement, not a replacement.
 *
 * The wrapper must set `touch-action: pan-y` so vertical scrolling still works;
 * horizontal intent is detected before engaging so we never hijack a scroll.
 */
export function swipeable(node: HTMLElement, params: SwipeParams): SwipeHandle {
	let enabled = params.enabled ?? true;
	let onCommit = params.onCommit;
	const front = node.querySelector<HTMLElement>('.swipe-front');
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let tracking = false;
	let engaged = false;

	function setX(x: number): void {
		if (front) front.style.transform = x ? `translateX(${x}px)` : '';
	}

	function reset(animate: boolean): void {
		if (front) {
			front.style.transition = animate ? 'transform 0.2s ease' : 'none';
			front.style.background = '';
		}
		setX(0);
		tracking = false;
		engaged = false;
		dx = 0;
	}

	function onDown(e: PointerEvent): void {
		if (!enabled || e.pointerType !== 'touch') return;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		tracking = true;
		engaged = false;
		if (front) front.style.transition = 'none';
	}

	function onMove(e: PointerEvent): void {
		if (!tracking) return;
		dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!engaged) {
			if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
				engaged = true;
				try {
					node.setPointerCapture(e.pointerId);
				} catch {
					/* not all environments support capture; the gesture still works */
				}
				// Make the card opaque only now so the list keeps its flat resting look.
				if (front) front.style.background = 'var(--bg)';
			} else if (Math.abs(dy) > 10) {
				tracking = false; // vertical intent — let the page scroll
				return;
			} else {
				return;
			}
		}
		// Resist past ~160px so the gesture has a ceiling.
		setX(Math.max(-160, Math.min(160, dx)));
	}

	function onUp(): void {
		if (!tracking && !engaged) return;
		const threshold = Math.max(90, node.offsetWidth * 0.33);
		const commit = engaged && Math.abs(dx) > threshold;
		const dir: SwipeDirection = dx < 0 ? 'left' : 'right';
		const wasEngaged = engaged;
		reset(true);
		if (wasEngaged) {
			// Swallow the click that trails a touch drag so the card doesn't open.
			const swallow = (ev: Event) => {
				ev.preventDefault();
				ev.stopPropagation();
			};
			node.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => node.removeEventListener('click', swallow, true), 400);
		}
		if (commit) onCommit(dir);
	}

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);

	return {
		update(p: SwipeParams) {
			enabled = p.enabled ?? true;
			onCommit = p.onCommit;
		},
		destroy() {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
		}
	};
}
