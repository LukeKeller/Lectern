/**
 * Release notes shown on the /changelog page and in the "What's New" overlay.
 * Single source of truth — newest first. `version` matches the deployed `~ynh`
 * build (sans the `~ynhN` suffix); bump this list when you cut a release.
 */

export type ChangeKind = 'added' | 'improved' | 'fixed';

export interface Change {
	kind: ChangeKind;
	text: string;
}

export interface Release {
	version: string;
	date: string;
	title: string;
	changes: Change[];
}

export const KIND_LABEL: Record<ChangeKind, string> = {
	added: 'New',
	improved: 'Improved',
	fixed: 'Fixed'
};

export const releases: Release[] = [
	{
		version: '0.6.2',
		date: '2026-06-04',
		title: 'Listen polish',
		changes: [
			{
				kind: 'fixed',
				text: 'Voice selection no longer errors — a set of built-in ElevenLabs voices is always available, even when your API key cannot list your account voices.'
			},
			{
				kind: 'added',
				text: 'Pick the voice right from the player, start listening from inside an article (not just the card), and see the listen queue as a Playlist in the sidebar.'
			},
			{
				kind: 'improved',
				text: 'Card dates now show the full publication date and time instead of just “today”.'
			},
			{
				kind: 'fixed',
				text: 'Mobile swipe actions: the action panels no longer peek out before you swipe, and swiping no longer drags the header along with the card.'
			}
		]
	},
	{
		version: '0.6.1',
		date: '2026-06-03',
		title: 'Swipe actions',
		changes: [
			{
				kind: 'added',
				text: 'On touch screens, swipe a card right to mark it read or unread, or left to archive it (with an Undo). The per-card buttons stay for mouse and keyboard.'
			}
		]
	},
	{
		version: '0.6.0',
		date: '2026-06-03',
		title: 'Listen (text-to-speech)',
		changes: [
			{
				kind: 'added',
				text: 'Listen to any article read aloud with ElevenLabs. Press the headphones on a card or in the reader to play; audio synthesizes only when you ask and is cached so replays and offline listens are free.'
			},
			{
				kind: 'added',
				text: 'A listen queue with a bottom mini-player — add articles, reorder or remove them, scrub the timeline, and it auto-advances to the next one.'
			},
			{
				kind: 'added',
				text: 'Set your ElevenLabs API key, voice, and model in Settings → Listen. The key stays on the server and is never exposed to the browser.'
			}
		]
	},
	{
		version: '0.5.3',
		date: '2026-06-03',
		title: 'Auto-advance',
		changes: [
			{
				kind: 'added',
				text: 'Auto-advance: archive or move a document with the keyboard and the reader jumps straight to the next one in the list — no trip back to the inbox. Toggle it in Settings → Reading.'
			},
			{
				kind: 'improved',
				text: 'Moving between documents in the reader now fully reloads the article, progress, and notebook — no more stale content when advancing.'
			}
		]
	},
	{
		version: '0.5.2',
		date: '2026-06-03',
		title: 'Sidebar & sorting',
		changes: [
			{
				kind: 'added',
				text: 'Collapsible feeds in the sidebar — expand Feeds to browse folders, then each folder to its publications; click one to read just that feed. Your expanded state is remembered.'
			},
			{
				kind: 'improved',
				text: 'Lists now sort by publication date by default, so the freshest writing is up top.'
			},
			{
				kind: 'improved',
				text: 'The Feed badge now counts only unread items, matching how the new per-feed counts work.'
			}
		]
	},
	{
		version: '0.5.1',
		date: '2026-06-03',
		title: 'What’s new',
		changes: [
			{
				kind: 'added',
				text: 'This changelog — a “What’s new” overlay after each update, plus the full history at /changelog (linked from Settings).'
			}
		]
	},
	{
		version: '0.5.0',
		date: '2026-06-03',
		title: 'Saved-view polish',
		changes: [
			{ kind: 'added', text: 'Give each saved view an emoji icon — it shows in the sidebar.' },
			{
				kind: 'added',
				text: 'Reorder saved views (move up/down) and pin/unpin them from the Views page.'
			},
			{
				kind: 'added',
				text: 'Live item-count badges on saved views, in the sidebar and the Views page.'
			}
		]
	},
	{
		version: '0.4.9',
		date: '2026-06-03',
		title: 'Power filter bar',
		changes: [
			{
				kind: 'added',
				text: 'Filter any list by source (RSS / Saved), type, read state, tag, and a quick title/site/author search.'
			},
			{
				kind: 'improved',
				text: 'Filters compose, stay relevant to what is showing, and persist per list.'
			}
		]
	},
	{
		version: '0.4.8',
		date: '2026-06-03',
		title: 'Cover thumbnails',
		changes: [
			{
				kind: 'added',
				text: 'Cards show a cover image — Readeck’s own image, or the article’s og:image / first image for RSS — falling back to the source mark.'
			}
		]
	},
	{
		version: '0.4.7',
		date: '2026-06-03',
		title: 'Read state + status bar',
		changes: [
			{
				kind: 'added',
				text: 'Opening an RSS article marks it read, so it leaves the unread feed and the newspaper.'
			},
			{
				kind: 'fixed',
				text: '“Mark all read” / “Mark issue read” now actually clear RSS items (they only set progress before).'
			},
			{ kind: 'fixed', text: 'PWA status bar follows light/dark instead of showing a stale blue.' }
		]
	},
	{
		version: '0.4.6',
		date: '2026-06-03',
		title: 'Reader focus mode',
		changes: [
			{
				kind: 'added',
				text: 'Press “f” in the reader to spotlight the current paragraph and dim the rest.'
			}
		]
	},
	{
		version: '0.4.5',
		date: '2026-06-03',
		title: 'Flip-through reading',
		changes: [
			{
				kind: 'added',
				text: 'Open the Newspaper edition or a Magazine issue and flip article-by-article (arrows / swipe / keys) with the full text set in the print style.'
			}
		]
	},
	{
		version: '0.4.4',
		date: '2026-06-03',
		title: 'Newspaper & Magazine redesign',
		changes: [
			{
				kind: 'improved',
				text: 'The Newspaper now reads as a broadsheet front page (masthead, ruled columns, lead splash).'
			},
			{
				kind: 'improved',
				text: 'Magazines became an editorial shelf — cover spreads, contents, and a grid of issue covers.'
			}
		]
	},
	{
		version: '0.4.3',
		date: '2026-06-03',
		title: 'PWA install assets',
		changes: [
			{
				kind: 'fixed',
				text: 'Made the manifest and icons reachable so the installed app shows its real icon and name.'
			}
		]
	},
	{
		version: '0.4.1',
		date: '2026-06-03',
		title: 'Empty library fix + PWA icons',
		changes: [
			{
				kind: 'fixed',
				text: 'A single malformed item no longer breaks sync — feeds and the library populate again.'
			},
			{
				kind: 'added',
				text: 'Real installable app icons (incl. maskable + Apple touch) and a matching theme colour.'
			}
		]
	},
	{
		version: '0.4.0',
		date: '2026-06-03',
		title: 'Daily desk',
		changes: [
			{ kind: 'added', text: 'A daily Newspaper built from your unread feed items.' },
			{ kind: 'added', text: 'Magazines that group your saved library by tag.' }
		]
	},
	{
		version: '0.3.0',
		date: '2026-06-03',
		title: 'Reading polish + library upgrades',
		changes: [
			{ kind: 'added', text: 'Find-in-document and a reading-progress readout in the reader.' },
			{
				kind: 'added',
				text: 'Read-status tabs, bulk actions, and smart default views in the library.'
			}
		]
	}
];

/** The current release line (drops the `~ynhN` suffix and ` (sha)` from APP_VERSION). */
export function releaseVersion(appVersion: string): string {
	return appVersion.split('~')[0]?.split(' ')[0]?.trim() ?? appVersion;
}
