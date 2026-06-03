import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	// Static SPA: the BFF serves these assets + the /api routes as one service.
	// fallback renders the client-side router for any non-prerendered route.
	kit: { adapter: adapter({ fallback: 'index.html' }) }
};

export default config;
