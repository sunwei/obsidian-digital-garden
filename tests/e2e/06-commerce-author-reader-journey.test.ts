/**
 * G6 — Author → reader commerce journey (authoritative happy path).
 *
 * Spec: arch/commerce/12-e2e-author-reader-journey.md
 *
 * Personal login (JWT inject) → scoped publish → (optional custom domain) →
 * Dashboard Sales (contact + Creem test + offer) → publish again →
 * reader buys on the live site → Key unlocks encrypted docs.
 *
 * Opt-in (not part of default test:e2e:staging):
 *   E2E_COMMERCE=1 MDF_E2E_ENV=staging npm run test:e2e:commerce:staging
 *
 * Domain (optional, needs Aliyun + CF SaaS):
 *   E2E_COMMERCE_DOMAIN=1 …
 *
 * Browser UI (Dashboard Sales + Creem checkout + unlock) defaults to headless.
 * Set E2E_HEADED=1 to watch Chromium.
 *
 * Never logs JWTs, Creem keys, or Access Key plaintext.
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { ensureCommerceStubPages } from '../../src/commerce/commerce-pages.ts';
import { loadGardenE2eEnv } from './env.ts';
import {
	GardenPluginDriver,
	fetchThemeCatalog,
	pickE2eTheme,
	type PluginPublishResult,
	type PluginSite,
} from './garden-plugin-driver.ts';
import { createCommerceApi } from './helpers/commerce/api.ts';
import { cleanupCreemWebhooks, commercePrereqs, loadCreemTestApiKey } from './helpers/commerce/creem.ts';
import {
	createSyncedDocsOffer,
	ensureCreemTestConnection,
	putCommerceSettings,
	syncOffer,
	type ConnectionBody,
	type OfferBody,
} from './helpers/commerce/offers.ts';
import { readerPurchaseAndUnlock } from './helpers/commerce/reader.ts';
import { normalizeAccessKey } from './helpers/commerce/sanitize.ts';
import {
	bindE2eHostname,
	cleanupBoundDomain,
	domainPrereqs,
	loadDomainE2eConfig,
	type BoundDomain,
	type DomainE2eConfig,
} from './helpers/commerce/domain.ts';
import {
	cleanupStagingCreator,
	createStagingCreator,
	stagingCreatorPrereqs,
	type StagingCreator,
} from './staging-creator.ts';
import {
	closeSalesDashboard,
	configureSalesViaDashboardUi,
	openDashboardSales,
	type SalesDashboardSession,
} from './ui/sales-dashboard-harness.ts';
import { playwrightLaunchOptions } from './ui/playwright-launch.ts';
import { parseAccessShell } from './access-unlock.ts';

const creatorPrereq = stagingCreatorPrereqs();
const commerceGate = commercePrereqs();
const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_COMMERCE === '1' ||
	!creatorPrereq.ok ||
	!commerceGate.ok;

const skipReason =
	process.env.E2E_SKIP === '1' || process.env.E2E_SKIP_COMMERCE === '1'
		? 'E2E_SKIP / E2E_SKIP_COMMERCE set'
		: !creatorPrereq.ok
			? `staging creator prereqs: ${creatorPrereq.missing.join('; ')}`
			: !commerceGate.ok
				? commerceGate.missing.join('; ')
				: '';

const wantDomain = process.env.E2E_COMMERCE_DOMAIN === '1';
/** Default headless; E2E_HEADED=1 shows Dashboard / Creem / unlock browsers. */
const headed = process.env.E2E_HEADED === '1';

