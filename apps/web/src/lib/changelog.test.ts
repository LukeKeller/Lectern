import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { releases, releaseVersion } from './changelog';

/**
 * Guard against bumping the deploy version without adding its release notes (and
 * vice-versa). The YunoHost manifest is the source of release truth — its version
 * is baked into the bundle as APP_VERSION at build time — so the newest changelog
 * entry must match it. (APP_VERSION itself is "dev" under test, hence we read the
 * manifest directly.)
 */
describe('changelog', () => {
	it('the newest entry matches the deployed manifest version', () => {
		const manifest = readFileSync(
			new URL('../../../../packaging/lectern_ynh/manifest.toml', import.meta.url),
			'utf8'
		);
		const match = manifest.match(/^version = "([^"]+)"/m);
		expect(match, 'manifest.toml should declare a version').not.toBeNull();
		const manifestVersion = releaseVersion(match![1]);
		expect(
			releases[0]?.version,
			`changelog.ts is missing a release entry for ${manifestVersion} (the current manifest version)`
		).toBe(manifestVersion);
	});

	it('lists releases newest-first with no duplicate versions', () => {
		const versions = releases.map((r) => r.version);
		expect(new Set(versions).size, 'duplicate changelog versions').toBe(versions.length);
		// Tuple-wise numeric compare so multi-digit parts (e.g. 0.4.10 > 0.4.9) order right.
		const cmp = (a: string, b: string) => {
			const pa = a.split('.').map(Number);
			const pb = b.split('.').map(Number);
			for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
				const d = (pa[i] ?? 0) - (pb[i] ?? 0);
				if (d !== 0) return d;
			}
			return 0;
		};
		for (let i = 1; i < versions.length; i++) {
			expect(
				cmp(versions[i - 1], versions[i]),
				`releases out of order: ${versions[i - 1]} should be newer than ${versions[i]}`
			).toBeGreaterThan(0);
		}
	});
});
