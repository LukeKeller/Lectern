<script lang="ts">
	import { onMount } from 'svelte';
	import { getApiUrl, getToken, setToken } from '$lib/config';

	let token = $state('');
	let saved = $state(false);
	const apiUrl = getApiUrl();

	onMount(() => {
		token = getToken() ?? '';
	});

	function save(event: SubmitEvent) {
		event.preventDefault();
		setToken(token.trim());
		saved = true;
	}
</script>

<h1>Settings</h1>

<form onsubmit={save}>
	<label>
		API URL
		<input type="text" value={apiUrl} readonly />
	</label>
	<label>
		Bearer token
		<input type="password" bind:value={token} placeholder="paste token" autocomplete="off" />
	</label>
	<button type="submit">Save token</button>
	{#if saved}<span class="ok">Saved.</span>{/if}
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 420px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
		color: #52606d;
	}
	input {
		padding: 0.5rem;
		border: 1px solid #cbd2d9;
		border-radius: 6px;
		font-size: 1rem;
	}
	button {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		border: 1px solid #cbd2d9;
		border-radius: 6px;
		background: #f5f7fa;
		cursor: pointer;
	}
	.ok {
		color: #2f855a;
		font-size: 0.85rem;
	}
</style>
