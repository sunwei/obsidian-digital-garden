/**
 * G4 — Multi-scope + Dashboard (staging):
 * Homepage public + two independent scopes (docs, members) →
 * publish as staging creator → home readable / both details locked →
 * Dashboard UI issues a key granted to BOTH scopes → unlocks both →
 * a single-scope key must not unlock the other page →
 * revoke multi-grant key → both re-lock.
 *
 * Does not replace G2 (guest root-protect). Skips when E2E_SKIP=1 or
 * staging creator prereqs missing (cloudflare/.staging.vars + wrangler).
 *
 *   MDF_E2E_ENV=staging node --test --test-timeout=480000 tests/e2e/04-access-multiscope-dashboard.test.ts
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
import {
	cleanupStagingCreator,
	createStagingCreator,
	stagingCreatorPrereqs,
	type StagingCreator,
} from './staging-creator.ts';
import {
	closeDashboard,
	issueAccessKeyViaDashboardUi,
	openDashboardAccess,
	revokeAccessKeyViaDashboardUi,
	type DashboardSession,
} from './ui/dashboard-harness.ts';
import {
	probePublishedPage,
	tryUnlockPublishedPageInBrowser,
} from './ui/visitor-unlock.ts';

const prereq = stagingCreatorPrereqs();
const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_ACCESS === '1' ||
	!prereq.ok;

const skipReason =
	process.env.E2E_SKIP === '1' || process.env.E2E_SKIP_ACCESS === '1'
		? 'E2E_SKIP / E2E_SKIP_ACCESS set'
		: !prereq.ok
			? `staging creator prereqs missing: ${prereq.missing.join('; ')}`
			: '';

describe(
	'E2E Garden: multi-scope (docs+members) + Dashboard grants (G4)',
	{ skip, timeout: 480_000 },
	() => {
		if (skip) {
			it(`skipped: ${skipReason}`, () => {
				console.log(`SKIP G4 multi-scope Dashboard E2E: ${skipReason}`);
			});
			return;
		}

		const env = loadGardenE2eEnv();
		const homeCanary = `MDF_GARDEN_HOME_PUBLIC_${env.runId}`;
		const docsCanary = `MDF_GARDEN_DOCS_SECRET_${env.runId}`;
		const membersCanary = `MDF_GARDEN_MEMBERS_SECRET_${env.runId}`;
		const docsTeaser = `Docs teaser ${env.runId}`;
		const membersTeaser = `Members teaser ${env.runId}`;
		const scopes = ['docs', 'members'] as const;

		let driver: GardenPluginDriver;
		let creator: StagingCreator;
		let published: PluginPublishResult | undefined;
		let projectId = '';
		let homeUrl = '';
		let docsUrl = '';
		let membersUrl = '';
		let multiKey = '';
		let docsOnlyKey = '';
		let dash: DashboardSession | undefined;
		const labelMulti = `G4m-${env.runId.slice(-6)}`;
		const labelDocs = `G4d-${env.runId.slice(-6)}`;

		before(async () => {
			creator = await createStagingCreator('g4', env.runId);
			console.log(
				`  creator user=${creator.userId} api=${creator.apiBase} site=${creator.siteBaseUrl}`,
			);
			driver = new GardenPluginDriver({
				apiBaseUrl: env.apiBase,
				publicBaseUrl: env.shareBase,
			});
			await driver.init();
		});

		after(async () => {
			await closeDashboard(dash);
			const keep = process.env.E2E_KEEP_DATA === '1';
			if (keep && published) {
				console.log(`  E2E_KEEP_DATA=1 keeping project=${projectId} url=${published.baseURL}`);
			}
			await cleanupStagingCreator(creator, {
				projectId: keep ? undefined : projectId || undefined,
				clientHeader: driver?.clientHeader,
				keepData: keep,
			});
			driver?.dispose();
		});

		it('1. publish folder: public home + docs/members independent scopes', async () => {
			const catalog = await fetchThemeCatalog(env.apiBase, creator.mdfKey);
			const quartz =
				catalog.find((e) => e.slug === 'quartz') ||
				catalog.find((e) => (e.kinds || []).includes('folder') && e.packUrl);
			assert.ok(quartz?.packUrl, 'quartz entitled for staging creator');

			driver.writeVault({
				'Garden/index.md': `---
title: Multi-scope garden
---
# Multi-scope garden

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
teaser: ${membersTeaser}
---
# Members

${membersCanary}
`,
			});

			const site = await driver.createFolderProject('garden-multiscope', 'Garden', quartz!);
			published = await driver.buildAndPublish(
				site,
				{ token: creator.mdfKey, guest: false },
				{ force: true },
			);
			projectId = published.projectId;
			assert.ok(projectId, 'projectId');
			assert.match(published.baseURL, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
			assert.ok(
				!published.sharedKeys?.length,
				'public-root multi-scope must not return auto sharedKeys',
			);

			homeUrl = `${published.baseURL}index.html`;
			docsUrl = `${published.baseURL}docs.html`;
			membersUrl = `${published.baseURL}members.html`;
			console.log(
				`  project=${projectId} home=${homeUrl} docs=${docsUrl} members=${membersUrl} theme=${quartz!.slug}@${quartz!.version}`,
			);
		});

		it('2. homepage public; both details locked with distinct scopes', async () => {
			assert.ok(homeUrl && docsUrl && membersUrl);
			const home = await probePublishedPage({
				pageUrl: `${homeUrl}?g4=${env.runId}`,
				canary: homeCanary,
			});
			assert.equal(home.status, 200, home.html.slice(0, 200));
			assert.equal(home.hasCanary, true, 'homepage must show public canary');
			assert.equal(home.hasAccessShell, false, 'homepage must not be an access shell');

			for (const [url, canary, teaser, scope] of [
				[docsUrl, docsCanary, docsTeaser, 'docs'],
				[membersUrl, membersCanary, membersTeaser, 'members'],
			] as const) {
				const detail = await probePublishedPage({
					pageUrl: `${url}?g4=${env.runId}`,
					canary,
					teaser,
				});
				assert.equal(detail.status, 200, detail.html.slice(0, 200));
				assert.equal(detail.hasCanary, false, `${scope} must not leak canary`);
				assert.equal(detail.hasAccessShell, true, `${scope} must have format-2 shell`);
				const shell = parseAccessShell(detail.html, env.apiBase);
				assert.equal(shell.projectId, projectId);
				assert.equal(shell.scope, scope);
				console.log(`  locked scope=${shell.scope} resource=${shell.resourceId}`);
			}
		});

		it('3. Dashboard: multi-scope key unlocks both; docs-only key fails on members', async () => {
			assert.ok(projectId && docsUrl && membersUrl);
			dash = await openDashboardAccess({
				siteBaseUrl: creator.siteBaseUrl,
				userJwt: creator.token,
				userId: creator.userId,
				email: creator.email,
				projectId,
				headless: false,
			});

			const multi = await issueAccessKeyViaDashboardUi(dash, {
				label: labelMulti,
				scopeSlugs: [...scopes],
			});
			multiKey = multi.secret;
			assert.equal(multiKey.length, 17);

			const docsOnly = await issueAccessKeyViaDashboardUi(dash, {
				label: labelDocs,
				scopeSlugs: ['docs'],
			});
			docsOnlyKey = docsOnly.secret;
			assert.equal(docsOnlyKey.length, 17);
			assert.notEqual(docsOnlyKey, multiKey);

			// Supporting API decrypt
			const docsHtml = await (await fetch(`${docsUrl}?api=${env.runId}`)).text();
			const membersHtml = await (await fetch(`${membersUrl}?api=${env.runId}`)).text();
			assert.ok(
				(await unlockPublishedPage(env.apiBase, docsHtml, multiKey)).plainHtml.includes(
					docsCanary,
				),
			);
			assert.ok(
				(await unlockPublishedPage(env.apiBase, membersHtml, multiKey)).plainHtml.includes(
					membersCanary,
				),
			);
			assert.ok(
				(await unlockPublishedPage(env.apiBase, docsHtml, docsOnlyKey)).plainHtml.includes(
					docsCanary,
				),
			);
			await assert.rejects(
				() => unlockPublishedPage(env.apiBase, membersHtml, docsOnlyKey),
				/denied|rejected|no_cek|scope/i,
			);

			const wrong = inventWrongAccessKey();
			const wrongSession = await createAccessSession(env.apiBase, projectId, [wrong]);
			assert.ok(!wrongSession.token, 'wrong key must not mint session');

			const multiDocsUi = await tryUnlockPublishedPageInBrowser({
				pageUrl: `${docsUrl}?ok=${env.runId}`,
				accessKey: multiKey,
				canary: docsCanary,
				teaser: docsTeaser,
				expectUnlock: true,
			});
			assert.equal(multiDocsUi.unlocked, true, 'multi-grant must unlock docs');

			const multiMembersUi = await tryUnlockPublishedPageInBrowser({
				pageUrl: `${membersUrl}?ok=${env.runId}`,
				accessKey: multiKey,
				canary: membersCanary,
				teaser: membersTeaser,
				expectUnlock: true,
			});
			assert.equal(multiMembersUi.unlocked, true, 'multi-grant must unlock members');

			const docsOnlyOnMembers = await tryUnlockPublishedPageInBrowser({
				pageUrl: `${membersUrl}?docsOnly=${env.runId}`,
				accessKey: docsOnlyKey,
				canary: membersCanary,
				teaser: membersTeaser,
				expectUnlock: false,
			});
			assert.equal(
				docsOnlyOnMembers.unlocked,
				false,
				'docs-only key must not unlock members page',
			);

			const home = await probePublishedPage({
				pageUrl: `${homeUrl}?after=${env.runId}`,
				canary: homeCanary,
			});
			assert.equal(home.hasCanary, true, 'homepage still public after issuing keys');
		});

		it('4. Dashboard: revoke multi-grant key; both details lock again', async () => {
			assert.ok(dash && multiKey && docsUrl && membersUrl);
			await revokeAccessKeyViaDashboardUi(dash, { label: labelMulti });

			for (const [url, canary, teaser] of [
				[docsUrl, docsCanary, docsTeaser],
				[membersUrl, membersCanary, membersTeaser],
			] as const) {
				const after = await tryUnlockPublishedPageInBrowser({
					pageUrl: `${url}?revoked=${env.runId}`,
					accessKey: multiKey,
					canary,
					teaser,
					expectUnlock: false,
				});
				assert.equal(after.unlocked, false, `revoked multi-key must not unlock ${url}`);
			}

			const session = await createAccessSession(env.apiBase, projectId, [multiKey]);
			assert.ok(!session.token, 'revoked multi-key must not mint session');

			const home = await probePublishedPage({
				pageUrl: `${homeUrl}?rev=${env.runId}`,
				canary: homeCanary,
			});
			assert.equal(home.hasCanary, true, 'homepage still public after revoke');
		});
	},
);
