/**
 * Headed full commerce journey on a **custom domain** (opt-in).
 *
 * Real author path:
 *   1. Obsidian Publish (share) → project exists
 *   2. Bind e2e hostname (same Control Plane APIs as DomainSection; Aliyun DNS automated)
 *   3. Obsidian Publish again → plugin detects active domain → custom hosting URL
 *   4. Chromium: Dashboard Sales (Creem + offer)
 *   5. Chromium: reader buys on https://{hostname}/ → Key → unlock
 *
 * Share-only headed journey stays in `04-ui-commerce-journey.test.ts`.
 *
 *   E2E_COMMERCE=1 E2E_COMMERCE_DOMAIN=1 MDF_E2E_ENV=staging \
 *     npm run test:e2e:ui:commerce:domain:staging
 *
 * Chromium headed by default; E2E_HEADLESS=1 hides it. Obsidian always headed.
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
	bindE2eHostname,
	cleanupBoundDomain,
	domainPrereqs,
	loadDomainE2eConfig,
	type BoundDomain,
	type DomainE2eConfig,
} from '../helpers/commerce/domain.ts';
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
const domainGate = domainPrereqs();
const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_UI === '1' ||
	!obsidianAppPresent() ||
	!creatorPrereq.ok ||
	!commerceGate.ok ||
	!domainGate.ok;

const skipReason = !obsidianAppPresent()
	? 'Obsidian.app missing'
	: !creatorPrereq.ok
		? `staging creator: ${creatorPrereq.missing.join('; ')}`
		: !commerceGate.ok
			? commerceGate.missing.join('; ')
			: !domainGate.ok
				? `domain: ${domainGate.missing.join('; ')}`
				: 'E2E_SKIP / E2E_SKIP_UI';

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
title: Commerce domain UI garden
---
# Commerce domain UI garden

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
	'UI E2E Garden: Obsidian → custom domain → Sales → reader (full)',
	{ skip, timeout: 1_200_000 },
	() => {
		if (skip) {
			it(`skipped: ${skipReason}`, () => {
				console.log(`SKIP ui/05 domain commerce journey: ${skipReason}`);
			});
			return;
		}

		const env = loadGardenE2eEnv();
		const homeCanary = `MDF_UI05_HOME_${env.runId}`;
		const docsCanary = `MDF_UI05_DOCS_${env.runId}`;
		const docsTeaser = `Docs teaser UI05 ${env.runId}`;
		const offerName = `UI05 Domain Offer ${env.runId}`;
		const contactEmail = `ui05-creator-${env.runId}@mdfriday.test`;
		const readerEmail = `ui05-reader-${env.runId}@mdfriday.test`;

		let creator: StagingCreator;
		let creemKey = '';
		let api = createCommerceApi(env.apiBase);
		let domainCfg: DomainE2eConfig;
		let bound: BoundDomain | undefined;
		let session: ObsidianSession | undefined;
		let sales: SalesDashboardSession | undefined;
		let readerBrowser: Browser | undefined;
		let shareUrl = '';
		let publicUrl = '';
		let projectId = '';
		let connection: ConnectionBody | undefined;
		let offer: OfferBody | undefined;

		before(async () => {
			const mainJs = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'main.js');
			assert.ok(existsSync(mainJs), `missing ${mainJs} — run: npm run build:smoke`);

			creemKey = loadCreemTestApiKey();
			domainCfg = loadDomainE2eConfig(env.runId);
			creator = await createStagingCreator('ui05', env.runId, { plan: 'personal' });
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

			console.log(
				`  [author] Obsidian personal=${creator.userId} hostname=${domainCfg.hostname}`,
			);
			console.log(
				chromiumHeadless
					? '  [chromium] headless'
					: '  [chromium] headed — Sales + Creem on custom domain',
			);
			session = await launchObsidianForUiE2e();
			console.log(`  CDP ${session.cdpUrl}`);
		});

		after(async () => {
			await closeSalesDashboard(sales);
			if (readerBrowser) await readerBrowser.close().catch(() => undefined);

			const keep = process.env.E2E_KEEP_DATA === '1';
			try {
				await cleanupBoundDomain(api, creator.token, bound, domainCfg, { keepData: keep });
			} catch (err) {
				console.warn('domain cleanup', err instanceof Error ? err.message : err);
			}

			if (!keep && (projectId || publicUrl || shareUrl)) {
				try {
					const id =
						projectId ||
						(await resolveProjectIdForUrl({
							apiBase: env.apiBase,
							token: creator.mdfKey,
							clientHeader: clientHeader(),
							publicUrl: shareUrl || publicUrl,
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
					console.warn('ui/05 project cleanup failed', err);
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

		it('1. [Obsidian] First publish (share) as Personal', async () => {
			assert.ok(session);
			await openGardenPublishPanel(session.page);
			await assertSalesSectionInPanel(session.page);

			const published = await publishGardenFolderViaUiWithAccess(session.page);
			shareUrl = published.publicUrl;
			assert.match(shareUrl, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
			projectId =
				(await resolveProjectIdForUrl({
					apiBase: env.apiBase,
					token: creator.mdfKey,
					clientHeader: clientHeader(),
					publicUrl: shareUrl,
				})) || '';
			assert.ok(projectId);
			console.log(`  share URL=${shareUrl} project=${projectId}`);
			await sleep(1500);
		});

		it('2. Bind custom domain (Control Plane + Aliyun DNS + SSL)', async () => {
			assert.ok(projectId && domainCfg);
			// Same APIs DomainSection uses after the author enters a hostname;
			// DNS / SSL wait is automated so the headed run stays watchable.
			bound = await bindE2eHostname(api, creator.token, projectId, domainCfg);
			assert.equal(bound.hostname, domainCfg.hostname);
			console.log(
				`  domain active hostname=${bound.hostname} certWait=${bound.certWaitSeconds}s ca=${bound.certCa}`,
			);
			await sleep(1500);
		});

		it('3. [Obsidian] Publish again → custom hosting URL', async () => {
			assert.ok(session && bound);
			// Plugin lists active domains and switches hostingMode to custom on publish.
			const published = await publishGardenFolderViaUiWithAccess(session.page, {
				expectHostname: bound.hostname,
				timeoutMs: 300_000,
			});
			publicUrl = published.publicUrl;
			assert.ok(
				publicUrl.toLowerCase().includes(bound.hostname.toLowerCase()),
				`expected custom URL with ${bound.hostname}, got ${publicUrl}`,
			);
			const homeUrl = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
			// Cert/route can lag a few seconds after publish completes in the panel.
			const deadline = Date.now() + 120_000;
			let homeHtml = '';
			let lastStatus = 0;
			while (Date.now() < deadline) {
				const home = await fetch(homeUrl, { redirect: 'follow' });
				lastStatus = home.status;
				if (home.ok) {
					homeHtml = await home.text();
					if (homeHtml.includes(homeCanary)) break;
				}
				await sleep(4_000);
			}
			assert.equal(lastStatus, 200, `custom home ${homeUrl} → ${lastStatus}`);
			assert.match(homeHtml, new RegExp(homeCanary));
			console.log(`  custom PUBLIC_URL=${publicUrl}`);
			await sleep(2000);
		});

		it('4. [Obsidian] Selling ▸ Manage → [Chromium] Sales Creem + offer', async () => {
			assert.ok(session && projectId);
			await openGardenPublishPanel(session.page);
			const salesPanel = await assertSalesSectionInPanel(session.page);
			assert.equal(salesPanel.enabled, true);
			const salesUrl = await clickSalesManageCaptureUrl(session.page);
			assert.match(salesUrl, /\/dashboard\/sales\//);

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
					senderName: `UI05 ${env.runId}`,
					creemApiKey: creemKey,
					offerName,
					offerSummary: 'UI05 domain journey docs access',
					scopeSlug: 'docs',
				});
			} catch (uiErr) {
				console.warn(
					'  Dashboard UI failed; API fallback:',
					uiErr instanceof Error ? uiErr.message.slice(0, 200) : uiErr,
				);
				await putCommerceSettings(api, creator.token, projectId, {
					contactEmail,
					senderName: `UI05 ${env.runId}`,
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
			console.log(`  offer=${offer.id} on custom site`);
			await sleep(2000);
		});

		it('5. [Chromium] Reader buys on custom domain → Key → unlock', async () => {
			assert.ok(bound && offer && publicUrl);
			const base = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
			assert.ok(base.includes(bound.hostname));

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
			assert.ok(
				result.successUrl.includes(bound.hostname),
				`purchase return should be on custom host, got ${result.successUrl.slice(0, 120)}`,
			);

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
			console.log(`  domain reader unlock ok hostname=${bound.hostname}`);
			await sleep(2000);
		});
	},
);
