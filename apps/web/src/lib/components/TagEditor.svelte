<script module lang="ts">
	// Module-scoped so cached suggestions survive component remounts and same-doc
	// reloads (see the fetch effect below). Keyed by document id. A plain instance
	// `<script>` const would be rebuilt on every remount, defeating the purpose.
	const suggestionCache = new Map<string, string[]>();
</script>

<script lang="ts">
	import { getSync } from '$lib/sync';
	import { getClient } from '$lib/config';

	let { id, tags }: { id: string; tags: string[] } = $props();

	let draft = $state('');

	// Server-suggested tags (tag-centroid similarity), fetched once per document.
	// Keyed on the document id so a reader→reader hop re-fetches for the new doc.
	// The cache is module-scoped so it outlives component remounts and same-doc
	// reloads: seeding from it keeps the row at its settled height instead of
	// collapsing to empty during the fetch, which was causing the section to flash
	// in and out and jump the page on every reload.
	// Seed the first render from cache (mount-time id only; the effect below keeps
	// it in sync when id changes).
	// svelte-ignore state_referenced_locally
	let suggestions = $state<string[]>(suggestionCache.get(id) ?? []);
	$effect(() => {
		const current = id;
		// Re-seed from cache (not []) so a re-run keeps the previous row visible
		// until the fetch resolves. Only a genuinely uncached doc starts empty.
		suggestions = suggestionCache.get(current) ?? [];
		if (!current) return;
		let cancelled = false;
		void getClient()
			.getTagSuggestions(current)
			.then((r) => {
				const next = r.suggestions.map((s) => s.tag);
				suggestionCache.set(current, next);
				if (!cancelled) suggestions = next;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	// Only surface suggestions the document doesn't already carry; once a chip's
	// tag is applied it drops out of the row via this reactive filter.
	const openSuggestions = $derived(suggestions.filter((tag) => !tags.includes(tag)));

	function commit(next: string[]) {
		const sync = getSync();
		void sync.enqueue({ type: 'setTags', id, tags: next }).then(() => sync.flush());
	}

	function addTag(name: string) {
		if (!name || tags.includes(name)) return;
		commit([...tags, name]);
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		addTag(draft.trim());
		draft = '';
	}

	function remove(tag: string) {
		commit(tags.filter((t) => t !== tag));
	}
</script>

<div class="tag-editor">
	{#each tags as tag (tag)}
		<span class="tag">
			{tag}
			<button type="button" aria-label={`Remove ${tag}`} onclick={() => remove(tag)}>×</button>
		</span>
	{/each}
	<form onsubmit={add}>
		<input bind:value={draft} type="text" placeholder="Add tag…" autocomplete="off" />
	</form>
</div>
{#if openSuggestions.length}
	<div class="tag-suggestions">
		<span class="suggest-label">Suggested:</span>
		{#each openSuggestions as tag (tag)}
			<button
				type="button"
				class="suggest-chip"
				aria-label={`Add tag: ${tag}`}
				onclick={() => addTag(tag)}
			>
				{tag}
			</button>
		{/each}
	</div>
{/if}

<style>
	.tag-editor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
		padding: 0.15rem 0.2rem 0.15rem 0.55rem;
		border-radius: var(--radius-full);
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.tag button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.95rem;
		line-height: 1;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.tag button:hover {
		background: var(--border-strong);
		color: var(--text);
	}
	input {
		font-size: var(--text-sm);
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text);
		width: 7rem;
		transition: border-color var(--dur-fast) var(--ease);
	}
	input:focus {
		border-color: var(--accent);
		outline: none;
	}
	.tag-suggestions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.suggest-label {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	/* Dashed outline (vs the filled applied tags) reads as "not yet applied". */
	.suggest-chip {
		font-size: var(--text-xs);
		padding: 0.15rem 0.55rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.suggest-chip:hover {
		border-color: var(--accent);
		border-style: solid;
		background: var(--surface-alt);
		color: var(--text);
	}
	.suggest-chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
