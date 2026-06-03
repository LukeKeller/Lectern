<script lang="ts">
	// Minimal stub. Full client-side search is D6.
	let query = $state('');
</script>

<h1>Search</h1>
<input type="search" placeholder="Search your library…" bind:value={query} />
<p class="muted">Search lands in D6.</p>

<style>
	input {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #cbd2d9;
		border-radius: 6px;
		font-size: 1rem;
	}
	.muted {
		color: #7b8794;
	}
</style>
