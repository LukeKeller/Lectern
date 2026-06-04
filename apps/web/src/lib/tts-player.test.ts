import { beforeEach, describe, expect, it } from 'vitest';
import { ttsPlayer } from './tts-player.svelte';

// Node test env: there is no `window`, so init()/persist no-op and no <audio> is
// created — the synchronous queue logic is what we exercise here.
beforeEach(() => ttsPlayer.clear());

describe('ttsPlayer queue', () => {
	it('enqueues, dedupes by id, and points at the first item', () => {
		ttsPlayer.enqueue({ id: 'a', title: 'A' });
		ttsPlayer.enqueue({ id: 'b', title: 'B' });
		ttsPlayer.enqueue({ id: 'a', title: 'A again' });
		expect(ttsPlayer.queue.map((q) => q.id)).toEqual(['a', 'b']);
		expect(ttsPlayer.index).toBe(0);
	});

	it('removing an item before the current shifts the index back', () => {
		ttsPlayer.enqueue({ id: 'a', title: 'A' });
		ttsPlayer.enqueue({ id: 'b', title: 'B' });
		ttsPlayer.enqueue({ id: 'c', title: 'C' });
		ttsPlayer.index = 2; // current = c
		ttsPlayer.remove(0);
		expect(ttsPlayer.queue.map((q) => q.id)).toEqual(['b', 'c']);
		expect(ttsPlayer.currentId).toBe('c');
	});

	it('removing the current item points at the next and goes idle', () => {
		ttsPlayer.enqueue({ id: 'a', title: 'A' });
		ttsPlayer.enqueue({ id: 'b', title: 'B' });
		ttsPlayer.index = 0;
		ttsPlayer.remove(0);
		expect(ttsPlayer.queue.map((q) => q.id)).toEqual(['b']);
		expect(ttsPlayer.index).toBe(0);
		expect(ttsPlayer.status).toBe('idle');
	});

	it('reordering keeps the current track under the moved item', () => {
		ttsPlayer.enqueue({ id: 'a', title: 'A' });
		ttsPlayer.enqueue({ id: 'b', title: 'B' });
		ttsPlayer.enqueue({ id: 'c', title: 'C' });
		ttsPlayer.index = 0; // current = a
		ttsPlayer.move(0, 2);
		expect(ttsPlayer.queue.map((q) => q.id)).toEqual(['b', 'c', 'a']);
		expect(ttsPlayer.currentId).toBe('a');
	});

	it('clear empties the queue', () => {
		ttsPlayer.enqueue({ id: 'a', title: 'A' });
		ttsPlayer.clear();
		expect(ttsPlayer.queue).toEqual([]);
		expect(ttsPlayer.index).toBe(-1);
	});
});
