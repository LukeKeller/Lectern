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
</style>
