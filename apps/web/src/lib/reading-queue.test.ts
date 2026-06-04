import { describe, expect, it } from 'vitest';
import { readingQueue } from './reading-queue.svelte';

describe('readingQueue', () => {
	it('returns the id after a given id', () => {
		readingQueue.set(['a', 'b', 'c']);
		expect(readingQueue.nextAfter('a')).toBe('b');
		expect(readingQueue.nextAfter('b')).toBe('c');
	});

	it('returns undefined past the end or for an unknown id', () => {
		readingQueue.set(['a', 'b']);
		expect(readingQueue.nextAfter('b')).toBeUndefined();
		expect(readingQueue.nextAfter('zzz')).toBeUndefined();
	});

	it('clear empties the queue', () => {
		readingQueue.set(['a', 'b']);
		readingQueue.clear();
		expect(readingQueue.nextAfter('a')).toBeUndefined();
	});

	it('a fresh set replaces the previous order', () => {
		readingQueue.set(['a', 'b', 'c']);
		readingQueue.set(['x', 'y']);
		expect(readingQueue.nextAfter('a')).toBeUndefined();
		expect(readingQueue.nextAfter('x')).toBe('y');
	});
});
