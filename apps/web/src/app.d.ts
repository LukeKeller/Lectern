// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	/** Deploy version, injected at build time from the YunoHost manifest (see vite.config.ts). */
	const __LECTERN_VERSION__: string;
}

export {};