describe(
	'E2E Garden: commerce author→reader journey (G6)',
	{ skip, timeout: wantDomain ? 1_200_000 : 720_000 },
	() => {
		if (skip) {
			it(`skipped: ${skipReason}`, () => {
				console.log(`SKIP G6 commerce journey: ${skipReason}`);
			});
			return;
		}

		const env = loadGardenE2eEnv();
		const homeCanary = `MDF_G6_HOME_${env.runId}`;
		const docsCanary = `MDF_G6_DOCS_${env.runId}`;
		const membersCanary = `MDF_G6_MEMBERS_${env.runId}`;
		const docsTeaser = `Docs teaser ${env.runId}`;
		const offerName = `Garden G6 Offer ${env.runId}`;
		const contactEmail = `g6-creator-${env.runId}@mdfriday.test`;
		const readerEmail = `g6-reader-${env.runId}@mdfriday.test`;

		let driver: GardenPluginDriver;
		let creator: StagingCreator;
		let creemKey = '';
		let api = createCommerceApi(env.apiBase);
		let site: PluginSite | undefined;
		let published: PluginPublishResult | undefined;
		let projectId = '';
		let publicBaseUrl = '';
		let connection: ConnectionBody | undefined;
		let offer: OfferBody | undefined;
		let sales: SalesDashboardSession | undefined;
		let browser: Browser | undefined;
		let issuedKey = '';
		let salesViaUi = false;
		let domainCfg: DomainE2eConfig | undefined;
		let bound: BoundDomain | undefined;

		before(async () => {
			creemKey = loadCreemTestApiKey();
			if (wantDomain) {
				const d = domainPrereqs();
				assert.equal(d.ok, true, `E2E_COMMERCE_DOMAIN=1 but domain prereqs missing: ${d.missing.join('; ')}`);
				domainCfg = loadDomainE2eConfig(env.runId);
			}
			creator = await createStagingCreator('g6', env.runId, { plan: 'personal' });
			api = createCommerceApi(creator.apiBase);
			const account = await api<{ plan?: string; kind?: string }>('GET', '/v1/account', {
				token: creator.token,
			});
			assert.equal(account.body.kind, 'user');
			assert.equal(account.body.plan, 'personal');
			console.log(
				`  g6 creator user=${creator.userId} plan=${creator.plan} api=${creator.apiBase}` +
					(domainCfg ? ` hostname=${domainCfg.hostname}` : ''),
			);

			driver = new GardenPluginDriver({
				apiBaseUrl: env.apiBase,
				publicBaseUrl: env.shareBase,
			});
			await driver.init();
			browser = await chromium.launch(
				playwrightLaunchOptions({ headless: !headed, slowMo: headed ? 80 : undefined }),
			);
			if (headed) console.log('  E2E_HEADED=1 — Chromium visible for Sales / checkout / unlock');
		});

		after(async () => {
			await closeSalesDashboard(sales);
			if (browser) await browser.close().catch(() => undefined);

			const keep = process.env.E2E_KEEP_DATA === '1';
			if (keep && published) {
				const fixture = {
					runId: env.runId,
					userId: creator?.userId,
					projectId,
					siteId: published.siteId,
					publicBaseUrl,
					hostname: bound?.hostname,
					offerId: offer?.id,
					readerEmail,
					salesViaUi,
					note: 'E2E_KEEP_DATA=1 — Key not written; re-purchase or Dashboard orders',
				};
				const out = path.join(process.cwd(), '.e2e-commerce-last.json');
				writeFileSync(out, JSON.stringify(fixture, null, 2));
				console.log(`  E2E_KEEP_DATA=1 wrote ${out} publicBaseUrl=${publicBaseUrl}`);
			}

			try {
				await cleanupBoundDomain(api, creator.token, bound, domainCfg, { keepData: keep });
			} catch (err) {
				console.warn('domain cleanup', err instanceof Error ? err.message : err);
			}

			try {
				if (creemKey) await cleanupCreemWebhooks(creemKey, connection?.id ?? null);
			} catch (err) {
				console.warn('creem webhook cleanup', err instanceof Error ? err.message : err);
			}

			await cleanupStagingCreator(creator, {
				projectId: keep ? undefined : projectId || undefined,
				clientHeader: driver?.clientHeader,
				keepData: keep,
			});
			driver?.dispose();
		});

		it('1. Personal: publish public home + docs/members scopes (share)', async () => {
			const catalog = await fetchThemeCatalog(env.apiBase, creator.mdfKey);
			const theme = pickE2eTheme(catalog);
			assert.ok(theme.packUrl, `theme ${theme.slug} entitled for personal creator`);
			console.log(`  theme=${theme.slug}@${theme.version}`);

			driver.writeVault({
				'Garden/index.md': `---
title: G6 Commerce garden
---
# G6 Commerce garden

Public homepage. See [[docs]] and [[members]].

${homeCanary}
`,
				'Garden/docs.md': `---
title: Docs
access: protected
access_scope: docs
teaser: ${docsTeaser}
---
# Docs

${docsCanary}
`,
				'Garden/members.md': `---
title: Members
access: protected
access_scope: members
teaser: Members teaser ${env.runId}
---
# Members

${membersCanary}
`,
			});

			site = await driver.createFolderProject('g6-commerce', 'Garden', theme);
			const projectPath = driver.projectPath(site.name);
			assert.equal(existsSync(projectPath), true);

			published = await driver.buildAndPublish(
				site,
				{ token: creator.mdfKey, guest: false },
				{
					beforeBuild: async () => {
						await ensureCommerceStubPages({ projectPath, locale: 'en' });
					},
				},
			);
			projectId = published.projectId;
			publicBaseUrl = published.baseURL.endsWith('/') ? published.baseURL : `${published.baseURL}/`;
			assert.ok(published.baseURL.includes('/s/'));
			assert.ok(projectId.startsWith('p_'));

			const home = await fetch(publicBaseUrl);
			assert.equal(home.ok, true);
			const homeHtml = await home.text();
			assert.match(homeHtml, new RegExp(homeCanary));

			const docsRes = await fetch(new URL('docs.html', publicBaseUrl).href);
			assert.equal(docsRes.ok, true);
			const docsHtml = await docsRes.text();
			assert.equal(docsHtml.includes(docsCanary), false, 'docs canary must be encrypted');
			parseAccessShell(docsHtml, env.apiBase);

			for (const rel of ['purchase.html', 'pricing.html', 'privacy.html']) {
				const r = await fetch(new URL(rel, publicBaseUrl).href);
				assert.equal(r.ok, true, `${rel} missing after first publish`);
			}
			console.log(`  published share project=${projectId} base=${publicBaseUrl}`);
		});

		it('2. Dashboard Sales: contact email → Creem test → docs offer', async () => {
			assert.ok(projectId);
			sales = await openDashboardSales({
				siteBaseUrl: creator.siteBaseUrl,
				userJwt: creator.token,
				userId: creator.userId,
				email: creator.email,
				projectId,
				tab: 'overview',
				headless: !headed,
			});

			try {
				await configureSalesViaDashboardUi(sales, {
					contactEmail,
					senderName: `G6 ${env.runId}`,
					creemApiKey: creemKey,
					offerName,
					offerSummary: 'Garden G6 docs access (one-time)',
					scopeSlug: 'docs',
				});
				salesViaUi = true;
				console.log('  sales configured via Dashboard UI');
			} catch (uiErr) {
				console.warn(
					'  Dashboard Sales UI path failed; falling back to API helpers:',
					uiErr instanceof Error ? uiErr.message.slice(0, 200) : uiErr,
				);
				await putCommerceSettings(api, creator.token, projectId, {
					contactEmail,
					senderName: `G6 ${env.runId}`,
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
			assert.ok(connection, 'Creem test connection active');

			const offersRes = await api<{ offers?: OfferBody[] } | OfferBody[]>(
				'GET',
				`/v1/projects/${projectId}/offers`,
				{ token: creator.token },
			);
			const offerList = Array.isArray(offersRes.body)
				? offersRes.body
				: offersRes.body.offers ?? [];
			const created = offerList.find((o) => o.name === offerName && o.status !== 'archived');
			assert.ok(created, 'offer created');
			offer = await syncOffer(api, creator.token, projectId, created!.id);
			const oneTime = offer.prices.find((p) => p.billing === 'one_time');
			assert.ok(oneTime, 'one-time price');
			const synced = (oneTime!.listings ?? []).every((l) => l.syncStatus === 'synced');
			assert.equal(synced, true, 'listing synced to Creem');
			console.log(`  offer=${offer.id} connection=${connection!.id}`);
		});

		it('3. Publish again (commerce shell / hosting ready; C19 products need no republish)', async () => {
			assert.ok(site && published);
			const projectPath = driver.projectPath(site.name);
			published = await driver.buildAndPublish(
				site,
				{ token: creator.mdfKey, guest: false },
				{
					force: true,
					beforeBuild: async () => {
						await ensureCommerceStubPages({ projectPath, locale: 'en' });
					},
				},
			);
			publicBaseUrl = published.baseURL.endsWith('/') ? published.baseURL : `${published.baseURL}/`;
			assert.equal(published.projectId, projectId);

			const docsRes = await fetch(new URL('docs.html', publicBaseUrl).href);
			assert.equal(docsRes.ok, true);
			const docsHtml = await docsRes.text();
			assert.equal(docsHtml.includes(docsCanary), false);
			// Offers render at runtime — lock page should expose commerce slot after theme stamp
			assert.match(docsHtml, /mdf-access-card|mdf-encrypt-content/i);
			console.log(`  second publish ok base=${publicBaseUrl}`);
		});

		it('4. Reader: buy on published site → Key → unlock docs canary', async () => {
			assert.ok(browser && publicBaseUrl && offer);
			const result = await readerPurchaseAndUnlock(browser, {
				api,
				publicBaseUrl,
				lockedPageRel: 'docs.html',
				canary: docsCanary,
				readerEmail,
				creemApiKey: creemKey,
			});
			issuedKey = result.key;
			assert.ok(normalizeAccessKey(issuedKey).length > 8);

			// Members must stay locked (offer grants docs only)
			const membersHtml = await (await fetch(new URL('members.html', publicBaseUrl).href)).text();
			assert.equal(membersHtml.includes(membersCanary), false);

			const session = await api<{
				rejected: unknown[];
				keys: { status: string; grantsSummary: string[] }[];
			}>('POST', '/v1/public/access/session', {
				body: { projectId, secrets: [issuedKey] },
				ok: [200],
			});
			assert.equal(session.body.rejected.length, 0);
			assert.ok(session.body.keys.some((k) => k.status === 'active'));
			const grants = session.body.keys.flatMap((k) => k.grantsSummary).join(' ');
			assert.match(grants, /docs/);
			console.log(`  reader purchase ok grants~=${grants.slice(0, 40)}`);
		});

		it('5. Custom domain: bind → republish custom → buy & unlock on hostname', async () => {
			if (!wantDomain) {
				console.log(
					'  skip domain — set E2E_COMMERCE_DOMAIN=1 (+ Aliyun/CF SaaS) to bind e2e hostname',
				);
				return;
			}
			assert.ok(site && projectId && domainCfg && browser && offer);

			bound = await bindE2eHostname(api, creator.token, projectId, domainCfg);
			assert.equal(bound.hostname, domainCfg.hostname);

			const projectPath = driver.projectPath(site.name);
			published = await driver.buildAndPublish(
				site,
				{ token: creator.mdfKey, guest: false },
				{
					force: true,
					hostingMode: 'custom',
					publicBaseUrl: bound.publicBaseUrl,
					beforeBuild: async () => {
						await ensureCommerceStubPages({ projectPath, locale: 'en' });
					},
				},
			);
			publicBaseUrl = published.baseURL.endsWith('/') ? published.baseURL : `${published.baseURL}/`;
			assert.equal(published.projectId, projectId);
			assert.ok(
				publicBaseUrl.includes(bound.hostname),
				`expected custom baseURL with ${bound.hostname}, got ${publicBaseUrl}`,
			);

			const home = await fetch(publicBaseUrl);
			assert.equal(home.ok, true, `custom home ${publicBaseUrl} → ${home.status}`);
			const homeHtml = await home.text();
			assert.match(homeHtml, new RegExp(homeCanary));

			const docsRes = await fetch(new URL('docs.html', publicBaseUrl).href);
			assert.equal(docsRes.ok, true);
			const docsHtml = await docsRes.text();
			assert.equal(docsHtml.includes(docsCanary), false, 'docs still encrypted on custom domain');

			const domainReader = `g6-domain-reader-${env.runId}@mdfriday.test`;
			const result = await readerPurchaseAndUnlock(browser, {
				api,
				publicBaseUrl,
				lockedPageRel: 'docs.html',
				canary: docsCanary,
				readerEmail: domainReader,
				creemApiKey: creemKey,
			});
			assert.ok(normalizeAccessKey(result.key).length > 8);
			console.log(
				`  domain journey ok hostname=${bound.hostname} certWait=${bound.certWaitSeconds}s ca=${bound.certCa}`,
			);
		});
	},
);
