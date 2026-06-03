import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { LecternClient } from '@lectern/api-client';

/**
 * Client configuration. The API base URL comes from the public env var
 * `PUBLIC_LECTERN_API_URL` and defaults to the local mock server. The bearer
 * token lives in localStorage and is only ever read/written on the client.
 */

const TOKEN_KEY = 'lectern.token';
const DEFAULT_API_URL = 'http://127.0.0.1:8788/api/v1';

export function getApiUrl(): string {
	return env.PUBLIC_LECTERN_API_URL ?? DEFAULT_API_URL;
}

export function getToken(): string | undefined {
	if (!browser) return undefined;
	return localStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function setToken(token: string): void {
	if (!browser) return;
	if (token) localStorage.setItem(TOKEN_KEY, token);
	else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken(): void {
	if (!browser) return;
	localStorage.removeItem(TOKEN_KEY);
}

let client: LecternClient | undefined;
let clientToken: string | undefined;

/**
 * Singleton client. Rebuilt only when the stored token changes so callers always
 * hit the network with the latest credentials.
 */
export function getClient(): LecternClient {
	const token = getToken();
	if (!client || token !== clientToken) {
		clientToken = token;
		client = new LecternClient({ baseUrl: getApiUrl(), token });
	}
	return client;
}
