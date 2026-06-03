<script lang="ts">
	import type { Feed, FeedFolder } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { getClient } from '$lib/config';
	import { readOpmlFile } from '$lib/opml';

	interface FeedGroup {
		id: string | null;
		title: string;
		feeds: Feed[];
	}

	let feeds = $state<Feed[]>([]);
	let folders = $state<FeedFolder[]>([]);
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	let busy = $state(false);

	let newFeedUrl = $state('');
	let newFolderId = $state('');

	let refreshMessage = $state<string | undefined>(undefined);
	let importMessage = $state<string | undefined>(undefined);

	const grouped = $derived.by<FeedGroup[]>(() => {
		const byFolder: Record<string, Feed[]> = {};
		const loose: Feed[] = [];
		for (const feed of feeds) {
			if (feed.folderId) (byFolder[feed.folderId] ??= []).push(feed);
			else loose.push(feed);
		}
		const groups: FeedGroup[] = folders.map((folder) => ({
			id: folder.id,
			title: folder.title,
			feeds: byFolder[folder.id] ?? []
		}));
		// Surface folders that feeds reference but the folder list omitted.
		for (const feed of feeds) {
			if (feed.folderId && !groups.some((g) => g.id === feed.folderId)) {
				groups.push({
					id: feed.folderId,
					title: feed.folderTitle ?? feed.folderId,
					feeds: byFolder[feed.folderId] ?? []
				});
			}
		}
		if (loose.length) groups.push({ id: null, title: 'Uncategorized', feeds: loose });
		return groups.filter((g) => g.feeds.length > 0);
	});

	async function load() {
		loading = true;
		error = undefined;
		try {
			const res = await getClient().listFeeds();
			feeds = res.feeds;
			folders = res.folders;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load feeds.';
		} finally {
			loading = false;
		}
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		error = undefined;
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong.';
		} finally {
			busy = false;
		}
	}

	function subscribe(event: SubmitEvent) {
		event.preventDefault();
		const feedUrl = newFeedUrl.trim();
		if (!feedUrl) return;
		void run(async () => {
			await getClient().subscribeFeed({
				feedUrl,
				folderId: newFolderId || undefined
			});
			newFeedUrl = '';
			newFolderId = '';
			await load();
		});
	}

	function rename(feed: Feed) {
		const title = feed.title.trim();
		if (!title) return;
		void run(async () => {
			await getClient().updateFeed(feed.id, { title });
			await load();
		});
	}

	function move(feed: Feed, folderId: string) {
		void run(async () => {
			await getClient().updateFeed(feed.id, { folderId: folderId || null });
			await load();
		});
	}

	function unsubscribe(feed: Feed) {
		void run(async () => {
			await getClient().deleteFeed(feed.id);
			await load();
		});
	}

	function refreshAll() {
		refreshMessage = undefined;
		void run(async () => {
			await getClient().refreshFeeds();
			refreshMessage = 'Refresh queued.';
			await load();
		});
	}

	function onImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importMessage = undefined;
		void run(async () => {
			const opml = await readOpmlFile(file);
			const res = await getClient().importOpml({ opml });
			importMessage = res.message;
			input.value = '';
			await load();
		});
	}

	onMount(load);
</script>

