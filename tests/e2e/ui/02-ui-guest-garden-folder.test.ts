/**
 * Headed UI E2E: drive real Obsidian.app, click Garden → Publish panel, assert public URL.
 *
 * Does NOT replace the headless API/core suite (tests/e2e/01-guest-garden-folder.test.ts).
 *
 * Skip when Obsidian.app is missing (Linux CI). Run locally:
 *   E2E_KEEP_DATA=1 npm run test:e2e:ui:staging
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadGardenE2eEnv } from '../env.ts';
import {
	PLUGIN_ID,
	REPO_ROOT,
	SMOKE_VAULT,
	closeObsidianSession,
	deleteStagingProject,
	launchObsidianForUiE2e,
	obsidianAppPresent,
	publishGardenFolderViaUi,
	readSmokePluginData,
	resolveProjectIdForUrl,
	type ObsidianSession,
} from './obsidian-harness.ts';

const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_UI === '1' ||
	!obsidianAppPresent();

const skipReason = !obsidianAppPresent()
	? 'Obsidian.app not installed — UI E2E is macOS/desktop only'
	: process.env.E2E_SKIP_UI === '1' || process.env.E2E_SKIP === '1'
		? 'E2E_SKIP / E2E_SKIP_UI set'
		: '';

describe(
	'UI E2E Garden: Obsidian desktop clicks → share.fsky.top',
	{ skip, timeout: 420_000 },
	() => {
		if (skip) {
			it(`skipped: ${skipReason}`, () => {
				console.log(`SKIP UI E2E: ${skipReason}`);
			});
			return;
		}

		const env = loadGardenE2eEnv();
		let session: ObsidianSession | undefined;
		let publicUrl = '';
		let projectId: string | null = null;
		const marker = 'Garden hello';

		before(async () => {
			// Ensure staging smoke artifacts are present (caller should run build:smoke;
			// we only assert size so a bare test:e2e:ui fails clearly).
			const mainJs = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'main.js');
			assert.ok(existsSync(mainJs), `missing ${mainJs} — run: npm run build:smoke`);
			const rootMain = path.join(REPO_ROOT, 'main.js');
			const st = existsSync(rootMain) ? readFileSync(rootMain) : null;
			assert.ok(st && st.byteLength > 500_000, 'main.js implausibly small — run npm run build:smoke');

			console.log(`  launching headed Obsidian (smoke-vault)…`);
			session = await launchObsidianForUiE2e();
			console.log(`  CDP ${session.cdpUrl}  userData=${session.userDataDir}`);
		});

		after(async () => {
			const keep = process.env.E2E_KEEP_DATA === '1';
			if (!keep && publicUrl) {
				try {
					const data = readSmokePluginData();
					const manifest = JSON.parse(
						readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'),
					) as { version?: string };
					const clientHeader = `obsidian-garden/${manifest.version ?? '0.0.0'}`;
					if (data.mdfKey) {
						projectId =
							projectId ||
							(await resolveProjectIdForUrl({
								apiBase: env.apiBase,
								token: data.mdfKey,
								clientHeader,
								publicUrl,
							}));
						if (projectId) {
							await deleteStagingProject({
								apiBase: env.apiBase,
								projectId,
								token: data.mdfKey,
								clientHeader,
							});
							console.log(`  cleaned project ${projectId}`);
						}
					}
				} catch (err) {
					console.warn('UI E2E cleanup failed', err);
				}
			} else if (keep && publicUrl) {
				console.log(`  E2E_KEEP_DATA=1 — leaving site up: ${publicUrl}`);
			}
			await closeObsidianSession(session);
		});

		it('1. click Garden + Publish in Obsidian UI and get public URL', async () => {
			assert.ok(session, 'Obsidian session missing');
			publicUrl = await publishGardenFolderViaUi(session.page);
			assert.match(publicUrl, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
			console.log(`  PUBLIC_URL=${publicUrl}`);
		});

		it('2. public page returns 200 and contains Garden note marker', async () => {
			assert.ok(publicUrl, 'no publicUrl from UI step');
			const page = await fetch(`${publicUrl}index.html?ui-e2e=${env.runId}`);
			const html = await page.text();
			assert.equal(page.status, 200, html.slice(0, 240));
			assert.ok(
				html.includes(marker) || html.includes('Garden'),
				`published HTML missing marker "${marker}"`,
			);
			console.log(`  HTTP ${page.status} ok — marker found — ${publicUrl}`);
		});
	},
);
