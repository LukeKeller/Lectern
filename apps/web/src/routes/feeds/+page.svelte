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
		<select bind:value={newFolderId} aria-label="Folder">
			<option value="">No folder</option>
			{#each folders as folder (folder.id)}
				<option value={folder.id}>{folder.title}</option>
			{/each}
		</select>
		<button type="submit" disabled={busy}>Subscribe</button>
	</form>
</section>

<section>
	<h2>Manage</h2>
	<div class="row">
		<button type="button" onclick={refreshAll} disabled={busy}>Refresh all</button>
		<label class="import">
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
			<ul>
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
							<button type="button" onclick={() => rename(feed)} disabled={busy}>Rename</button>
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
							<button
								type="button"
								class="danger"
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

<style>
	section {
		margin-bottom: 2rem;
	}
	h2 {
		font-size: 1rem;
		color: var(--text-muted);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}
	.feed-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.feed-title {
		font-weight: 600;
		color: var(--text);
		text-decoration: none;
	}
	.unread {
		font-size: 0.72rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-alt);
		color: var(--text-muted);
	}
	.feed-actions {
		margin-top: 0.4rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.import {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	input,
	select {
		padding: 0.4rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 0.9rem;
		background: var(--surface);
		color: var(--text);
	}
	.title-edit {
		min-width: 12rem;
	}
	button {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-alt);
		color: var(--text);
		cursor: pointer;
		font-size: 0.85rem;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.danger {
		color: var(--danger, #c0392b);
	}
	.ok {
		color: var(--ok);
		font-size: 0.85rem;
	}
	.error {
		color: var(--danger, #c0392b);
		font-size: 0.85rem;
	}
	.muted {
		color: var(--text-muted);
	}
</style>
