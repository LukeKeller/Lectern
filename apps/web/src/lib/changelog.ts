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
		version: '0.16.0',
		date: '2026-06-05',
		title: 'Push notifications for the feeds you care about',
		changes: [
			{
				kind: 'added',
				text: 'Lectern can now push a notification to your phone when new stories land in feeds you pick. Add Lectern to your home screen, switch on notifications under Settings, then tap the bell beside any feed on the Feeds page. New articles are batched into a single quiet notification per feed, and tapping it opens your feed.'
			}
		]
	},
	{
		version: '0.15.0',
		date: '2026-06-05',
		title: 'Richer newspaper and magazine reading',
		changes: [
			{
				kind: 'improved',
				text: 'The Newspaper and Magazine now read like real print. The edition sits on a sheet of newsprint with a faint paper grain; the Magazine opens like a spread, with the contents on a printed leaf beside the cover. Reading a story gains drop caps, small-cap openings, editorial section breaks and an end-of-article mark.'
			},
			{
				kind: 'added',
				text: 'You can now mark stories as read while reading through the Newspaper. Turning to the next story quietly marks the last one read, and a Read toggle in the header lets you set it either way.'
			}
		]
	},
	{
		version: '0.14.0',
		date: '2026-06-04',
		title: 'Free self-hosted text-to-speech, and ElevenLabs usage at a glance',
		changes: [
			{
				kind: 'added',
				text: 'Listen now works with Kokoro — a free, high-quality speech engine you run on your own server — as an alternative to ElevenLabs. Pick your engine under Settings → Listen: ElevenLabs needs an API key, while Kokoro needs no key and has no usage limits. Set up the Kokoro service once (see the operator docs) and choose from its voices.'
			},
			{
				kind: 'added',
				text: 'When you use ElevenLabs, Settings → Listen now shows your usage this billing period — characters used, characters remaining, your plan tier, and the date your quota resets — so you can see at a glance how much synthesis you have left.'
			}
		]
	},
	{
		version: '0.13.1',
		date: '2026-06-04',
		title: 'Add to podcast from the article menu',
		changes: [
			{
				kind: 'added',
				text: 'You can now add an article to your podcast feed straight from its ⋯ menu in any list — no need to open the article first. It sits alongside Listen and Add to queue, and shows its progress while the audio renders.'
			}
		]
	},
	{
		version: '0.13.0',
		date: '2026-06-04',
		title: 'Listen to your articles as a podcast',
		changes: [
			{
				kind: 'added',
				text: 'Turn any saved article into a podcast episode. Open an article and tap the new RSS button to have it read aloud and added to your own private podcast feed — then subscribe in Apple Podcasts, Pocket Casts, Overcast, or any podcast app and listen anywhere, even offline. Find your personal feed URL under Settings → Podcast feed (keep it private — anyone with the link can hear your episodes; you can regenerate it any time to revoke old links).'
			}
		]
	},
	{
		version: '0.12.0',
		date: '2026-06-04',
		title: 'Better reading in the newspaper and magazines',
		changes: [
			{
				kind: 'improved',
				text: 'A newspaper story no longer reads as two full-height columns — running down one and back up to the top of the next. The text is now set in short stacked bands, the way a printed page breaks a story into manageable blocks, so reading flows steadily downward. Headings, photos, and pull quotes span the full width between bands as natural section breaks.'
			},
			{
				kind: 'improved',
				text: 'Magazine covers now carry real cover art. Each issue borrows the lead article’s image, tinted into the publication’s own colour, so the shelf reads like a rack of distinct titles rather than coloured placeholders.'
			},
			{
				kind: 'improved',
				text: 'Reading a magazine issue feels more like a feature: a title-page masthead, a lead image to open each article, a drop cap on the first paragraph, and a printer’s ornament marking the break between stories.'
			}
		]
	},
	{
		version: '0.11.2',
		date: '2026-06-04',
		title: 'A more consistent finish',
		changes: [
			{
				kind: 'fixed',
				text: 'Finished articles no longer show a stray green bar. A read item is marked simply by its dimmed title, and the thin progress line now appears only while you are partway through something — tucked just inside the row so it reads as a progress meter, not a divider.'
			},
			{
				kind: 'improved',
				text: 'The top bar and the reader header are now solid in every theme instead of frosted glass, so text stays crisp as the page scrolls beneath them.'
			},
			{
				kind: 'improved',
				text: 'Magazine covers lie flat like real stock — the glossy sheen is gone, and depth is saved for when you hover an issue to open it.'
			},
			{
				kind: 'improved',
				text: 'A consistency pass across colours, spacing, and quotations so every one of the seven themes stays true to the paper feel: button hovers, swipe actions, and blockquotes now draw from the active theme palette.'
			}
		]
	},
	{
		version: '0.11.1',
		date: '2026-06-04',
		title: 'Skip internal mail',
		changes: [
			{
				kind: 'added',
				text: 'Newsletter ingestion can now ignore specific senders. Add a comma-separated list of From addresses under Settings → Newsletter ingestion to keep internal or system mail (server diagnostics, cron) out of your library.'
			}
		]
	},
	{
		version: '0.11.0',
		date: '2026-06-04',
		title: 'A cleaner reading list',
		changes: [
			{
				kind: 'improved',
				text: 'The list now reads like a magazine index: entries are grouped under date headings (Today, Yesterday, Earlier this week…), titles are set as serif headlines, and cover images appear only where they earn their place — so a long read and a quick link no longer look identical.'
			},
			{
				kind: 'improved',
				text: 'The toolbar is calmer. Source, type, and tag filters now tuck behind a single Filter button, and the bulk actions moved into a tidy list menu — leaving the page to your reading.'
			},
			{
				kind: 'improved',
				text: 'Every row keeps a visible handle for its actions instead of hiding them until you hover, and empty lists now explain what belongs there.'
			},
			{
				kind: 'fixed',
				text: 'Mark all read and Archive all can now be undone, just like swiping a single card away.'
			}
		]
	},
	{
		version: '0.10.0',
		date: '2026-06-04',
		title: 'Newsletters by email',
		changes: [
			{
				kind: 'added',
				text: 'Subscribe to email newsletters with a dedicated mailbox and each issue arrives straight in your library — a normal article you can read, highlight, and listen to. Lectern checks the mailbox every few minutes; point it at an IMAP account in the server settings to switch it on.'
			},
			{
				kind: 'added',
				text: 'A Newsletters collection in the sidebar gathers everything that arrived by email, with a live unread-style count.'
			}
		]
	},
	{
		version: '0.9.0',
		date: '2026-06-04',
		title: 'Adaptive accent',
		changes: [
			{
				kind: 'added',
				text: 'Turn on Adaptive accent (Settings → Reading) and each article’s links, header rule, and highlights pick up a colour drawn from its cover image — computed once on the server and cached, with readability preserved.'
			}
		]
	},
	{
		version: '0.8.2',
		date: '2026-06-04',
		title: 'Bars follow the theme',
		changes: [
			{
				kind: 'fixed',
				text: 'The installed app’s status and navigation bars now follow whatever theme you pick — light, sepia, dark, or black — so the whole screen reads as one colour. (A leftover fixed colour in the app manifest was pinning them; the bars now track the live theme.)'
			}
		]
	},
	{
		version: '0.8.1',
		date: '2026-06-04',
		title: 'Installed-app bar colour',
		changes: [
			{
				kind: 'fixed',
				text: 'The installed app’s status and navigation bars now use a dark chrome that no longer clashes with the dark reading themes (Firefox on Android colours those bars from the manifest, not the live page).'
			}
		]
	},
	{
		version: '0.8.0',
		date: '2026-06-04',
		title: 'Themes & reading comfort',
		changes: [
			{
				kind: 'added',
				text: 'Four new themes — Sepia and Newsprint for warm daytime reading, True Black for OLED screens at night, and a High-contrast theme for maximum legibility — alongside the existing Paper, Dark, and Auto.'
			},
			{
				kind: 'added',
				text: 'A reader-only theme: the article view can use its own theme (say, Sepia) while the rest of the app stays dark.'
			},
			{
				kind: 'added',
				text: 'Bundled reading fonts that no longer depend on what your device has installed: Literata, Atkinson Hyperlegible (built for low vision), Lexend, and OpenDyslexic for dyslexic readers.'
			},
			{
				kind: 'added',
				text: 'Finer typography control — letter, word, and paragraph spacing sliders, plus quick Narrow/Medium/Wide width presets.'
			}
		]
	},
	{
		version: '0.7.2',
		date: '2026-06-04',
		title: 'Status bar matches your theme',
		changes: [
			{
				kind: 'fixed',
				text: 'Installed to your home screen, the top status bar and bottom navigation bar now match your light/dark theme instead of staying a mismatched cream colour.'
			},
			{
				kind: 'fixed',
				text: 'Further hardening for the Android home-screen icon — the app now offers only the bitmap icons Firefox can render.'
			}
		]
	},
	{
		version: '0.7.1',
		date: '2026-06-04',
		title: 'Android install icon fix',
		changes: [
			{
				kind: 'fixed',
				text: 'Installing Lectern to your home screen from Firefox on Android now shows the real app icon instead of a blank one.'
			}
		]
	},
	{
		version: '0.7.0',
		date: '2026-06-04',
		title: 'Installs and works offline',
		changes: [
			{
				kind: 'added',
				text: 'Share a page to Lectern from any app’s share sheet and it lands in Later — no copy-pasting links.'
			},
			{
				kind: 'improved',
				text: 'Installed as an app, Lectern now opens and works offline: your library and already-saved articles are there with no connection, and cover images you’ve seen stay cached.'
			},
			{
				kind: 'improved',
				text: 'Updates no longer reload the app out from under you. When a new version is ready you get a small “Reload” prompt and choose when to take it.'
			},
			{
				kind: 'improved',
				text: 'Smoother install on phones: home-screen shortcuts for Inbox, Feed, Library and Search, plus a cleaner app identity and icons.'
			},
			{
				kind: 'fixed',
				text: 'The Listen player’s controls no longer sit under the iPhone home indicator.'
			}
		]
	},
	{
		version: '0.6.9',
		date: '2026-06-04',
		title: 'Mark read, Space to skim & re-fetch',
		changes: [
			{
				kind: 'added',
				text: 'Press “r” on a list to mark the selected article read. It stays in place, faded, until the next refresh — so the list no longer shifts out from under you the moment you mark something.'
			},
			{
				kind: 'added',
				text: 'Skim a list from the keyboard with Space (Shift+Space to step back), and the selected card now scrolls into view as you move with Space or j/k.'
			},
			{
				kind: 'added',
				text: 'In the reader, press “r” (or the new refresh button) to re-fetch the full article from the original source — handy when a saved copy came through partial or mis-rendered.'
			}
		]
	},
	{
		version: '0.6.8',
		date: '2026-06-04',
		title: 'Card menu fix',
		changes: [
			{
				kind: 'fixed',
				text: 'The three-dot menu on list cards now opens above the cards below it, so all of its options are visible again.'
			}
		]
	},
	{
		version: '0.6.7',
		date: '2026-06-04',
		title: 'Resume listening anywhere',
		changes: [
			{
				kind: 'added',
				text: 'Your Listen queue and position now sync across devices — pause on your phone and pick up on your laptop, and a refresh no longer resets playback.'
			},
			{
				kind: 'improved',
				text: 'URLs are stripped from articles before they’re read aloud, so the voice no longer recites long web links.'
			}
		]
	},
	{
		version: '0.6.6',
		date: '2026-06-04',
		title: 'Redesigned cards',
		changes: [
			{
				kind: 'improved',
				text: 'Reworked list cards: a clear title, a short preview snippet, then author · publication · reading time, with the kind and time tucked top-right.'
			},
			{
				kind: 'improved',
				text: 'Hover a card for a tidy row of actions — a three-dot menu (Listen, queue, mark read, open original…) plus quick Read-later and Archive buttons.'
			}
		]
	},
	{
		version: '0.6.5',
		date: '2026-06-04',
		title: 'Listen to a whole issue',
		changes: [
			{
				kind: 'added',
				text: 'Listen to an entire magazine issue — “Listen to issue” queues every article in order, and each one announces its title before it’s read. Each article is also a Listen button of its own.'
			},
			{
				kind: 'improved',
				text: 'Articles now speak their title before the body, so you always know what you’re hearing.'
			},
			{
				kind: 'fixed',
				text: 'The Back button in the reader now returns to wherever you came from instead of always jumping to the inbox.'
			}
		]
	},
	{
		version: '0.6.4',
		date: '2026-06-04',
		title: 'Magazine reader',
		changes: [
			{
				kind: 'added',
				text: 'Open a magazine to read the whole issue on one page: every article in sequence with a contents list up top to jump between them.'
			},
			{
				kind: 'added',
				text: 'Mark each article in an issue as read or archive it as you go — your progress shows in the contents list.'
			}
		]
	},
	{
		version: '0.6.3',
		date: '2026-06-04',
		title: 'Speed, voices & previews',
		changes: [
			{
				kind: 'added',
				text: 'Playback speed control in the player — tap to cycle 1× through 2× (and 0.75×). Your choice is remembered.'
			},
			{
				kind: 'added',
				text: 'Preview any voice with a short spoken sample, in Settings and in the player. Samples are cached so re-auditioning is free.'
			},
			{
				kind: 'improved',
				text: 'A larger set of built-in voices, and your own ElevenLabs voices now load automatically when your key permits. You can also paste any voice ID directly.'
			},
			{
				kind: 'added',
				text: 'Mark an individual newspaper story as read — a subtle check appears on each story.'
			}
		]
	},
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
