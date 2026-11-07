/**
 * G3 — Headed Garden Access journey (staging), page-frontmatter model:
 * Multi-scope fixture on disk (home public + docs/members protected) →
 * Obsidian Publish UI (no sidebar Access editor) → assert published HTML:
 * home readable, each detail locked (no canary / format-2 shell).
 *
 * Dashboard multi-grant unlock/revoke lives in G4 (04-access-multiscope-dashboard).
 * Root is public → no auto sharedKeys / Notice key.
 *
 * Skip without Obsidian.app or when E2E_SKIP / E2E_SKIP_UI / E2E_SKIP_ACCESS=1.
 *
 *   E2E_KEEP_DATA=1 MDF_E2E_ENV=staging node --test --test-timeout=420000 tests/e2e/ui/03-ui-access-journey.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadGardenE2eEnv } from '../env.ts';
import {
	PLUGIN_ID,
	REPO_ROOT,
	SMOKE_VAULT,
	assertAccessKeysLinkInPanel,
	closeObsidianSession,
	deleteStagingProject,
	launchObsidianForUiE2e,
	obsidianAppPresent,
	openGardenPublishPanel,
	publishGardenFolderViaUiWithAccess,
	readSmokePluginData,
	resolveProjectIdForUrl,
	type ObsidianSession,
} from './obsidian-harness.ts';
import { probePublishedPage } from './visitor-unlock.ts';

const skip =
	process.env.E2E_SKIP === '1' ||
	process.env.E2E_SKIP_UI === '1' ||
	process.env.E2E_SKIP_ACCESS === '1' ||
	!obsidianAppPresent();

const skipReason = !obsidianAppPresent()
	? 'Obsidian.app not installed — UI E2E is macOS/desktop only'
	: process.env.E2E_SKIP_ACCESS === '1'
		? 'E2E_SKIP_ACCESS set'
		: process.env.E2E_SKIP_UI === '1' || process.env.E2E_SKIP === '1'
			? 'E2E_SKIP / E2E_SKIP_UI set'
			: '';

function clientHeader(): string {
	const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')) as {
		version?: string;
	};
	return `obsidian-garden/${manifest.version ?? '0.0.0'}`;
}

/** Multi-scope: public home + two independent protected pages. */
function prepareMultiScopeVault(opts: {
	homeCanary: string;
	docsCanary: string;
	membersCanary: string;
	docsTeaser: string;
	membersTeaser: string;
}): void {
	const gardenDir = path.join(SMOKE_VAULT, 'Garden');
	mkdirSync(gardenDir, { recursive: true });
	writeFileSync(
		path.join(gardenDir, 'index.md'),
		`---
title: Access garden
---
# Access garden

Public homepage (G3 multi-scope).

See [[docs]] and [[members]].

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
	writeFileSync(
		path.join(gardenDir, 'members.md'),
		`---
title: Members
access: protected
access_scope: members
teaser: ${opts.membersTeaser}
---
# Members

${opts.membersCanary}
`,
		'utf8',
	);
}

function prepPluginDataForAccessPublish(): void {
	const dataPath = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');
	if (!existsSync(dataPath)) return;
	const data = JSON.parse(readFileSync(dataPath, 'utf8')) as Record<string, unknown>;
	data.pathConfigs = {
		Garden: {
			mode: 'themed',
			themeSlug: 'quartz',
			hasPasswordFlag: false,
			updatedAt: Date.now(),
		},
	};
	data.cloudflareEnv = 'staging';
	data.cloudflareResolvedEnv = 'staging';
	data.cloudflareApiBaseUrl = 'https://api.fsky.top';
	data.cloudflarePublicBaseUrl = 'https://share.fsky.top';
	writeFileSync(dataPath, JSON.stringify(data, null, 2));

	const localProject = path.join(
		SMOKE_VAULT,
		'.obsidian/plugins',
		PLUGIN_ID,
		'workspace/projects/Garden',
	);
	if (existsSync(localProject)) {
		rmSync(localProject, { recursive: true, force: true });
		console.log('  cleared local Foundry project cache for Garden');
	}
}

async function deleteAllGuestProjects(apiBase: string, token: string, header: string): Promise<number> {
	const res = await fetch(`${apiBase.replace(/\/$/, '')}/v1/projects`, {
		headers: { authorization: `Bearer ${token}`, 'X-MDFriday-Client': header },
	});
	if (!res.ok) return 0;
	const body = (await res.json()) as {
		projects?: Array<{ id?: string; projectId?: string }>;
	};
	let n = 0;
	for (const p of body.projects || []) {
		const id = p.id || p.projectId;
		if (!id) continue;
		await deleteStagingProject({ apiBase, projectId: id, token, clientHeader: header });
		n += 1;
	}
	return n;
}

describe(
	'UI E2E Garden: multi-scope page frontmatter → publish (G3)',
	{ skip, timeout: 420_000 },
	() => {
		if (skip) {
			it(`skipped: ${skipReason}`, () => {
				console.log(`SKIP UI access E2E: ${skipReason}`);
			});
			return;
		}

		const env = loadGardenE2eEnv();
		const homeCanary = `MDF_GARDEN_UI_HOME_${env.runId}`;
		const docsCanary = `MDF_GARDEN_UI_DOCS_${env.runId}`;
		const membersCanary = `MDF_GARDEN_UI_MEMBERS_${env.runId}`;
		const docsTeaser = `Docs teaser UI ${env.runId}`;
		const membersTeaser = `Members teaser UI ${env.runId}`;
		let session: ObsidianSession | undefined;
		let publicUrl = '';
		let projectId: string | null = null;

		before(async () => {
			const mainJs = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'main.js');
			assert.ok(existsSync(mainJs), `missing ${mainJs} — run: npm run build:smoke`);
			const rootMain = path.join(REPO_ROOT, 'main.js');
			const st = existsSync(rootMain) ? readFileSync(rootMain) : null;
			assert.ok(st && st.byteLength > 500_000, 'main.js implausibly small — run npm run build:smoke');

			prepareMultiScopeVault({
				homeCanary,
				docsCanary,
				membersCanary,
				docsTeaser,
				membersTeaser,
			});
			prepPluginDataForAccessPublish();

			const data = readSmokePluginData();
			const header = clientHeader();
			if (data.mdfKey) {
				const deleted = await deleteAllGuestProjects(env.apiBase, data.mdfKey, header);
				console.log(`  cleared ${deleted} prior staging project(s)`);
			}

			console.log('  launching headed Obsidian (smoke-vault) for G3 multi-scope…');
			session = await launchObsidianForUiE2e();
			console.log(`  CDP ${session.cdpUrl}  userData=${session.userDataDir}`);
		});

		after(async () => {
			const keep = process.env.E2E_KEEP_DATA === '1';
			if (!keep && publicUrl) {
				try {
					const data = readSmokePluginData();
					const header = clientHeader();
					if (data.mdfKey) {
						projectId =
							projectId ||
							(await resolveProjectIdForUrl({
								apiBase: env.apiBase,
								token: data.mdfKey,
								clientHeader: header,
								publicUrl,
							}));
						if (projectId) {
							await deleteStagingProject({
								apiBase: env.apiBase,
								projectId,
								token: data.mdfKey,
								clientHeader: header,
							});
							console.log(`  cleaned project ${projectId}`);
						}
					}
				} catch (err) {
					console.warn('G3 UI E2E cleanup failed', err);
				}
			} else if (keep && publicUrl) {
				console.log(`  E2E_KEEP_DATA=1 — leaving site up: ${publicUrl}`);
			}
			await closeObsidianSession(session);
		});

		it('1. Sidebar has no Access editor; Dashboard manage-keys link present', async () => {
			assert.ok(session, 'Obsidian session missing');
			await openGardenPublishPanel(session.page);
			const link = await assertAccessKeysLinkInPanel(session.page);
			assert.ok(link.visible);
			console.log(`  access keys link ${link.hrefOrDisabled}`);

			// Disk fixture still has multi-scope frontmatter (not written by sidebar)
			const docsOnDisk = readFileSync(path.join(SMOKE_VAULT, 'Garden/docs.md'), 'utf8');
			assert.match(docsOnDisk, /access:\s*protected/);
			assert.match(docsOnDisk, /access_scope:\s*docs/);
			const indexOnDisk = readFileSync(path.join(SMOKE_VAULT, 'Garden/index.md'), 'utf8');
			assert.doesNotMatch(indexOnDisk, /access:\s*protected/);
		});

		it('2. Publish via Garden UI (page frontmatter, no sidebar Access)', async () => {
			assert.ok(session, 'Obsidian session missing');
			const published = await publishGardenFolderViaUiWithAccess(session.page);
			publicUrl = published.publicUrl;
			assert.match(publicUrl, /^https:\/\/share\.fsky\.top\/s\/[^/]+\/$/);
			// Root public → no auto shared key expected
			if (published.sharedKey) {
				console.warn('  unexpected sharedKey on public-root publish (ignored)');
			}
			console.log(`  PUBLIC_URL=${publicUrl}`);
		});

		it('3. Home public; docs + members locked (multi-scope shells)', async () => {
			assert.ok(publicUrl, 'missing publish URL');
			const home = await probePublishedPage({
				pageUrl: `${publicUrl}index.html?g3=${env.runId}`,
				canary: homeCanary,
			});
			assert.equal(home.status, 200);
			assert.equal(home.hasCanary, true, 'homepage must be public');
			assert.equal(home.hasAccessShell, false, 'homepage must not be locked');

			for (const [rel, canary, teaser, scope] of [
				['docs.html', docsCanary, docsTeaser, 'docs'],
				['members.html', membersCanary, membersTeaser, 'members'],
			] as const) {
				const page = await probePublishedPage({
					pageUrl: `${publicUrl}${rel}?g3=${env.runId}`,
					canary,
					teaser,
				});
				assert.equal(page.status, 200, rel);
				assert.equal(page.hasCanary, false, `${rel} must not leak canary`);
				assert.equal(page.hasAccessShell, true, `${rel} must have format-2 shell`);
				assert.ok(page.hasTeaser || /unlock|access|teaser/i.test(page.html), `${rel} teaser`);
				assert.match(page.html, new RegExp(`data-scope=["']${scope}["']`));
				console.log(`  locked ${rel} scope=${scope}`);
			}
		});
	},
);
