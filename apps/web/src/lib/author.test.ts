import { describe, expect, it } from 'vitest';
import { displayAuthor } from './author';

describe('displayAuthor', () => {
	it('shows the parenthesized display name from "email (Name)" forms', () => {
		expect(displayAuthor('marius@xn--gckvb8fzb.com (Marius)')).toBe('Marius');
	});

	it('shows the display name from "Name <email>" forms', () => {
		expect(displayAuthor('Jane Doe <jane@example.com>')).toBe('Jane Doe');
		expect(displayAuthor('"Jane Doe" <jane@example.com>')).toBe('Jane Doe');
	});

	it('falls back to a humanized local part for bare addresses', () => {
		expect(displayAuthor('jane.doe@example.com')).toBe('Jane Doe');
		expect(displayAuthor('<jane@example.com>')).toBe('Jane');
	});

	it('passes plain names through untouched', () => {
		expect(displayAuthor('Maria Popova')).toBe('Maria Popova');
		expect(displayAuthor('  Maria Popova  ')).toBe('Maria Popova');
	});
});
