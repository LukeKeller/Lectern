import { describe, expect, it } from 'vitest';
import {
	childSelector,
	computePercent,
	FINISHED_THRESHOLD,
	isFinished,
	nearestAnchor
} from './progress';

describe('computePercent', () => {
	it('computes the scrolled fraction', () => {
		// scrollable range is 2000 - 1000 = 1000; scrolled 500 => 0.5
		expect(computePercent(500, 2000, 1000)).toBe(0.5);
		expect(computePercent(0, 2000, 1000)).toBe(0);
		expect(computePercent(1000, 2000, 1000)).toBe(1);
	});

	it('clamps out-of-range scroll positions', () => {
		expect(computePercent(-50, 2000, 1000)).toBe(0);
		expect(computePercent(5000, 2000, 1000)).toBe(1);
	});

	it('treats fully-visible content as finished', () => {
		expect(computePercent(0, 800, 1000)).toBe(1);
	});
});

describe('isFinished', () => {
	it('flips at the finished threshold', () => {
		expect(FINISHED_THRESHOLD).toBe(0.95);
		expect(isFinished(FINISHED_THRESHOLD)).toBe(true);
		expect(isFinished(0.96)).toBe(true);
		expect(isFinished(1)).toBe(true);
		expect(isFinished(0.94)).toBe(false);
		expect(isFinished(0.5)).toBe(false);
	});
});

describe('nearestAnchor', () => {
	const candidates = [
		{ selector: 'a', top: 0 },
		{ selector: 'b', top: 500 },
		{ selector: 'c', top: 1200 }
	];

	it('returns the last element at or above the scroll position', () => {
		expect(nearestAnchor(candidates, 0)).toBe('a');
		expect(nearestAnchor(candidates, 600)).toBe('b');
		expect(nearestAnchor(candidates, 1300)).toBe('c');
	});

	it('falls back to the first candidate when scrolled above all', () => {
		expect(nearestAnchor(candidates, -100)).toBe('a');
	});

	it('returns null when there are no candidates', () => {
		expect(nearestAnchor([], 0)).toBeNull();
	});
});

describe('childSelector', () => {
	it('builds a 1-based scoped nth-child selector', () => {
		expect(childSelector(0)).toBe(':scope > *:nth-child(1)');
		expect(childSelector(4)).toBe(':scope > *:nth-child(5)');
	});
});
