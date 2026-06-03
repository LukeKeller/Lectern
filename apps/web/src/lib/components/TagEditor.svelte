<script lang="ts">
	import { getSync } from '$lib/sync';

	let { id, tags }: { id: string; tags: string[] } = $props();

	let draft = $state('');

	function commit(next: string[]) {
		const sync = getSync();
		void sync.enqueue({ type: 'setTags', id, tags: next }).then(() => sync.flush());
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		const name = draft.trim();
		if (!name || tags.includes(name)) {
			draft = '';
			return;
		}
		commit([...tags, name]);
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
		font-size: 0.78rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.tag button {
		border: 0;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.9rem;
		line-height: 1;
		padding: 0;
	}
	input {
		font-size: 0.82rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
	}
</style>
