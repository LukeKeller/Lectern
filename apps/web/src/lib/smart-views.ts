import type { Card } from '@lectern/shared';
import type { IconName } from '$lib/components/Icon.svelte';

/**
 * Built-in "smart" collections: dynamic views computed from card fields rather
 * than a triage location or a saved query AST. Each is reachable at
 * `/collections/[key]` and listed in the sidebar with a live count.
 */
export interface SmartView {
	key: string;
	label: string;
	icon: IconName;
	predicate: (c: Card) => boolean;
}

export const SMART_VIEWS: SmartView[] = [
	{
		key: 'continue',
		label: 'Continue reading',
		icon: 'book',
		predicate: (c) => c.location !== 'feed' && c.readingProgress > 0 && c.readingProgress < 0.99
	},
	{
		key: 'quick',
		label: 'Quick reads',
		icon: 'clock',
		predicate: (c) => c.location !== 'feed' && !!c.readingTimeMinutes && c.readingTimeMinutes <= 10
	},
	{
		key: 'long',
		label: 'Long reads',
		icon: 'book',
		predicate: (c) => c.location !== 'feed' && !!c.readingTimeMinutes && c.readingTimeMinutes >= 30
	},
	{
		key: 'highlights',
		label: 'Highlighted',
		icon: 'highlight',
		predicate: (c) => c.highlightCount > 0
	}
];
