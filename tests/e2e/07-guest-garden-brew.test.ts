/**
 * Garden critical path with **quartz** theme (Beer-source wiki 2.x).
 *
 * Covered:
 * - Guest mint → folder bind/build/publish with catalog slug `quartz`
 * - Public URL 200 + content marker
 * - Published HTML has wiki chrome (explorer/search/sidebars) and no caps-css template errors
 * - Beer CSS linked
 *
 * Skip: E2E_SKIP=1 or E2E_SKIP_BREW=1 or E2E_SKIP_QUARTZ=1
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { loadGardenE2eEnv } from './env.ts';
import {
	GardenPluginDriver,
	fetchThemeCatalog,
	type PluginPublishResult,
} from './garden-plugin-driver.ts';

const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_BREW === '1' ||
	process.env.E2E_SKIP_QUARTZ === '1';

describe('E2E Garden: guest folder → quartz theme (staging)', { skip, timeout: 360_000 }, () => {
	const env = loadGardenE2eEnv();
	let driver: GardenPluginDriver;
	let guestKey = '';
	let projectId = '';
	let published: PluginPublishResult | undefined;
	const marker = `Quartz garden ${env.runId}`;

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

	it('1. guest mint', async () => {
		const g = await driver.guestKey();
		guestKey = g.key;
		assert.ok(guestKey.startsWith('MDF_'));
	});

	it('2. publish folder with quartz theme', async () => {
		const catalog = await fetchThemeCatalog(env.apiBase);
		const quartz = catalog.find(
			(e) =>
				e.slug === 'quartz' &&
				e.packUrl &&
				(e.kinds || []).includes('digital-garden'),
		);
		assert.ok(
			quartz?.packUrl,
			'quartz@digital-garden must be entitled on staging catalog',
		);
		assert.ok(
			String(quartz!.version || '').startsWith('2.'),
			`expected quartz 2.x on staging, got ${quartz!.version}`,
		);

		driver.writeVault({
			'Garden/index.md': `---\ntitle: Quartz garden home\n---\n# ${marker}\n\nWiki home for quartz E2E.\n`,
			'Garden/about.md': `---\ntitle: About\n---\n# About\n\nSecond page.\n\n\`\`\`js\nconsole.log("clipboard")\n\`\`\`\n`,
			'Garden/docs.md': `---\ntitle: Docs\n---\n# Docs\n\n## Section\n\nBody for TOC.\n`,
		});
		const site = await driver.createFolderProject('garden-quartz', 'Garden', quartz!);
		published = await driver.buildAndPublish(site, { token: guestKey, guest: true }, { force: true });
		projectId = published.projectId;

		assert.ok(published.siteId);
		assert.match(published.baseURL, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
		console.log(
			`  quartz=${quartz!.slug}@${quartz!.version ?? '?'} url=${published.url} build=${published.buildMs}ms`,
		);
	});

	it('3. public HTML: marker + wiki chrome + no template errors', async () => {
		assert.ok(published);
		const res = await fetch(`${published.url}?e2e=${env.runId}`);
		const html = await res.text();
		const diag = () =>
			JSON.stringify({
				status: res.status,
				url: published!.url,
				len: html.length,
				hasMarker: html.includes(marker),
				hasTemplateErr: /<!-- Template (?:execution error|not found)/.test(html),
				hasBeer: html.includes('beercss') || html.includes('beer.min.css'),
				hasShell: html.includes('brew-shell'),
				hasSidebar: html.includes('sidebar'),
				hasExplorer: html.includes('explorer'),
				hasSearch: /search-button|\.search|class="[^"]*search/.test(html),
				snippet: html.slice(0, 400),
			});
		assert.equal(res.status, 200, diag());
		assert.ok(html.includes(marker), `marker missing ${diag()}`);
		assert.ok(!/Template (?:execution error|not found): partials\/caps-css/.test(html), `caps-css broken ${diag()}`);
		assert.ok(!/<!-- Template (?:execution error|not found)/.test(html), `template error comment ${diag()}`);
		assert.ok(html.includes('sidebar'), `sidebar chrome ${diag()}`);
		assert.ok(html.includes('beercss') || html.includes('beer.min.css'), `Beer CSS ${diag()}`);
		assert.ok(html.includes('brew-shell'), `brew-shell ${diag()}`);
		// Explorer/search depend on Site.Params capability objects; assert at least one wiki chrome widget.
		assert.ok(
			html.includes('explorer') || /search-button|class="[^"]*search/.test(html) || html.includes('toc'),
			`wiki widgets ${diag()}`,
		);
	});

	it('4. about page renders code block (clipboard path)', async () => {
		assert.ok(published);
		const aboutUrl = new URL('about.html', published.baseURL).href;
		const res = await fetch(`${aboutUrl}?e2e=${env.runId}`);
		const html = await res.text();
		assert.equal(res.status, 200, html.slice(0, 240));
		assert.ok(html.includes('clipboard') || html.includes('<pre'), 'code/pre on about');
		assert.ok(!/Template (?:execution error|not found): partials\//.test(html));
	});
});
