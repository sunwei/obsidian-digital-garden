/**
 * Commerce publish: stub pages are written in the plugin workspace, never into the vault.
 * After a staging publish, /purchase/, /pricing/, and /privacy/ exist; the purchase zone
 * stays hidden when the account has no offers.
 *
 * Skips when E2E_SKIP=1.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ensureCommerceStubPages } from '../../src/commerce/commerce-pages.ts';
import { loadGardenE2eEnv } from './env.ts';
import { GardenPluginDriver, fetchThemeCatalog, type PluginPublishResult } from './garden-plugin-driver.ts';

const skip = process.env.E2E_SKIP === '1';

describe('E2E Garden: commerce publish stubs + pages (staging)', { skip, timeout: 360_000 }, () => {
	const env = loadGardenE2eEnv();
	let driver: GardenPluginDriver;
	let guestKey = '';
	let projectId = '';
	let published: PluginPublishResult | undefined;
	const privacyBody = `---\ntitle: My Privacy\n---\nAuthor-written privacy ${env.runId}.\n`;

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

	it('1. guest mint + folder with an existing privacy.md', async () => {
		const g = await driver.guestKey();
		guestKey = g.key;
		driver.writeVault({
			'Garden/index.md': `---\ntitle: Commerce E2E\n---\nHello ${env.runId}.\n`,
			'Garden/privacy.md': privacyBody,
		});
	});

	it('2. stubs stay out of the vault, then publish (quartz)', async () => {
		const catalog = await fetchThemeCatalog(env.apiBase);
		const quartz = catalog.find(
			(t) =>
				(t.family || t.slug) === 'quartz' &&
				t.packUrl &&
				(t.kinds || []).includes('digital-garden'),
		);
		assert.ok(quartz, 'quartz digital-garden theme missing from catalog');
		const site = await driver.createFolderProject('commerce-e2e', 'Garden', quartz);
		const projectPath = path.join(driver.workspaceDir, 'projects', site.name);
		assert.equal(existsSync(projectPath), true, projectPath);
		const planned = await ensureCommerceStubPages({ projectPath, locale: 'en' });
		assert.ok(planned.skip.includes('privacy'));
		assert.ok(planned.write.includes('purchase'));
		assert.equal(existsSync(path.join(driver.vaultDir, 'Garden/purchase.md')), false);
		assert.equal(existsSync(path.join(driver.vaultDir, 'Garden/pricing.md')), false);
		assert.equal(readFileSync(path.join(driver.vaultDir, 'Garden/privacy.md'), 'utf8'), privacyBody);

		published = await driver.buildAndPublish(site, { token: guestKey, guest: true }, {
			beforeBuild: async () => {
				await ensureCommerceStubPages({ projectPath, locale: 'en' });
			},
		});
		assert.equal(existsSync(path.join(projectPath, 'public', 'purchase.html')), true, 'expected SSG output public/purchase.html');
		assert.equal(existsSync(path.join(projectPath, 'public', 'pricing.html')), true);
		assert.equal(existsSync(path.join(projectPath, 'public', 'privacy.html')), true);
		projectId = published.projectId;
		assert.ok(published.baseURL.includes('/s/'));
		// Vault still untouched after the build overlay.
		assert.equal(existsSync(path.join(driver.vaultDir, 'Garden/purchase.md')), false);
		assert.equal(readFileSync(path.join(driver.vaultDir, 'Garden/privacy.md'), 'utf8'), privacyBody);
	});

	it('3. published site has the three pages; purchase zone is hidden without offers', async () => {
		assert.ok(published);
		const root = published.baseURL.endsWith('/') ? published.baseURL : `${published.baseURL}/`;
		const pages = ['purchase.html', 'pricing.html', 'privacy.html'];
		for (const rel of pages) {
			const res = await fetch(`${root}${rel}`);
			assert.equal(res.ok, true, `${rel} status ${res.status}`);
			const html = await res.text();
			assert.notEqual(html.length, 0);
			if (rel === 'privacy.html') {
				assert.match(html, /Author-written privacy/);
			}
			// mdf-purchase-root / no-referrer require the iteration-3 theme pack on staging.
			if (rel === 'purchase.html' && /mdf-purchase-root/.test(html)) {
				assert.match(html, /referrer/);
			}
		}
		const home = await fetch(`${root}`);
		assert.equal(home.ok, true);
		const homeHtml = await home.text();
		// No offers on a guest site: the slot is absent or hidden, never showing product cards.
		assert.equal(/mdf-commerce-price/.test(homeHtml), false);
	});
});
