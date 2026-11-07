/**
 * Packaging / identity checks — no network required beyond reading the repo.
 * Covered: mdfriday-garden id, smoke-vault plugin install shape, staging sync artifacts.
 * Not covered: Obsidian UI / ribbon clicks.
 */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { REPO_ROOT } from './garden-plugin-driver.ts';

const smokePlugin = path.join(REPO_ROOT, 'tests/smoke-vault/.obsidian/plugins/mdfriday-garden');
const community = path.join(REPO_ROOT, 'tests/smoke-vault/.obsidian/community-plugins.json');

describe('Garden packaging (smoke-vault + manifest)', () => {
	it('manifest id is mdfriday-garden and name is MDFriday Digital Garden', () => {
		const m = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')) as {
			id: string;
			name: string;
			description?: string;
		};
		assert.equal(m.id, 'mdfriday-garden');
		assert.equal(m.name, 'MDFriday Digital Garden');
		assert.ok(m.description && !/obsidian/i.test(m.description), 'description must not say Obsidian');
	});

	it('smoke-vault enables only mdfriday-garden', () => {
		assert.ok(existsSync(community), 'community-plugins.json missing — run npm run sync:smoke-vault');
		const enabled = JSON.parse(readFileSync(community, 'utf8')) as string[];
		assert.deepEqual(enabled, ['mdfriday-garden']);
	});

	it('smoke-vault plugin dir has staging build artifacts', () => {
		for (const name of ['main.js', 'styles.css', 'manifest.json']) {
			const p = path.join(smokePlugin, name);
			assert.ok(existsSync(p), `missing ${p} — run npm run build:smoke`);
		}
		const installed = JSON.parse(readFileSync(path.join(smokePlugin, 'manifest.json'), 'utf8')) as {
			id: string;
		};
		assert.equal(installed.id, 'mdfriday-garden');
		const main = path.join(smokePlugin, 'main.js');
		const st = lstatSync(main);
		if (st.isSymbolicLink()) {
			const target = readlinkSync(main);
			assert.ok(target.includes('main.js'), `unexpected symlink: ${target}`);
		} else {
			assert.ok(st.size > 1000, 'main.js looks empty');
		}
	});

	it('client header prefix matches Garden identity', () => {
		const m = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')) as {
			version: string;
		};
		assert.match(`obsidian-garden/${m.version}`, /^obsidian-garden\/\d/);
	});

	it('package.json pins @mdfriday/core (not file:)', () => {
		const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		const core = pkg.dependencies?.['@mdfriday/core'] ?? '';
		assert.ok(core, '@mdfriday/core missing from dependencies');
		assert.ok(!core.startsWith('file:'), `@mdfriday/core must not be file: (got ${core})`);
	});
});