<div class="page">
	<h1>Feeds</h1>

	<section>
		<h2>Subscribe</h2>
		<form class="row" onsubmit={subscribe}>
			<input
				type="url"
				bind:value={newFeedUrl}
				placeholder="https://example.com/feed.xml"
				autocomplete="off"
				required
			/>
			<div class="select">
				<select bind:value={newFolderId} aria-label="Folder">
					<option value="">No folder</option>
					{#each folders as folder (folder.id)}
						<option value={folder.id}>{folder.title}</option>
					{/each}
				</select>
			</div>
			<button type="submit" class="btn primary" disabled={busy}>Subscribe</button>
		</form>
	</section>

	<section>
		<h2>Manage</h2>
		<div class="row">
			<button type="button" class="btn" onclick={refreshAll} disabled={busy}>Refresh all</button>
			<label class="file-btn">
				Import OPML
				<input type="file" accept=".opml,.xml,text/xml,application/xml" onchange={onImport} />
			</label>
		</div>
		{#if refreshMessage}<p class="ok">{refreshMessage}</p>{/if}
		{#if importMessage}<p class="ok">{importMessage}</p>{/if}
	</section>

	{#if error}<p class="error">{error}</p>{/if}

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if grouped.length === 0}
		<p class="muted">No feeds yet. Subscribe above to get started.</p>
	{:else}
		{#each grouped as group (group.id ?? '\u0000')}
			<section>
				<h2>{group.title}</h2>
				<ul class="feeds">
					{#each group.feeds as feed (feed.id)}
						<li>
							<div class="feed-head">
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									class="feed-title"
									href={feed.siteUrl ?? feed.feedUrl}
									target="_blank"
									rel="noreferrer"
								>
									{feed.title}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{#if feed.unreadCount > 0}<span class="unread">{feed.unreadCount}</span>{/if}
							</div>
							<div class="feed-actions">
								<input
									class="title-edit"
									type="text"
									bind:value={feed.title}
									aria-label="Feed title"
								/>
								<button type="button" class="btn sm" onclick={() => rename(feed)} disabled={busy}>
									Rename
								</button>
								<div class="select sm">
									<select
										value={feed.folderId ?? ''}
										onchange={(e) => move(feed, e.currentTarget.value)}
										disabled={busy}
										aria-label="Move to folder"
									>
										<option value="">Uncategorized</option>
										{#each folders as folder (folder.id)}
											<option value={folder.id}>{folder.title}</option>
										{/each}
									</select>
								</div>
								<button
									type="button"
									class="btn sm danger"
									onclick={() => unsubscribe(feed)}
									disabled={busy}
								>
									Unsubscribe
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>

<style>
	h1 {
		font-size: var(--text-2xl);
		margin-bottom: 1.6rem;
	}
	section {
		margin-bottom: 2.2rem;
	}
	h2 {
		font-size: var(--text-md);
		margin-bottom: 0.7rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.feeds {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.feeds li {
		padding: 0.75rem 0.7rem;
		border-radius: var(--radius);
		transition: background var(--dur-fast) var(--ease);
	}
	.feeds li:hover {
		background: var(--surface-alt);
	}
	.feed-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.feed-title {
		font-weight: 600;
		color: var(--text);
	}
	.feed-title:hover {
		color: var(--accent);
	}
	.unread {
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.feed-actions {
		margin-top: 0.55rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	input,
	select {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		background: var(--surface);
		color: var(--text);
		transition: border-color var(--dur-fast) var(--ease);
	}
	input:focus,
	select:focus {
		border-color: var(--accent);
		outline: none;
	}
	input[type='url'] {
		flex: 1;
		min-width: 14rem;
		font-size: var(--text-base);
	}
	.title-edit {
		min-width: 11rem;
	}
	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.select::after {
		content: '';
		position: absolute;
		right: 0.6rem;
		width: 0.4rem;
		height: 0.4rem;
		border-right: 1.5px solid var(--text-muted);
		border-bottom: 1.5px solid var(--text-muted);
		transform: translateY(-2px) rotate(45deg);
		pointer-events: none;
	}
	select {
		appearance: none;
		padding-right: 1.6rem;
		cursor: pointer;
	}
	.btn {
		padding: 0.42rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}
	.btn:hover {
		border-color: var(--border-strong);
		background: var(--surface-alt);
	}
	.btn.sm {
		padding: 0.3rem 0.6rem;
		font-size: var(--text-sm);
	}
	.btn.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.btn.primary:hover {
		background: color-mix(in srgb, var(--accent) 88%, #000);
	}
	.btn.danger:hover {
		border-color: var(--error);
		color: var(--error);
		background: transparent;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.file-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.42rem 0.85rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	.file-btn:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.file-btn input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.ok {
		color: var(--ok);
		font-size: var(--text-sm);
		margin: 0.6rem 0 0;
	}
	.error {
		color: var(--error);
		font-size: var(--text-sm);
	}
	.muted {
		color: var(--text-muted);
	}
</style>
