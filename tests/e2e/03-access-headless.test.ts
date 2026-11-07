/**
 * G2 — Headless Garden access closed loop on staging (no Obsidian.app).
 *
 * Guest mint → protect Garden folder (index.md access:protected) → publish →
 * live HTML has no plaintext canary → public session/keys + AES-GCM format 2 unlock →
 * wrong key fails.
 *
 * Account path: same guest mint as 01 (I3 sharedKeys on first root protected publish).
 * Does not open the community plugin store. Skips when E2E_SKIP=1.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { loadGardenE2eEnv } from './env.ts';
import {
	GardenPluginDriver,
	fetchThemeCatalog,
	type PluginPublishResult,
} from './garden-plugin-driver.ts';
import {
	inventWrongAccessKey,
	parseAccessShell,
	unlockPublishedPage,
	createAccessSession,
} from './access-unlock.ts';

const skip = process.env.E2E_SKIP === '1';

describe('E2E Garden: access headless protect → publish → unlock (staging)', { skip, timeout: 360_000 }, () => {
	const env = loadGardenE2eEnv();
	let driver: GardenPluginDriver;
	let guestKey = '';
	let projectId = '';
	let published: PluginPublishResult | undefined;
	let sharedKey = '';
	let protectedPageUrl = '';
	let lockedHtml = '';

	const canary = `MDF_GARDEN_ACCESS_CANARY_${env.runId}`;
	const teaser = `Public teaser ${env.runId}`;

	before(async () => {
		driver = new GardenPluginDriver({
			apiBaseUrl: env.apiBase,
			publicBaseUrl: env.shareBase,
		});
		await driver.init();
	});

	after(async () => {
		if (process.env.E2E_KEEP_DATA === '1') {
			if (published) {
				console.log(`  E2E_KEEP_DATA=1 keeping project=${projectId} url=${published.baseURL}`);
			}
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

	it('1. guest mint', async () => {
		const g = await driver.guestKey();
		guestKey = g.key;
		assert.ok(guestKey.startsWith('MDF_'), `key prefix: ${guestKey.slice(0, 8)}`);
		console.log(`  account=guest guestId=${g.guestId} (same path as 01; sharedKeys via I3)`);
	});

	it('2. publish protected Garden folder (quartz)', async () => {
		const catalog = await fetchThemeCatalog(env.apiBase);
		const quartz =
			catalog.find((e) => e.slug === 'quartz') ||
			catalog.find((e) => (e.kinds || []).includes('folder') && e.packUrl);
		assert.ok(quartz?.packUrl, 'default folder theme (quartz) entitled for guests');

		driver.writeVault({
			'Garden/index.md': `---
title: Access garden
access: protected
teaser: ${teaser}
---
# Access garden

See [[secret]].
`,
			'Garden/secret.md': `---
title: Secret note
---
# Secret

${canary}
`,
			'Garden/about.md': `---
title: About
---
# About

Public contrast page content (inherits site protection when root is protected).
`,
		});

		const site = await driver.createFolderProject('garden-access', 'Garden', quartz!);
		published = await driver.buildAndPublish(site, { token: guestKey, guest: true }, { force: true });
		projectId = published.projectId;

		assert.ok(projectId, 'projectId');
		assert.match(published.baseURL, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
		assert.ok(published.sharedKeys?.length, 'expected sharedKeys from first root protected publish (I3)');
		sharedKey = published.sharedKeys![0]!.key;
		assert.equal(sharedKey.length, 17, `shared key length: ${sharedKey}`);
		assert.equal(published.sharedKeys![0]!.scope, 'site');

		// Quartz pretty URLs on share are *.html
		protectedPageUrl = `${published.baseURL}secret.html`;
		console.log(
			`  project=${projectId} base=${published.baseURL} secret=${protectedPageUrl} sharedScope=${published.sharedKeys![0]!.scope} files=${published.filesUploaded}`,
		);
	});

	it('3. live HTML has no plaintext canary; access shell format 2 present', async () => {
		assert.ok(published && protectedPageUrl);
		const page = await fetch(`${protectedPageUrl}?e2e=${env.runId}`);
		lockedHtml = await page.text();
		assert.equal(page.status, 200, lockedHtml.slice(0, 200));
		assert.equal(lockedHtml.includes(canary), false, 'protected page must not leak canary');
		assert.match(lockedHtml, /data-format=["']2["']/);
		assert.match(lockedHtml, /mdf-encrypt-content|mdf-access-card|mdf-access-key-input/);
		assert.ok(lockedHtml.includes(teaser) || /teaser|unlock|access/i.test(lockedHtml), 'teaser or unlock UI expected');

		const shell = parseAccessShell(lockedHtml, env.apiBase);
		assert.equal(shell.projectId, projectId);
		assert.ok(shell.resourceId);
		assert.ok(shell.keyId);
		assert.ok(shell.encryptedB64.length > 20);
		console.log(`  shell resource=${shell.resourceId} keyId=${shell.keyId} scope=${shell.scope}`);
	});

	it('4. shared key unlocks via public session/keys + AES-GCM', async () => {
		assert.ok(lockedHtml && sharedKey);
		const { plainHtml, shell } = await unlockPublishedPage(env.apiBase, lockedHtml, sharedKey);
		assert.ok(plainHtml.includes(canary), 'decrypted HTML must contain canary');
		assert.equal(shell.projectId, projectId);
		console.log(`  unlocked ok (${plainHtml.length} chars plaintext)`);
	});

	it('5. wrong key fails session (no CEK)', async () => {
		assert.ok(lockedHtml && projectId);
		const shell = parseAccessShell(lockedHtml, env.apiBase);
		const wrong = inventWrongAccessKey();
		assert.notEqual(wrong, sharedKey);
		const session = await createAccessSession(shell.apiBase, shell.projectId, [wrong]);
		assert.ok(!session.token, 'wrong key must not mint a session token');
		const reason = session.rejected?.[0]?.reason || 'invalid';
		console.log(`  wrong key rejected: ${reason}`);
	});
});
