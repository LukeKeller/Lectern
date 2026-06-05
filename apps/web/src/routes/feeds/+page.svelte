<script lang="ts">
	import type { Feed, FeedFolder } from '@lectern/shared';
	import { onMount } from 'svelte';
	import { getClient } from '$lib/config';
	import { readOpmlFile } from '$lib/opml';
	import { groupFeeds } from '$lib/feeds';

	let feeds = $state<Feed[]>([]);
	let folders = $state<FeedFolder[]>([]);
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	let busy = $state(false);

	let newFeedUrl = $state('');
	let newFolderId = $state('');

	let refreshMessage = $state<string | undefined>(undefined);
	let importMessage = $state<string | undefined>(undefined);

	// Per-feed notification prefs, keyed by feed id. Missing => disabled.
	let notifyPrefs = $state<Map<string, boolean>>(new Map());
	const grouped = $derived(groupFeeds(feeds, folders));

	async function loadNotifyPrefs() {
		try {
			const res = await getClient().getFeedNotifications();
			notifyPrefs = new Map(res.feeds.map((f) => [f.feedId, f.enabled]));
		} catch {
			/* offline or push not configured: leave bells in their default (off) state */
		}
	}

	async function toggleNotify(feed: Feed) {
		const current = notifyPrefs.get(feed.id) ?? false;
		const next = !current;
		// Optimistic update (reassign so Svelte tracks the Map change).
		const optimistic = new Map(notifyPrefs);
		optimistic.set(feed.id, next);
		notifyPrefs = optimistic;
		try {
			const pref = await getClient().setFeedNotification(feed.id, next);
			const confirmed = new Map(notifyPrefs);
			confirmed.set(feed.id, pref.enabled);
			notifyPrefs = confirmed;
		} catch (e) {
			// Roll back on failure.
			const rolledBack = new Map(notifyPrefs);
			rolledBack.set(feed.id, current);
			notifyPrefs = rolledBack;
			error = e instanceof Error ? e.message : 'Could not update notifications.';
		}
	}

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

	onMount(() => {
		void load();
		void loadNotifyPrefs();
	});
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
						{@const notifyOn = notifyPrefs.get(feed.id) ?? false}
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
								<button
									type="button"
									class="bell"
									class:on={notifyOn}
									aria-pressed={notifyOn}
									aria-label={`${notifyOn ? 'Disable' : 'Enable'} notifications for ${feed.title}`}
									title={notifyOn ? 'Notifications on' : 'Notifications off'}
									onclick={() => toggleNotify(feed)}
								>
									{#if notifyOn}
										<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
											<path
												fill="currentColor"
												d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-1.6 1.6a.9.9 0 0 0 .64 1.54h13.9a.9.9 0 0 0 .64-1.54L18 16Z"
											/>
										</svg>
									{:else}
										<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
											<path
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M18 16V11a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-1.6 1.6h15.2L18 16Zm-6 6a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Z"
											/>
											<line
												x1="4"
												y1="3.5"
												x2="20"
												y2="20.5"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
											/>
										</svg>
									{/if}
								</button>
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
	.bell {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
	.bell:hover {
		color: var(--text);
		background: var(--surface-alt);
		border-color: var(--border);
	}
	.bell.on {
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
		background: var(--accent-deep);
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
