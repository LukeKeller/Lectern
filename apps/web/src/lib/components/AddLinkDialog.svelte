<script lang="ts">
	import type { Location } from '@lectern/shared';
	import { tick } from 'svelte';
	import { getClient } from '$lib/config';
	import { getSync } from '$lib/sync';
	import { trapFocus } from '$lib/focus-trap';
	import Icon from '$lib/components/Icon.svelte';

	// `open` is bindable so the layout can toggle the dialog from the bottom nav's
	// Add button or the sidebar's "Add link" entry. `location` is where the saved
	// card lands; defaults to the inbox triage bucket.
	let {
		open = $bindable(false),
		location = 'inbox' as Location
	}: { open?: boolean; location?: Location } = $props();

	type Status = 'idle' | 'saving' | 'saved' | 'error';
	let status = $state<Status>('idle');
	let url = $state('');
	let error = $state('');
	let input = $state<HTMLInputElement | null>(null);

	const LOCATION_LABEL: Partial<Record<Location, string>> = {
		inbox: 'Inbox',
		later: 'Later',
		archive: 'Archive'
	};

	function isHttpUrl(value: string): boolean {
		return /^https?:\/\/\S+$/i.test(value.trim());
	}

	// On open, reset and focus the field, then try to pre-fill from the clipboard
	// so saving a link the user just copied is a single tap. Clipboard access can
	// reject (permissions / unsupported); that's fine — the field stays empty.
	$effect(() => {
		if (!open) return;
		status = 'idle';
		url = '';
		error = '';
		void tick().then(async () => {
			input?.focus();
			try {
				const text = (await navigator.clipboard?.readText())?.trim();
				if (text && isHttpUrl(text)) {
					url = text;
					input?.select();
				}
			} catch {
				// No clipboard permission or unsupported — leave the field empty.
			}
		});
	});

	async function save() {
		const value = url.trim();
		if (!isHttpUrl(value)) {
			error = 'Enter a valid http(s) link.';
			status = 'error';
			input?.focus();
			return;
		}
		status = 'saving';
		error = '';
		try {
			await getClient().saveDocument({ url: value, tags: [], location });
			status = 'saved';
			// Pull so the new card appears in the local mirror without waiting for
			// the next poll, then dismiss after a brief confirmation.
			void getSync().pull();
			setTimeout(() => {
				open = false;
			}, 900);
		} catch (err) {
			status = 'error';
			error = err instanceof Error ? err.message : 'Could not save the link.';
			input?.focus();
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (status !== 'saving') void save();
		}
	}
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close save dialog"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Enter' && (open = false)}
	></div>
	<div class="dialog" role="dialog" aria-modal="true" aria-label="Save a link" use:trapFocus>
		{#if status === 'saved'}
			<div class="done">
				<span class="glyph"><Icon name="check" size={26} /></span>
				<p>Saved to {LOCATION_LABEL[location] ?? location}.</p>
			</div>
		{:else}
			<div class="head">
				<h2>Save a link</h2>
				<button type="button" class="icon-btn" aria-label="Close" onclick={() => (open = false)}>
					<Icon name="close" size={18} />
				</button>
			</div>
			<input
				bind:this={input}
				bind:value={url}
				{onkeydown}
				type="url"
				inputmode="url"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				placeholder="https://…"
				aria-label="Link to save"
				aria-invalid={status === 'error'}
			/>
			{#if status === 'error'}
				<p class="error" role="alert">{error}</p>
			{/if}
			<div class="foot">
				<span class="dest">Saves to {LOCATION_LABEL[location] ?? location}</span>
				<div class="actions">
					<button type="button" class="ghost" onclick={() => (open = false)}>Cancel</button>
					<button
						type="button"
						class="primary"
						disabled={status === 'saving'}
						onclick={() => void save()}
					>
						{status === 'saving' ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 16, 10, 0.34);
		border: 0;
		z-index: 60;
		animation: fade var(--dur-fast) var(--ease);
	}
	.dialog {
		position: fixed;
		top: 16vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(460px, 92vw);
		padding: 1.1rem 1.15rem 1rem;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
		z-index: 61;
		animation: pop var(--dur) var(--ease);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		min-height: 2rem;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease);
	}
	.icon-btn:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-md);
		background: var(--bg);
		color: var(--text);
		outline: none;
		transition: border-color var(--dur-fast) var(--ease);
	}
	input:focus {
		border-color: var(--accent);
	}
	input[aria-invalid='true'] {
		border-color: var(--error);
	}
	input::placeholder {
		color: var(--text-muted);
	}
	.error {
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--error);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.9rem;
	}
	.dest {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.ghost,
	.primary {
		padding: 0.5rem 0.95rem;
		border-radius: var(--radius);
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease),
			opacity var(--dur-fast) var(--ease);
	}
	.ghost {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
	}
	.ghost:hover {
		background: var(--surface-alt);
		color: var(--text);
	}
	.primary {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.done {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
		text-align: center;
		padding: 0.5rem 0;
	}
	.done p {
		margin: 0;
		font-size: var(--text-md);
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-6px) scale(0.98);
		}
	}
</style>
