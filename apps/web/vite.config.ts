import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Deploy version baked into the bundle so the UI can show exactly what's
	// running. build-artifact.sh sets LECTERN_VERSION from the YunoHost manifest;
	// dev/CI fall back to "dev".
	define: {
		__LECTERN_VERSION__: JSON.stringify(process.env.LECTERN_VERSION ?? 'dev')
	},
	// Dev-only: proxy the mock/BFF API so browser dev runs same-origin (no CORS).
	// Point PUBLIC_LECTERN_API_URL at <origin>/api/v1 to use it. Production builds
	// ignore this block.
	server: {
		proxy: {
			'/api': { target: 'http://127.0.0.1:8788', changeOrigin: true }
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
