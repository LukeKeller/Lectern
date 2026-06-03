import { liveQuery } from 'dexie';
import { onMount } from 'svelte';

/**
 * Bind a Dexie `liveQuery` to reactive state. The query re-runs whenever the
 * underlying tables change, so lists stay in sync with optimistic mutations and
 * pulled deltas. Subscription is set up on mount and torn down on destroy.
 */
export function liveCards<T>(query: () => Promise<T>): { readonly value: T | undefined } {
	let value = $state<T | undefined>(undefined);
	onMount(() => {
		const sub = liveQuery(query).subscribe({
			next: (v) => {
				value = v;
			}
		});
		return () => sub.unsubscribe();
	});
	return {
		get value() {
			return value;
		}
	};
}
