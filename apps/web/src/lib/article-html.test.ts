import { describe, expect, it } from 'vitest';
import { cleanArticleHtml, titlesMatch } from './article-html';

describe('titlesMatch', () => {
	it('matches identical titles regardless of case and punctuation', () => {
		expect(titlesMatch('Hello, World — a Story', 'hello world a story')).toBe(true);
	});

	it('matches truncated variants when the overlap is substantial', () => {
		expect(
			titlesMatch('The Rise and Fall of Everything', 'The Rise and Fall of Everything — Example Site')
		).toBe(true);
	});

	it('rejects short or unrelated headings', () => {
		expect(titlesMatch('Intro', 'A completely different article title')).toBe(false);
		expect(titlesMatch('', 'Some title')).toBe(false);
	});
});

describe('cleanArticleHtml', () => {
	it('returns input unchanged when no DOM is available (node test env)', () => {
		const html = '<h1>Title</h1><p>Body</p>';
		expect(cleanArticleHtml(html, 'Title')).toBe(html);
	});
});
