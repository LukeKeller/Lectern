import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
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
