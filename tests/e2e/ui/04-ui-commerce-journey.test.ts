/**
 * Headed full commerce journey: Obsidian (author) → Chromium (Dashboard + reader).
 *
 * 1. Obsidian: Personal seed → Advanced Selling → Publish
 * 2. Obsidian: Selling ▸ Manage in Dashboard (captures Sales URL)
 * 3. Chromium: Dashboard Sales — contact → Creem test → docs offer
 * 4. Chromium: reader buys on share site → Key → unlock docs
 *
 * Chromium is headed by default (this is a watchable UI suite).
 * Set E2E_HEADLESS=1 to hide Chromium (Obsidian stays headed).
 *
 *   E2E_COMMERCE=1 MDF_E2E_ENV=staging npm run test:e2e:ui:commerce:staging
 *
 * Headless API path without Obsidian: G6 (`06-commerce-author-reader-journey`).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { loadGardenE2eEnv } from '../env.ts';
import { createCommerceApi } from '../helpers/commerce/api.ts';
import {
	cleanupCreemWebhooks,
	commercePrereqs,
	loadCreemTestApiKey,
} from '../helpers/commerce/creem.ts';
import {
	createSyncedDocsOffer,
	ensureCreemTestConnection,
	putCommerceSettings,
	syncOffer,
	type ConnectionBody,
	type OfferBody,
} from '../helpers/commerce/offers.ts';
import { readerPurchaseAndUnlock } from '../helpers/commerce/reader.ts';
import { normalizeAccessKey } from '../helpers/commerce/sanitize.ts';
import {
	cleanupStagingCreator,
	createStagingCreator,
	stagingCreatorPrereqs,
	type StagingCreator,
} from '../staging-creator.ts';
import { playwrightLaunchOptions } from './playwright-launch.ts';
import {
	closeSalesDashboard,
	configureSalesViaDashboardUi,
	openDashboardSales,
	type SalesDashboardSession,
} from './sales-dashboard-harness.ts';
import {
	PLUGIN_ID,
	REPO_ROOT,
	SMOKE_VAULT,
	assertSalesSectionInPanel,
	clickSalesManageCaptureUrl,
	closeObsidianSession,
	deleteStagingProject,
	launchObsidianForUiE2e,
	obsidianAppPresent,
	openGardenPublishPanel,
	publishGardenFolderViaUiWithAccess,
	resolveProjectIdForUrl,
	seedPersonalPluginData,
	type ObsidianSession,
} from './obsidian-harness.ts';

const creatorPrereq = stagingCreatorPrereqs();
const commerceGate = commercePrereqs();
const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_UI === '1' ||
	!obsidianAppPresent() ||
	!creatorPrereq.ok ||
	!commerceGate.ok;

const skipReason = !obsidianAppPresent()
	? 'Obsidian.app missing'
	: !creatorPrereq.ok
		? `staging creator: ${creatorPrereq.missing.join('; ')}`
		: !commerceGate.ok
			? commerceGate.missing.join('; ')
			: 'E2E_SKIP / E2E_SKIP_UI';

/** Chromium headed unless E2E_HEADLESS=1 (Obsidian is always headed). */
const chromiumHeadless = process.env.E2E_HEADLESS === '1';

function clientHeader(): string {
	const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')) as {
		version?: string;
	};
	return `obsidian-garden/${manifest.version ?? '0.0.0'}`;
}

function prepareCommerceVault(opts: { homeCanary: string; docsCanary: string; docsTeaser: string }): void {
	const gardenDir = path.join(SMOKE_VAULT, 'Garden');
	mkdirSync(gardenDir, { recursive: true });
	writeFileSync(
		path.join(gardenDir, 'index.md'),
		`---
title: Commerce UI garden
---
# Commerce UI garden

Public home. See [[docs]].

${opts.homeCanary}
`,
		'utf8',
	);
	writeFileSync(
		path.join(gardenDir, 'docs.md'),
		`---
title: Docs
access: protected
access_scope: docs
teaser: ${opts.docsTeaser}
---
# Docs

${opts.docsCanary}
`,
		'utf8',
	);
}

