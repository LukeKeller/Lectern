import MiniSearch from 'minisearch';
import type { Card } from '@lectern/shared';

/**
 * Client-side full-text search over the cached library. Builds a MiniSearch
 * index from the locally mirrored cards (title/author/site/tags) so search works
 * live and fully offline. Index construction and querying are pure functions of
 * their inputs, making relevance testable without IndexedDB or the network.
 */

export interface IndexDoc {
	id: string;
	title: string;
	author: string;
	siteName: string;
	tags: string;
}

const FIELDS = ['title', 'author', 'siteName', 'tags'] as const;

/** Project a card into the flat shape MiniSearch indexes. */
export function toIndexDoc(card: Card): IndexDoc {
	return {
		id: card.id,
		title: card.title,
		author: card.author ?? '',
		siteName: card.siteName ?? '',
		tags: card.tags.join(' ')
	};
}

function createIndex(): MiniSearch<IndexDoc> {
	return new MiniSearch<IndexDoc>({
		fields: [...FIELDS],
		storeFields: ['id'],
		// Title matches dominate; site/tag matches still surface.
		searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3, tags: 2 } }
	});
}

/** Build a fresh index over the given cards. */
export function buildIndex(cards: Card[]): MiniSearch<IndexDoc> {
	const index = createIndex();
	index.addAll(cards.map(toIndexDoc));
	return index;
}

/** Query the index, returning matching card ids in descending relevance order. */
export function searchIndex(index: MiniSearch<IndexDoc>, query: string): string[] {
	const q = query.trim();
	if (!q) return [];
	return index.search(q).map((r) => String(r.id));
}
