import type { Card } from '@lectern/shared';

/**
 * "Magazines": themed issues assembled from saved library items that share a
 * tag, so a backlog of read-later articles surfaces as curated collections of
 * related reading rather than one long undifferentiated list. Pure over the card
 * list, like the newspaper, so it runs offline and is trivial to unit-test.
 */

/** A themed collection of related saved articles. */
export interface Magazine {
	tag: string;
	cards: Card[];
}

/** Library items only — everything saved that isn't a transient feed item. */
export function isLibraryItem(card: Card): boolean {
	return card.location !== 'feed';
}

/**
 * Group saved library items into magazines by shared tag. Only tags carried by
 * `minItems`+ documents qualify, so each issue reads as a collection of related
 * reading. Issues are ordered by size (biggest first), articles newest-first.
 */
export function buildMagazines(cards: Card[], minItems = 2): Magazine[] {
	const map = new Map<string, Card[]>();
	for (const c of cards) {
		if (!isLibraryItem(c)) continue;
		for (const tag of c.tags) {
			const bucket = map.get(tag);
			if (bucket) bucket.push(c);
			else map.set(tag, [c]);
		}
	}
	const issues: Magazine[] = [];
	for (const [tag, list] of map) {
		if (list.length < minItems) continue;
		list.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
		issues.push({ tag, cards: list });
	}
	issues.sort((a, b) => b.cards.length - a.cards.length || a.tag.localeCompare(b.tag));
	return issues;
}