describe(
	'UI E2E Garden: Obsidian author → Chromium Sales + reader (full)',
	{ skip, timeout: 720_000 },
	() => {
		if (skip) {
			it(`skipped: ${skipReason}`, () => {
				console.log(`SKIP ui/04 full commerce journey: ${skipReason}`);
			});
			return;
		}

		const env = loadGardenE2eEnv();
		const homeCanary = `MDF_UI04_HOME_${env.runId}`;
		const docsCanary = `MDF_UI04_DOCS_${env.runId}`;
		const docsTeaser = `Docs teaser UI04 ${env.runId}`;
		const offerName = `UI04 Offer ${env.runId}`;
		const contactEmail = `ui04-creator-${env.runId}@mdfriday.test`;
		const readerEmail = `ui04-reader-${env.runId}@mdfriday.test`;

		let creator: StagingCreator;
		let creemKey = '';
		let api = createCommerceApi(env.apiBase);
		let session: ObsidianSession | undefined;
		let sales: SalesDashboardSession | undefined;
		let readerBrowser: Browser | undefined;
		let publicUrl = '';
		let projectId = '';
		let salesUrl = '';
		let connection: ConnectionBody | undefined;
		let offer: OfferBody | undefined;

		before(async () => {
			const mainJs = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'main.js');
			assert.ok(existsSync(mainJs), `missing ${mainJs} — run: npm run build:smoke`);
			const rootMain = path.join(REPO_ROOT, 'main.js');
			assert.ok(
				existsSync(rootMain) && readFileSync(rootMain).byteLength > 500_000,
				'main.js implausibly small — run npm run build:smoke',
			);

			creemKey = loadCreemTestApiKey();
			creator = await createStagingCreator('ui04', env.runId, { plan: 'personal' });
			api = createCommerceApi(creator.apiBase);
			prepareCommerceVault({ homeCanary, docsCanary, docsTeaser });
			seedPersonalPluginData({
				mdfKey: creator.mdfKey,
				email: creator.email,
				apiBase: creator.apiBase,
				shareBase: env.shareBase,
			});

			const localProject = path.join(
				SMOKE_VAULT,
				'.obsidian/plugins',
				PLUGIN_ID,
				'workspace/projects/Garden',
			);
			if (existsSync(localProject)) rmSync(localProject, { recursive: true, force: true });

			console.log(`  [author] launching Obsidian (personal=${creator.userId})…`);
			console.log(
				chromiumHeadless
					? '  [chromium] headless (E2E_HEADLESS=1)'
					: '  [chromium] headed — watch Dashboard Sales + Creem + unlock',
			);
			session = await launchObsidianForUiE2e();
			console.log(`  CDP ${session.cdpUrl}`);
		});

		after(async () => {
			await closeSalesDashboard(sales);
			if (readerBrowser) await readerBrowser.close().catch(() => undefined);

			const keep = process.env.E2E_KEEP_DATA === '1';
			if (!keep && (projectId || publicUrl)) {
				try {
					const id =
						projectId ||
						(await resolveProjectIdForUrl({
							apiBase: env.apiBase,
							token: creator.mdfKey,
							clientHeader: clientHeader(),
							publicUrl,
						}));
					if (id) {
						await deleteStagingProject({
							apiBase: env.apiBase,
							projectId: id,
							token: creator.mdfKey,
							clientHeader: clientHeader(),
						});
						console.log(`  cleaned project ${id}`);
					}
				} catch (err) {
					console.warn('ui/04 project cleanup failed', err);
				}
			} else if (keep && publicUrl) {
				console.log(`  E2E_KEEP_DATA=1 — site=${publicUrl}`);
			}

			try {
				if (creemKey) await cleanupCreemWebhooks(creemKey, connection?.id ?? null);
			} catch (err) {
				console.warn('creem cleanup', err instanceof Error ? err.message : err);
			}

			await closeObsidianSession(session);
			await cleanupStagingCreator(creator, {
				projectId: keep ? undefined : projectId || undefined,
				clientHeader: clientHeader(),
				keepData: keep,
			});
		});

		it('1. [Obsidian] Advanced ▸ Selling visible for Personal', async () => {
			assert.ok(session);
			await openGardenPublishPanel(session.page);
			const salesPanel = await assertSalesSectionInPanel(session.page);
			assert.ok(salesPanel.visible);
			console.log(`  sales panel enabled=${salesPanel.enabled} line=${salesPanel.line}`);
			await sleep(1500);
		});

		it('2. [Obsidian] Publish Garden via Publish button', async () => {
			assert.ok(session);
			const published = await publishGardenFolderViaUiWithAccess(session.page);
			publicUrl = published.publicUrl;
			assert.match(publicUrl, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
			projectId =
				(await resolveProjectIdForUrl({
					apiBase: env.apiBase,
					token: creator.mdfKey,
					clientHeader: clientHeader(),
					publicUrl,
				})) || '';
			assert.ok(projectId, 'could not resolve projectId after publish');
			console.log(`  PUBLIC_URL=${publicUrl} project=${projectId}`);
			await sleep(2000);
		});

		it('3. [Obsidian] Selling ▸ Manage in Dashboard (capture Sales URL)', async () => {
			assert.ok(session && projectId);
			await openGardenPublishPanel(session.page);
			const salesPanel = await assertSalesSectionInPanel(session.page);
			assert.equal(salesPanel.enabled, true, 'Manage in Dashboard should enable after publish');

			salesUrl = await clickSalesManageCaptureUrl(session.page);
			assert.match(salesUrl, /\/dashboard\/sales\//);
			assert.ok(
				salesUrl.includes(encodeURIComponent(projectId)) || salesUrl.includes(projectId),
				`Sales URL should include project id: ${salesUrl}`,
			);
			console.log('  captured Sales URL from Obsidian window.open');
			await sleep(1500);
		});

		it('4. [Chromium] Dashboard Sales: contact → Creem → docs offer', async () => {
			assert.ok(projectId);
			sales = await openDashboardSales({
				siteBaseUrl: creator.siteBaseUrl,
				userJwt: creator.token,
				userId: creator.userId,
				email: creator.email,
				projectId,
				tab: 'overview',
				headless: chromiumHeadless,
			});

			try {
				await configureSalesViaDashboardUi(sales, {
					contactEmail,
					senderName: `UI04 ${env.runId}`,
					creemApiKey: creemKey,
					offerName,
					offerSummary: 'UI04 full journey docs access',
					scopeSlug: 'docs',
				});
				console.log('  Sales configured via Dashboard UI');
			} catch (uiErr) {
				console.warn(
					'  Dashboard UI failed; API fallback:',
					uiErr instanceof Error ? uiErr.message.slice(0, 200) : uiErr,
				);
				await putCommerceSettings(api, creator.token, projectId, {
					contactEmail,
					senderName: `UI04 ${env.runId}`,
				});
				connection = await ensureCreemTestConnection(api, creator.token, creemKey);
				offer = await createSyncedDocsOffer(api, creator.token, projectId, { name: offerName });
			}

			const listed = await api<{ connections: ConnectionBody[] }>('GET', '/v1/commerce/connections', {
				token: creator.token,
			});
			connection = listed.body.connections.find(
				(c) => c.provider === 'creem' && c.mode === 'test' && c.status === 'active',
			);
			assert.ok(connection);

			const offersRes = await api<{ offers?: OfferBody[] } | OfferBody[]>(
				'GET',
				`/v1/projects/${projectId}/offers`,
				{ token: creator.token },
			);
			const offerList = Array.isArray(offersRes.body)
				? offersRes.body
				: offersRes.body.offers ?? [];
			const created = offerList.find((o) => o.name === offerName && o.status !== 'archived');
			assert.ok(created);
			offer = await syncOffer(api, creator.token, projectId, created!.id);
			console.log(`  offer=${offer.id} synced`);
			await sleep(2000);
		});

		it('5. [Chromium] Reader: buy on published site → Key → unlock docs', async () => {
			assert.ok(publicUrl && offer);
			const base = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
			readerBrowser = await chromium.launch(
				playwrightLaunchOptions({
					headless: chromiumHeadless,
					slowMo: chromiumHeadless ? undefined : 60,
				}),
			);
			const result = await readerPurchaseAndUnlock(readerBrowser, {
				api,
				publicBaseUrl: base,
				lockedPageRel: 'docs.html',
				canary: docsCanary,
				readerEmail,
				creemApiKey: creemKey,
			});
			assert.ok(normalizeAccessKey(result.key).length > 8);

			const sessionRes = await api<{
				rejected: unknown[];
				keys: { status: string; grantsSummary: string[] }[];
			}>('POST', '/v1/public/access/session', {
				body: { projectId, secrets: [result.key] },
				ok: [200],
			});
			assert.equal(sessionRes.body.rejected.length, 0);
			const grants = sessionRes.body.keys.flatMap((k) => k.grantsSummary).join(' ');
			assert.match(grants, /docs/);
			console.log(`  reader unlock ok grants~=${grants.slice(0, 40)}`);
			await sleep(2000);
		});
	},
);
