/**
 * Garden critical path against staging (headless plugin path via @mdfriday/core).
 *
 * Covered:
 * - Guest mint (POST /v1/auth/guest) with contentExpiresAt ≈ now+7d
 * - Folder project bind + themed build + publish (kind:folder, hostingMode share lane)
 * - Public URL on share.fsky.top returns 200 with folder marker
 * - Project expiresAt ≈ now+7d
 * - X-MDFriday-Client is obsidian-garden/<ver>
 *
 * Not covered (manual / future): Obsidian ribbon UI, Claim OAuth, custom domain attach.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { EXPIRY_TOLERANCE_MS, SEVEN_DAYS_MS, loadGardenE2eEnv } from './env.ts';
import {
	GardenPluginDriver,
	fetchThemeCatalog,
	type PluginPublishResult,
} from './garden-plugin-driver.ts';

const skip = process.env.E2E_SKIP === '1';

describe('E2E Garden: guest folder → share.fsky.top (staging)', { skip, timeout: 300_000 }, () => {
	const env = loadGardenE2eEnv();
	let driver: GardenPluginDriver;
	let guestKey = '';
	let guestId = '';
	let projectId = '';
	let published: PluginPublishResult | undefined;
	const marker = `Garden hello ${env.runId}`;
	const t0 = Date.now();

	before(async () => {
		driver = new GardenPluginDriver({
			apiBaseUrl: env.apiBase,
			publicBaseUrl: env.shareBase,
		});
		await driver.init();
	});

	after(async () => {
		if (process.env.E2E_KEEP_DATA === '1') {
			driver?.dispose();
			return;
		}
		try {
			if (guestKey && projectId) {
				await fetch(`${env.apiBase.replace(/\/$/, '')}/v1/projects/${projectId}`, {
					method: 'DELETE',
					headers: {
						authorization: `Bearer ${guestKey}`,
						'X-MDFriday-Client': driver.clientHeader,
					},
				});
			}
		} catch (err) {
			console.warn('cleanup delete project failed', err);
		}
		driver?.dispose();
	});

	it('1. guest mint returns key + ~7d contentExpiresAt', async () => {
		const g = await driver.guestKey();
		guestKey = g.key;
		guestId = g.guestId;
		assert.ok(guestKey.startsWith('MDF_'), `key prefix: ${guestKey.slice(0, 8)}`);
		assert.ok(guestId, 'guestId');
		assert.ok(typeof g.contentExpiresAt === 'number', 'contentExpiresAt missing — is staging on 7d TTL?');
		const delta = (g.contentExpiresAt as number) - t0;
		assert.ok(
			Math.abs(delta - SEVEN_DAYS_MS) <= EXPIRY_TOLERANCE_MS,
			`contentExpiresAt skew: delta=${delta} expected≈${SEVEN_DAYS_MS}`,
		);
		console.log(`  guest=${guestId} contentExpiresAt=+${Math.round(delta / 86_400_000)}d`);
	});

	it('2. publish sample folder with quartz theme (obsidian-garden client)', async () => {
		const catalog = await fetchThemeCatalog(env.apiBase);
		const quartz =
			catalog.find((e) => e.slug === 'quartz') ||
			catalog.find((e) => (e.kinds || []).includes('folder') && e.packUrl);
		assert.ok(quartz?.packUrl, 'default folder theme (quartz) entitled for guests');

		driver.writeVault({
			'Garden/index.md': `---\ntitle: Garden home\n---\n# ${marker}\n\nFrom obsidian-digital-garden tests/e2e.\n`,
			'Garden/about.md': `---\ntitle: About\n---\n# About\n\nSecond page for folder build.\n`,
		});
		const site = await driver.createFolderProject('garden-hello', 'Garden', quartz!);
		published = await driver.buildAndPublish(site, { token: guestKey, guest: true }, { force: true });
		projectId = published.projectId;

		assert.ok(published.siteId, 'siteId');
		assert.ok(projectId, 'projectId');
		assert.match(published.baseURL, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
		assert.match(published.clientHeader, /^obsidian-garden\//);
		console.log(
			`  project=${projectId} url=${published.url} files=${published.filesUploaded} build=${published.buildMs}ms publish=${published.publishMs}ms client=${published.clientHeader} core=${driver.coreVersion}`,
		);
	});

	it('3. public page 200 contains marker', async () => {
		assert.ok(published, 'publish step did not run');
		const page = await fetch(`${published.url}?e2e=${env.runId}`);
		const html = await page.text();
		assert.equal(page.status, 200, html.slice(0, 200));
		assert.ok(html.includes(marker), 'published HTML missing marker');
	});

	it('4. project expiresAt ≈ now+7d; kind folder / hosting share lane', async () => {
		assert.ok(projectId && guestKey);
		const res = await fetch(`${env.apiBase.replace(/\/$/, '')}/v1/projects/${projectId}`, {
			headers: {
				authorization: `Bearer ${guestKey}`,
				'X-MDFriday-Client': driver.clientHeader,
			},
		});
		const body = (await res.json()) as {
			project?: {
				expiresAt?: number | null;
				expires_at?: number | null;
				kind?: string;
				hostingMode?: string;
				hosting_mode?: string;
			};
		};
		assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));
		const p = body.project!;
		const expiresAt = p.expiresAt ?? p.expires_at ?? null;
		assert.ok(typeof expiresAt === 'number' && expiresAt > 0, 'expiresAt missing on project');
		const delta = expiresAt! - t0;
		assert.ok(
			Math.abs(delta - SEVEN_DAYS_MS) <= EXPIRY_TOLERANCE_MS,
			`expiresAt skew: delta=${delta} expected≈${SEVEN_DAYS_MS}`,
		);
		const kind = p.kind;
		const hosting = p.hostingMode ?? p.hosting_mode;
		assert.equal(kind, 'folder');
		assert.equal(hosting, 'share');
		console.log(`  expiresAt=+${Math.round(delta / 86_400_000)}d kind=${kind} hosting=${hosting}`);
	});
});
