import { describe, expect, it } from 'vitest';
import { cleanArticleHtml, stripInlineColors, titlesMatch } from './article-html';

describe('stripInlineColors', () => {
	it('drops colour, background and text-fill declarations', () => {
		expect(stripInlineColors('color: #ccc; text-align: center; background: #111')).toBe(
			'text-align: center'
		);
		expect(stripInlineColors('BACKGROUND-COLOR:#fff;-webkit-text-fill-color:#eee')).toBe('');
	});

	it('keeps non-colour declarations intact', () => {
		expect(stripInlineColors('font-weight: 700; margin: 0')).toBe('font-weight: 700; margin: 0');
	});

	it('does not strip properties that merely contain "color" mid-name', () => {
		expect(stripInlineColors('caret-color: red; border-color: blue')).toBe(
			'caret-color: red; border-color: blue'
		);
	});
});

describe('titlesMatch', () => {
	it('matches identical titles regardless of case and punctuation', () => {
		expect(titlesMatch('Hello, World — a Story', 'hello world a story')).toBe(true);
	});

	it('matches truncated variants when the overlap is substantial', () => {
		expect(
			titlesMatch(
				'The Rise and Fall of Everything',
				'The Rise and Fall of Everything — Example Site'
			)
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
