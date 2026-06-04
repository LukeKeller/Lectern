<script lang="ts">
	/**
	 * Minimal stroke icon set drawn from a shared 24×24 grid. Inline SVG keeps the
	 * app dependency-free and offline; icons inherit `currentColor` and scale with
	 * the `size` prop. Decorative by default (aria-hidden); pass a `title` to label.
	 */
	export type IconName =
		| 'inbox'
		| 'clock'
		| 'star'
		| 'archive'
		| 'rss'
		| 'book'
		| 'search'
		| 'folder'
		| 'settings'
		| 'bookmark'
		| 'views'
		| 'sun'
		| 'moon'
		| 'auto'
		| 'menu'
		| 'close'
		| 'back'
		| 'external'
		| 'sliders'
		| 'highlight'
		| 'check'
		| 'list'
		| 'info'
		| 'newspaper'
		| 'magazine'
		| 'chevron';

	let { name, size = 20, title }: { name: IconName; size?: number; title?: string } = $props();

	// Each entry is the inner geometry of a 24×24, stroked, round-joined icon.
	const paths: Record<IconName, string> = {
		inbox:
			'<path d="M3 13h4l2 3h6l2-3h4"/><path d="M5 13 7 5h10l2 8v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/>',
		clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
		star: '<path d="M12 3.5 14.6 9l5.9.6-4.4 4 1.3 5.9L12 16.6 6.6 19.5l1.3-5.9-4.4-4 5.9-.6z"/>',
		archive:
			'<rect x="3.5" y="7.5" width="17" height="12.5" rx="1.5"/><path d="M2.5 4.5h19v3h-19z"/><path d="M9.5 11.5h5"/>',
		rss: '<path d="M5 16a3 3 0 0 1 3 3"/><path d="M5 11a8 8 0 0 1 8 8"/><path d="M5 6a13 13 0 0 1 13 13"/><circle cx="5.2" cy="18.8" r="0.6"/>',
		book: '<path d="M5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v13H6.5A1.5 1.5 0 0 1 5 17.5z"/><path d="M5 17.5A1.5 1.5 0 0 1 6.5 16h11"/>',
		search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
		folder:
			'<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
		settings:
			'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/>',
		bookmark: '<path d="M6.5 4.5h11v15l-5.5-3.8L6.5 19.5z"/>',
		views:
			'<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4"/>',
		moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4 7 7 0 1 0 20 13.5z"/>',
		auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/>',
		menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
		close: '<path d="m6 6 12 12M18 6 6 18"/>',
		back: '<path d="M15 5l-7 7 7 7"/>',
		external:
			'<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V7.5A1.5 1.5 0 0 1 6.5 6H11"/>',
		sliders:
			'<path d="M5 8h9M18 8h1M5 16h1M10 16h9"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>',
		highlight:
			'<path d="M5 19h6"/><path d="M9 14.5 14.5 9l3 3L12 17.5l-3.5.6z"/><path d="M14.5 9l1.8-1.8a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L17.5 12"/>',
		check: '<path d="M5 12.5 10 17.5 19.5 6.5"/>',
		list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
		info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
		newspaper:
			'<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H16a1 1 0 0 1 1 1v12.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5z"/><path d="M17 9h1.5A1.5 1.5 0 0 1 20 10.5V18a2 2 0 0 1-2 2"/><path d="M7 8.5h6M7 11.5h6M7 14.5h4"/>',
		magazine:
			'<rect x="5.5" y="3.5" width="13" height="17" rx="1.5"/><path d="M8.5 7.5h7"/><path d="M8.5 11h7M8.5 13.5h4.5"/>',
		chevron: '<path d="m9 6 6 6-6 6"/>'
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={title ? 'img' : 'presentation'}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title}
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html paths[name]}
</svg>

<style>
	svg {
		display: block;
		flex-shrink: 0;
	}
</style>
