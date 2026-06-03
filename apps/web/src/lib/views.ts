import { parse, serialize } from '@lectern/shared';
import type { Location, QueryNode } from '@lectern/shared';

/**
 * Saved-view helpers built on the shared query AST. Predefined views map the
 * triage locations onto query nodes; custom views are persisted through the API
 * as ASTs. `serialize`/`parse` from `@lectern/shared` round-trip the AST to the
 * text form shown in the UI and typed by the user.
 */

/** A built-in view backed by a fixed list route. */
export interface PredefinedView {
	id: string;
	name: string;
	path: '/' | '/feed' | '/library';
	query: QueryNode;
}

/** A query term matching a single triage location. */
export function locationQuery(location: Location): QueryNode {
	return { kind: 'term', field: 'location', op: 'eq', value: location };
}

/** A query term matching cards carrying a tag. */
export function tagQuery(tag: string): QueryNode {
	return { kind: 'term', field: 'tag', op: 'has', value: tag };
}

/** Combine nodes with AND, flattening the trivial single-node case. */
export function andQueries(...nodes: QueryNode[]): QueryNode {
	const flat = nodes.filter((n): n is QueryNode => n != null);
	if (flat.length === 1) return flat[0]!;
	return { kind: 'and', nodes: flat };
}

/** Combine nodes with OR, flattening the trivial single-node case. */
export function orQueries(...nodes: QueryNode[]): QueryNode {
	const flat = nodes.filter((n): n is QueryNode => n != null);
	if (flat.length === 1) return flat[0]!;
	return { kind: 'or', nodes: flat };
}

/** The built-in views surfaced in the nav and command palette. */
export const PREDEFINED_VIEWS: PredefinedView[] = [
	{ id: 'inbox', name: 'Inbox', path: '/', query: locationQuery('inbox') },
	{ id: 'later', name: 'Later', path: '/', query: locationQuery('later') },
	{ id: 'shortlist', name: 'Shortlist', path: '/library', query: locationQuery('shortlist') },
	{ id: 'archive', name: 'Archive', path: '/library', query: locationQuery('archive') },
	{ id: 'feed', name: 'Feed', path: '/feed', query: locationQuery('feed') }
];

/** Serialize an AST to its text form for display/storage. */
export function viewQueryString(node: QueryNode): string {
	return serialize(node);
}

/** Parse text typed by the user back into an AST. Throws on malformed input. */
export function parseViewQuery(text: string): QueryNode {
	return parse(text);
}
