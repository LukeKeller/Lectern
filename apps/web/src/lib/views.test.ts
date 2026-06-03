import { describe, expect, it } from 'vitest';
import { serialize } from '@lectern/shared';
import {
	andQueries,
	locationQuery,
	orQueries,
	parseViewQuery,
	PREDEFINED_VIEWS,
	tagQuery,
	viewQueryString
} from './views';

describe('query builders', () => {
	it('builds a location term', () => {
		expect(locationQuery('later')).toEqual({
			kind: 'term',
			field: 'location',
			op: 'eq',
			value: 'later'
		});
	});

	it('builds a tag has-term', () => {
		expect(tagQuery('news')).toEqual({ kind: 'term', field: 'tag', op: 'has', value: 'news' });
	});

	it('flattens a single-node and/or', () => {
		const t = locationQuery('inbox');
		expect(andQueries(t)).toEqual(t);
		expect(orQueries(t)).toEqual(t);
	});

	it('combines multiple nodes', () => {
		expect(andQueries(locationQuery('later'), tagQuery('news'))).toEqual({
			kind: 'and',
			nodes: [locationQuery('later'), tagQuery('news')]
		});
	});
});

describe('serialize / parse round-trip', () => {
	it('serializes a location term to text', () => {
		expect(viewQueryString(locationQuery('later'))).toBe('location:later');
		expect(viewQueryString(tagQuery('news'))).toBe('tag:news');
	});

	it('round-trips an OR of locations', () => {
		const node = orQueries(locationQuery('inbox'), locationQuery('later'));
		const text = viewQueryString(node);
		expect(text).toBe('location:inbox OR location:later');
		expect(parseViewQuery(text)).toEqual(node);
	});

	it('round-trips an AND with a tag and a numeric term', () => {
		const node = andQueries(locationQuery('later'), tagQuery('longread'));
		expect(parseViewQuery(viewQueryString(node))).toEqual(node);
		expect(serialize(parseViewQuery('words:>2000 AND location:later'))).toBe(
			'words:>2000 AND location:later'
		);
	});

	it('throws on malformed query text', () => {
		expect(() => parseViewQuery('not a query :::')).toThrow();
	});
});

describe('PREDEFINED_VIEWS', () => {
	it('covers the five triage locations with valid queries', () => {
		const names = PREDEFINED_VIEWS.map((v) => v.name);
		expect(names).toEqual(['Inbox', 'Later', 'Shortlist', 'Archive', 'Feed']);
		for (const v of PREDEFINED_VIEWS) {
			// Each predefined query is a serializable, re-parseable location term.
			expect(parseViewQuery(viewQueryString(v.query))).toEqual(v.query);
		}
	});
});
