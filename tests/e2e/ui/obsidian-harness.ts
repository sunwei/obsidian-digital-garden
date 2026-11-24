/**
 * Headed Obsidian launcher for Garden UI E2E.
 *
 * Dedicated --user-data-dir (does not touch Wayde's normal session).
 * Pre-seeds Restricted Mode OFF via localStorage `enable-plugin-<vaultId>` so
 * Obsidian never shows "Trust author…" (that button opens Community plugins —
 * which we must NOT visit; the plugin is already installed in the vault).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SMOKE_VAULT = path.join(REPO_ROOT, 'tests/smoke-vault');
export const OBSIDIAN_APP = '/Applications/Obsidian.app';
export const OBSIDIAN_BIN = path.join(OBSIDIAN_APP, 'Contents/MacOS/Obsidian');
export const PLUGIN_ID = 'mdfriday-garden';
export const PUBLISH_MENU = 'Publish with MDFriday Digital Garden';
export const OPEN_IN_MENU = 'Open in MDFriday Digital Garden';
export const E2E_VAULT_ID = 'e2egarden0000001';

const DEFAULT_USER_DATA = '/tmp/mdf-garden-ui-e2e-obsidian';

export function obsidianAppPresent(): boolean {
	return existsSync(OBSIDIAN_BIN) || existsSync(OBSIDIAN_APP);
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const addr = s.address();
			if (!addr || typeof addr === 'string') {
				s.close();
				reject(new Error('no port'));
				return;
			}
			const { port } = addr;
			s.close((err) => (err ? reject(err) : resolve(port)));
		});
		s.on('error', reject);
	});
}

/** Ensure vault already trusts local community plugins list (no store install). */
export function ensureVaultPluginPreseed(vaultPath: string): void {
	const obsidianDir = path.join(vaultPath, '.obsidian');
	mkdirSync(path.join(obsidianDir, 'plugins', PLUGIN_ID), { recursive: true });
	const community = path.join(obsidianDir, 'community-plugins.json');
	writeFileSync(community, JSON.stringify([PLUGIN_ID], null, 0));
	const pluginDir = path.join(obsidianDir, 'plugins', PLUGIN_ID);
	for (const name of ['main.js', 'styles.css', 'manifest.json']) {
		const p = path.join(pluginDir, name);
		if (!existsSync(p)) {
			throw new Error(
				`Local plugin artifact missing: ${p}\nRun: npm run build:smoke (do NOT install from Community plugins)`,
			);
		}
	}
}

/** Register smoke-vault in a fresh Obsidian user-data dir (first-open safe). */
export function writeE2eObsidianJson(userDataDir: string, vaultPath: string, vaultId = E2E_VAULT_ID): string {
	mkdirSync(userDataDir, { recursive: true });
	const cfg = {
		vaults: {
			[vaultId]: {
				path: vaultPath,
				ts: Date.now(),
				open: true,
			},
		},
	};
	writeFileSync(path.join(userDataDir, 'obsidian.json'), JSON.stringify(cfg));
	return vaultId;
}

export interface ObsidianSession {
	browser: Browser;
	page: Page;
	port: number;
	userDataDir: string;
	vaultId: string;
	child: ChildProcess;
	cdpUrl: string;
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return;
		} catch (err) {
			lastErr = err;
		}
		await sleep(400);
	}
	throw new Error(`Obsidian CDP not up on :${port} within ${timeoutMs}ms (${String(lastErr)})`);
}

async function waitForObsidianPage(browser: Browser, timeoutMs: number): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const ctx of browser.contexts()) {
			for (const p of ctx.pages()) {
				if (p.url().startsWith('app://obsidian.md')) return p;
			}
		}
		await sleep(400);
	}
	throw new Error('No Obsidian page target after launch');
}

/**
 * Obsidian stores Restricted Mode in localStorage:
 *   enable-plugin-<appId> === "true"  → plugins allowed
 * Clicking "Trust author and enable plugins" ALSO opens Settings → Community plugins
 * (store browse). We must never click that — pre-seed localStorage + reload instead.
 */
export async function ensureRestrictedModeOff(page: Page, vaultId: string): Promise<void> {
	await page.waitForFunction(() => typeof localStorage !== 'undefined', null, { timeout: 60_000 });

	const key = `enable-plugin-${vaultId}`;
	const state = await page.evaluate((k) => {
		const before = localStorage.getItem(k);
		localStorage.setItem(k, 'true');
		return { before, after: localStorage.getItem(k), appId: (window as unknown as { app?: { appId?: string } }).app?.appId || null };
	}, key);

	// Also set under live appId if it differs from vault id
	if (state.appId && state.appId !== vaultId) {
		await page.evaluate((id) => localStorage.setItem(`enable-plugin-${id}`, 'true'), state.appId);
	}

	const needsReload = state.before !== 'true';
	if (needsReload) {
		console.log(`  preseed Restricted Mode OFF (${key}); reloading vault…`);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await sleep(1500);
	}

	// Close Trust modal / Community settings if somehow open — never click Trust/Download.
	await leaveCommunityPluginUi(page);
}

/** Leave Settings / Community plugin browse/download UI; never click Download/Install/Browse. */
export async function leaveCommunityPluginUi(page: Page): Promise<void> {
	for (let i = 0; i < 8; i++) {
		const info = await page.evaluate(() => {
			const body = document.body?.innerText || '';
			const onCommunity =
				/Community plugins|Browse|Search community plugins|插件市场|社区插件/i.test(body) &&
				!!document.querySelector('.vertical-tab-content, .mod-community-modal, .community-modal, .setting-item');
			const trustVisible = [...document.querySelectorAll('button')].some((b) =>
				/Trust author and enable plugins|信任作者/.test(b.textContent || ''),
			);
			const downloadVisible = [...document.querySelectorAll('button')].some((b) =>
				/^(Download|Install|Browse)$/i.test((b.textContent || '').trim()),
			);
			return { onCommunity, trustVisible, downloadVisible, bodySlice: body.slice(0, 200) };
		});

		if (!info.onCommunity && !info.trustVisible) break;

		// Close Trust modal WITHOUT enabling via that button (would open Community plugins).
		if (info.trustVisible) {
			await page.evaluate(() => {
				// Prefer dismiss / "Browse vault in Restricted Mode" then we'll enable via localStorage.
				for (const b of Array.from(document.querySelectorAll('button'))) {
					const t = (b.textContent || '').trim();
					if (/Browse vault in Restricted Mode|Cancel|关闭|取消/.test(t)) {
						(b as HTMLButtonElement).click();
						return;
					}
				}
				// Or click modal close
				const close = document.querySelector(
					'.modal-close-button, .modal .clickable-icon',
				) as HTMLElement | null;
				close?.click();
			});
			await sleep(400);
			continue;
		}

		if (info.onCommunity) {
			console.log('  leaving Community plugins settings (local plugin already installed)…');
			// Close settings: Escape, then click X if needed
			await page.keyboard.press('Escape');
			await sleep(300);
			await page.evaluate(() => {
				const close =
					(document.querySelector('.modal-close-button') as HTMLElement | null) ||
					(document.querySelector('.vertical-tab-header .clickable-icon') as HTMLElement | null) ||
					([...document.querySelectorAll('.setting-close-button, button')].find((b) =>
						/close|关闭/i.test(b.getAttribute('aria-label') || b.textContent || ''),
					) as HTMLElement | undefined);
				close?.click();
				// Also try app.setting.close()
				try {
					(window as unknown as { app?: { setting?: { close?: () => void } } }).app?.setting?.close?.();
				} catch {
					/* ignore */
				}
			});
			await sleep(400);
		}
	}
}

export async function dismissHarmlessModals(page: Page): Promise<void> {
	await page.evaluate(() => {
		// Do NOT click Trust author / Download / Install / Browse community.
		const forbid =
			/Trust author|Download|Install|Browse|社区|安装|下载|Enable plugins/i;
		for (const b of Array.from(document.querySelectorAll('button'))) {
			const t = (b.textContent || '').trim();
			if (!t || forbid.test(t)) continue;
			if (/^(OK|Got it|I understand|Close|Dismiss|知道了)$/i.test(t)) {
				(b as HTMLButtonElement).click();
			}
		}
	});
}

/**
 * Launch headed Obsidian with Garden smoke vault; Restricted Mode already off;
 * local mdfriday-garden only (no community store).
 */
export async function launchObsidianForUiE2e(opts?: {
	userDataDir?: string;
	vaultPath?: string;
	port?: number;
	vaultId?: string;
}): Promise<ObsidianSession> {
	if (!obsidianAppPresent()) {
		throw new Error(`Obsidian.app not found at ${OBSIDIAN_APP}`);
	}
	const vaultPath = opts?.vaultPath ?? SMOKE_VAULT;
	if (!existsSync(vaultPath)) {
		throw new Error(`Smoke vault missing: ${vaultPath}`);
	}
	ensureVaultPluginPreseed(vaultPath);

	const userDataDir = opts?.userDataDir ?? DEFAULT_USER_DATA;
	const vaultId = opts?.vaultId ?? E2E_VAULT_ID;
	rmSync(userDataDir, { recursive: true, force: true });
	writeE2eObsidianJson(userDataDir, vaultPath, vaultId);

	const port = opts?.port ?? (await freePort());
	const child = spawn(
		OBSIDIAN_BIN,
		[`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`],
		{
			stdio: ['ignore', 'ignore', 'ignore'],
			detached: true,
			env: { ...process.env },
		},
	);
	child.unref();

	try {
		await waitForCdp(port, 60_000);
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		const page = await waitForObsidianPage(browser, 60_000);

		// Critical: turn Restricted Mode off WITHOUT opening Community plugins UI.
		await ensureRestrictedModeOff(page, vaultId);
		await leaveCommunityPluginUi(page);
		await dismissHarmlessModals(page);

		await page.waitForFunction(
			(pluginId: string) => {
				const w = window as unknown as {
					app?: {
						vault?: { getName?: () => string };
						plugins?: { plugins?: Record<string, unknown>; enabledPlugins?: Set<string> };
					};
				};
				return !!(w.app?.vault && w.app?.plugins?.plugins?.[pluginId]);
			},
			PLUGIN_ID,
			{ timeout: 90_000 },
		);

		await leaveCommunityPluginUi(page);
		await page.waitForSelector('.nav-folder-title[data-path="Garden"]', { timeout: 60_000 });

		// Sanity: plugin came from local vault, not a store install flow.
		const enabled = await page.evaluate((pluginId) => {
			const w = window as unknown as {
				app?: { plugins?: { plugins?: Record<string, { manifest?: { dir?: string } }> } };
			};
			const plug = w.app?.plugins?.plugins?.[pluginId];
			return {
				loaded: !!plug,
				dir: plug?.manifest?.dir || null,
			};
		}, PLUGIN_ID);
		if (!enabled.loaded) {
			throw new Error('mdfriday-garden did not load from local vault plugins/');
		}
		console.log(`  local plugin loaded dir=${enabled.dir}`);

		return {
			browser,
			page,
			port,
			userDataDir,
			vaultId,
			child,
			cdpUrl: `http://127.0.0.1:${port}`,
		};
	} catch (err) {
		try {
			if (child.pid) process.kill(-child.pid, 'SIGTERM');
		} catch {
			/* ignore */
		}
		throw err;
	}
}


function isPublishedUiState(badge: string, stateTitle: string): boolean {
	const b = (badge || '').trim();
	const t = (stateTitle || '').trim();
	return (
		b === 'Published' ||
		b === '已发布' ||
		t === 'Published' ||
		t === '发布成功'
	);
}

/**
 * Product path: select Garden → open panel (Open in) → click Publish.
 * Never opens Community plugins / Download.
 */
export async function publishGardenFolderViaUi(page: Page): Promise<string> {
	await leaveCommunityPluginUi(page);
	await dismissHarmlessModals(page);

	const garden = page.locator('.nav-folder-title[data-path="Garden"]');
	await garden.waitFor({ timeout: 30_000 });
	await garden.click({ force: true });
	await sleep(400);

	await page.evaluate(async (pluginId) => {
		const w = window as unknown as {
			app: {
				plugins: {
					plugins: Record<
						string,
						{
							openOrFollowSelection: (
								f: unknown,
								file: null,
								opts: { createIfMissing: boolean },
							) => Promise<void>;
						}
					>;
				};
				vault: { getAbstractFileByPath: (p: string) => unknown };
			};
		};
		const plugin = w.app.plugins.plugins[pluginId];
		const folder = w.app.vault.getAbstractFileByPath('Garden');
		if (!plugin || !folder) throw new Error('plugin or Garden folder missing');
		await plugin.openOrFollowSelection(folder, null, { createIfMissing: true });
	}, PLUGIN_ID);
	await sleep(1000);

	await leaveCommunityPluginUi(page);

	const publishBtn = page
		.locator('button.btn.btn-primary')
		.filter({ hasText: /Publish again|Publish site|^Publish$|再次发布|发布站点|^发布$/ });
	if ((await publishBtn.count()) === 0) {
		await page.evaluate(async (pluginId) => {
			const w = window as unknown as {
				app: {
					plugins: { plugins: Record<string, { publishToWeb: (f: unknown) => Promise<void> }> };
					vault: { getAbstractFileByPath: (p: string) => unknown };
				};
			};
			const plugin = w.app.plugins.plugins[pluginId];
			const folder = w.app.vault.getAbstractFileByPath('Garden');
			await plugin.publishToWeb(folder);
		}, PLUGIN_ID);
	} else {
		await publishBtn.last().click({ force: true });
	}

	const deadline = Date.now() + 180_000;
	let publicUrl = '';
	while (Date.now() < deadline) {
		await leaveCommunityPluginUi(page);
		const state = await page.evaluate(() => {
			const urlText =
				document.querySelector('.success-url-box .url, .state-result .url')?.textContent?.trim() ||
				'';
			const body = document.body?.innerText || '';
			const match = body.match(/https:\/\/share\.fsky\.top\/s\/[A-Za-z0-9_-]+\/?/);
			return {
				urlText,
				match: match?.[0] || '',
				building: !!document.querySelector('.spinner'),
				badge: document.querySelector('.result-badge')?.textContent?.trim() || '',
				stateTitle: document.querySelector('.state-title')?.textContent?.trim() || '',
			};
		});
		if (!state.building && isPublishedUiState(state.badge, state.stateTitle) && (state.urlText || state.match)) {
			publicUrl = (state.urlText || state.match).replace(/\/?$/, '/');
			break;
		}
		// URL may appear slightly before badge i18n settles
		if (!state.building && (state.urlText || state.match) && /share\.fsky\.top\/s\//.test(state.urlText || state.match)) {
			publicUrl = (state.urlText || state.match).replace(/\/?$/, '/');
			break;
		}
		await sleep(1500);
	}
	if (!publicUrl) {
		const debug = await page.evaluate(() => {
			const body = (document.body?.innerText || '').slice(0, 1200);
			const err = document.querySelector('.quota-error, .helper.warn')?.textContent?.trim() || '';
			const badge = document.querySelector('.result-badge')?.textContent?.trim() || '';
			const title = document.querySelector('.state-title')?.textContent?.trim() || '';
			const building = !!document.querySelector('.spinner');
			const urlText =
				document.querySelector('.success-url-box .url, .state-result .url')?.textContent?.trim() ||
				'';
			return { err, badge, title, building, body, urlText };
		});
		throw new Error(
			`Timed out waiting for Published URL in Obsidian UI` +
				` (badge=${debug.badge} title=${debug.title} building=${debug.building} url=${debug.urlText} err=${debug.err}) body=${debug.body.replace(/\s+/g, ' ').slice(0, 400)}`,
		);
	}
	return publicUrl;
}

export function readSmokePluginData(): {
	mdfKey: string | null;
	pathConfigs?: Record<string, unknown>;
	mdfKeyKind?: string | null;
	mdfKeyPlan?: string | null;
} {
	const p = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');
	if (!existsSync(p)) return { mdfKey: null };
	return JSON.parse(readFileSync(p, 'utf8')) as {
		mdfKey: string | null;
		pathConfigs?: Record<string, unknown>;
		mdfKeyKind?: string | null;
		mdfKeyPlan?: string | null;
	};
}

/**
 * Seed smoke-vault plugin data.json with a Personal MDF_ key so headed UI
 * sees Sales (not guest-disabled) without Google OAuth.
 */
export function seedPersonalPluginData(opts: {
	mdfKey: string;
	email?: string;
	apiBase?: string;
	shareBase?: string;
}): void {
	const dataPath = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');
	const prev = existsSync(dataPath)
		? (JSON.parse(readFileSync(dataPath, 'utf8')) as Record<string, unknown>)
		: {};
	const next: Record<string, unknown> = {
		...prev,
		mdfKey: opts.mdfKey,
		mdfKeyKind: 'user',
		mdfKeyPlan: 'personal',
		mdfKeyEnv: 'staging',
		mdfAccountEmail: opts.email ?? null,
		mdfQuotaFeatures: ['commerce', 'custom_domain', 'ai', 'rollback', 'permanent_retention', 'unlimited_projects'],
		mdfQuotaMaxCustomDomains: 1,
		cloudflareEnv: 'staging',
		cloudflareResolvedEnv: 'staging',
		cloudflareApiBaseUrl: opts.apiBase ?? 'https://api.fsky.top',
		cloudflarePublicBaseUrl: opts.shareBase ?? 'https://share.fsky.top',
		pathConfigs: {
			Garden: {
				mode: 'themed',
				themeSlug: 'canopy',
				hasPasswordFlag: false,
				updatedAt: Date.now(),
			},
		},
	};
	writeFileSync(dataPath, JSON.stringify(next, null, 2));
	clearLocalGardenFoundryCache();
}

/**
 * Drop on-disk Garden Foundry project + registry row so the next Open/Publish
 * recreates a clean project (rm of the folder alone leaves a stale projects.json).
 */
export function clearLocalGardenFoundryCache(): void {
	const wsRoot = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'workspace');
	const localProject = path.join(wsRoot, 'projects', 'Garden');
	if (existsSync(localProject)) {
		rmSync(localProject, { recursive: true, force: true });
		console.log('  cleared local Foundry project cache for Garden');
	}
	const registryPath = path.join(wsRoot, '.mdfriday', 'projects.json');
	if (!existsSync(registryPath)) return;
	try {
		const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
			version?: string;
			projects?: Array<{ name?: string; status?: string }>;
		};
		const before = registry.projects?.length ?? 0;
		registry.projects = (registry.projects || []).filter((p) => p.name !== 'Garden');
		if ((registry.projects?.length ?? 0) !== before) {
			writeFileSync(registryPath, JSON.stringify(registry, null, 2));
			console.log('  cleared Garden entry from Foundry projects.json');
		}
	} catch (err) {
		console.warn('  failed to patch Foundry projects.json', err);
	}
}

/**
 * Abort non-terminal releases for every project on this key (clears DO publish locks).
 */
export async function abortInFlightReleases(opts: {
	apiBase: string;
	token: string;
	clientHeader: string;
}): Promise<number> {
	const base = opts.apiBase.replace(/\/$/, '');
	const headers = {
		authorization: `Bearer ${opts.token}`,
		'X-MDFriday-Client': opts.clientHeader,
	};
	const listRes = await fetch(`${base}/v1/projects`, { headers });
	if (!listRes.ok) return 0;
	const list = (await listRes.json()) as {
		projects?: Array<{ id?: string; projectId?: string }>;
	};
	let n = 0;
	for (const p of list.projects || []) {
		const projectId = p.id || p.projectId;
		if (!projectId) continue;
		const relRes = await fetch(`${base}/v1/projects/${projectId}/releases`, { headers });
		if (!relRes.ok) continue;
		const body = (await relRes.json()) as {
			releases?: Array<{ id?: string; state?: string }>;
		};
		for (const rel of body.releases || []) {
			if (!rel.id) continue;
			if (!['opened', 'uploading', 'committing'].includes(String(rel.state || ''))) continue;
			const abortRes = await fetch(`${base}/v1/projects/${projectId}/releases/${rel.id}/abort`, {
				method: 'POST',
				headers,
			});
			if (abortRes.ok || abortRes.status === 409) n += 1;
		}
	}
	return n;
}

/**
 * Clear Personal/commerce keys left by prior E2E so guest UI tests mint a fresh
 * guest key and publish to share.fsky.top (not a leftover custom domain).
 */
export function resetSmokePluginDataForGuestPublish(opts?: {
	apiBase?: string;
	shareBase?: string;
	themeSlug?: string;
}): void {
	const dataPath = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');
	const prev = existsSync(dataPath)
		? (JSON.parse(readFileSync(dataPath, 'utf8')) as Record<string, unknown>)
		: {};
	const themeSlug = opts?.themeSlug ?? 'canopy';
	const next: Record<string, unknown> = {
		...prev,
		mdfKey: null,
		mdfKeyKind: null,
		mdfKeyPlan: null,
		mdfKeyEnv: 'staging',
		mdfAccountEmail: null,
		mdfContentExpiresAt: null,
		mdfProjectCount: 0,
		mdfStorageBytes: 0,
		mdfQuotaFeatures: [],
		mdfQuotaMaxCustomDomains: 0,
		hasPublishedOnce: false,
		cloudflareEnv: 'staging',
		cloudflareResolvedEnv: 'staging',
		cloudflareApiBaseUrl: opts?.apiBase ?? 'https://api.fsky.top',
		cloudflarePublicBaseUrl: opts?.shareBase ?? 'https://share.fsky.top',
		pathConfigs: {
			Garden: {
				mode: 'themed',
				themeSlug,
				hasPasswordFlag: false,
				updatedAt: Date.now(),
			},
		},
	};
	writeFileSync(dataPath, JSON.stringify(next, null, 2));
	clearLocalGardenFoundryCache();
}

export interface SalesPanelLinkResult {
	visible: boolean;
	enabled: boolean;
	text: string;
	line: string;
}

/** Advanced ▸ Selling block: status line + Manage in Dashboard control. */
export async function assertSalesSectionInPanel(page: Page): Promise<SalesPanelLinkResult> {
	await expandAdvancedOptions(page);
	await page.waitForSelector('.mdf-sales-settings', { timeout: 15_000 });
	const result = await page.evaluate(() => {
		const block = document.querySelector('.mdf-sales-settings');
		const btn = document.querySelector(
			'[data-mdf-sales-dashboard]',
		) as HTMLButtonElement | null;
		const line = (document.querySelector('.mdf-sales-line')?.textContent || '').trim();
		const guestHint = Array.from(block?.querySelectorAll('p.helper') || []).some((p) =>
			/Not enabled|未启用|guest/i.test(p.textContent || ''),
		);
		return {
			hasBlock: !!block,
			hasBtn: !!btn,
			disabled: btn ? !!btn.disabled : true,
			text: (btn?.textContent || '').trim().slice(0, 80),
			line: line.slice(0, 120),
			guestHint,
		};
	});
	if (!result.hasBlock) throw new Error('Sales (.mdf-sales-settings) missing from Advanced panel');
	if (result.guestHint && !result.hasBtn) {
		throw new Error('Sales still shows guest-disabled state — Personal key seed failed?');
	}
	if (!result.hasBtn) throw new Error('Sales "Manage in Dashboard" button missing');
	return {
		visible: true,
		enabled: !result.disabled,
		text: result.text,
		line: result.line || '(loading)',
	};
}

/**
 * Click Sales ▸ Manage in Dashboard; capture the window.open URL (no real browser popup).
 */
export async function clickSalesManageCaptureUrl(page: Page): Promise<string> {
	await expandAdvancedOptions(page);
	await page.waitForSelector('[data-mdf-sales-dashboard]:not([disabled])', { timeout: 30_000 });
	const opened = await page.evaluate(() => {
		return new Promise<string>((resolve, reject) => {
			const btn = document.querySelector(
				'[data-mdf-sales-dashboard]',
			) as HTMLButtonElement | null;
			if (!btn || btn.disabled) {
				reject(new Error('Sales dashboard button missing or disabled'));
				return;
			}
			const prev = window.open;
			window.open = ((url?: string | URL) => {
				window.open = prev;
				resolve(String(url || ''));
				return null;
			}) as typeof window.open;
			btn.click();
			setTimeout(() => {
				window.open = prev;
				reject(new Error('window.open was not called after Sales manage click'));
			}, 5_000);
		});
	});
	if (!/\/dashboard\/sales\//i.test(opened)) {
		throw new Error(`expected Dashboard Sales URL, got: ${opened.slice(0, 200)}`);
	}
	return opened;
}

export async function deleteStagingProject(opts: {
	apiBase: string;
	projectId: string;
	token: string;
	clientHeader: string;
}): Promise<void> {
	await fetch(`${opts.apiBase.replace(/\/$/, '')}/v1/projects/${opts.projectId}`, {
		method: 'DELETE',
		headers: {
			authorization: `Bearer ${opts.token}`,
			'X-MDFriday-Client': opts.clientHeader,
		},
	});
}

export async function resolveProjectIdForUrl(opts: {
	apiBase: string;
	token: string;
	clientHeader: string;
	publicUrl: string;
}): Promise<string | null> {
	const siteMatch = opts.publicUrl.match(/\/s\/([A-Za-z0-9_-]+)/);
	const siteId = siteMatch?.[1];
	const res = await fetch(`${opts.apiBase.replace(/\/$/, '')}/v1/projects`, {
		headers: {
			authorization: `Bearer ${opts.token}`,
			'X-MDFriday-Client': opts.clientHeader,
		},
	});
	if (!res.ok) return null;
	const body = (await res.json()) as {
		projects?: Array<{
			id?: string;
			projectId?: string;
			siteId?: string;
			site_id?: string;
			url?: string;
			baseURL?: string;
		}>;
	};
	const list = body.projects || [];
	for (const p of list) {
		const id = p.id || p.projectId;
		const sid = p.siteId || p.site_id;
		const url = `${p.url || ''} ${p.baseURL || ''}`;
		if (siteId && (sid === siteId || url.includes(`/s/${siteId}`))) return id || null;
	}
	return list[0]?.id || list[0]?.projectId || null;
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function closeObsidianSession(session: ObsidianSession | undefined): Promise<void> {
	if (!session) return;
	try {
		await session.browser.close();
	} catch {
		/* disconnect only */
	}
	const pid = session.child.pid;
	try {
		if (pid) process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			session.child.kill('SIGTERM');
		} catch {
			/* ignore */
		}
	}
	// Wait for exit so a late data.json flush cannot overwrite the next test's seed.
	const deadline = Date.now() + 8_000;
	while (pid && pidAlive(pid) && Date.now() < deadline) {
		await sleep(200);
	}
	if (pid && pidAlive(pid)) {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			try {
				session.child.kill('SIGKILL');
			} catch {
				/* ignore */
			}
		}
		const killDeadline = Date.now() + 3_000;
		while (pidAlive(pid) && Date.now() < killDeadline) {
			await sleep(150);
		}
	}
	// Filesystem settle after Electron teardown
	await sleep(400);
}

/** Open Garden folder in the publish panel (same path as Open in MDFriday Digital Garden). */
export async function openGardenPublishPanel(page: Page): Promise<void> {
	await leaveCommunityPluginUi(page);
	await dismissHarmlessModals(page);

	const garden = page.locator('.nav-folder-title[data-path="Garden"]');
	await garden.waitFor({ timeout: 30_000 });
	await garden.click({ force: true });
	await sleep(400);

	await page.evaluate(async (pluginId) => {
		const w = window as unknown as {
			app: {
				plugins: {
					plugins: Record<
						string,
						{
							openOrFollowSelection: (
								f: unknown,
								file: null,
								opts: { createIfMissing: boolean },
							) => Promise<void>;
						}
					>;
				};
				vault: { getAbstractFileByPath: (p: string) => unknown };
			};
		};
		const plugin = w.app.plugins.plugins[pluginId];
		const folder = w.app.vault.getAbstractFileByPath('Garden');
		if (!plugin || !folder) throw new Error('plugin or Garden folder missing');
		await plugin.openOrFollowSelection(folder, null, { createIfMissing: true });
	}, PLUGIN_ID);
	await sleep(1000);
	await leaveCommunityPluginUi(page);
}

/** Expand Publish panel ▸ Advanced options (Dashboard access-keys link lives here). */
export async function expandAdvancedOptions(page: Page): Promise<void> {
	const opened = await page.evaluate(() => {
		const toggle = document.querySelector(
			'button.advanced-toggle, .advanced-toggle',
		) as HTMLButtonElement | null;
		if (!toggle) return { ok: false, reason: 'no-toggle' };
		const expanded = toggle.getAttribute('aria-expanded') === 'true';
		if (!expanded) toggle.click();
		return { ok: true, reason: expanded ? 'already-open' : 'clicked' };
	});
	if (!opened.ok) throw new Error('Advanced options toggle not found — is the publish panel open?');
	await sleep(500);
	await page.waitForSelector(
		'[data-mdf-access-keys], [data-mdf-access-dashboard], .adv-block',
		{ timeout: 15_000 },
	);
}

export interface AccessKeysLinkResult {
	visible: boolean;
	hrefOrDisabled: string;
}

/**
 * Sidebar no longer edits access frontmatter. Assert the Access settings radios
 * are gone and the Dashboard manage-keys control is present under Advanced.
 */
export async function assertAccessKeysLinkInPanel(page: Page): Promise<AccessKeysLinkResult> {
	await expandAdvancedOptions(page);
	await page.waitForSelector('.mdf-access-settings', { timeout: 15_000 });
	const result = await page.evaluate(() => {
		const radios = document.querySelectorAll('input[name="mdf-access-prot"]').length;
		const teaser = document.getElementById('mdf-access-teaser');
		const block = document.querySelector('.mdf-access-settings');
		const guestHint = Array.from(block?.querySelectorAll('p.helper') || []).some((p) =>
			/guest|访客|Sign in|登录|Not available|不可用|free MDFriday account/i.test(
				p.textContent || '',
			),
		);
		const dash =
			(document.querySelector('[data-mdf-access-dashboard]') as HTMLButtonElement | null) ||
			Array.from(block?.querySelectorAll('button') || []).find((b) =>
				/Manage keys|管理密钥|View in dashboard|Dashboard|查看/i.test(b.textContent || ''),
			) ||
			null;
		return {
			radios,
			hasTeaser: !!teaser,
			hasBlock: !!block,
			guestHint,
			hasDash: !!dash,
			dashDisabled: dash ? !!dash.disabled : true,
			dashText: (dash?.textContent || '').trim().slice(0, 80),
		};
	});
	if (result.radios > 0 || result.hasTeaser) {
		throw new Error(
			`Sidebar Access settings editor still present (radios=${result.radios} teaser=${result.hasTeaser})`,
		);
	}
	if (!result.hasBlock) {
		throw new Error('Access (.mdf-access-settings) missing from Advanced panel');
	}
	if (result.guestHint && !result.hasDash) {
		throw new Error('Access still shows guest-disabled state — Personal key seed failed?');
	}
	if (!result.hasDash) {
		throw new Error('Dashboard manage-keys control missing from Advanced panel');
	}
	return {
		visible: true,
		hrefOrDisabled: result.dashDisabled ? 'disabled' : `ready:${result.dashText}`,
	};
}

export interface PublishUiResult {
	publicUrl: string;
	sharedKey: string | null;
}

function normalizeNoticeKey(raw: string): string {
	return raw
		.toUpperCase()
		.replace(/[-\s]/g, '')
		.replace(/O/g, '0')
		.replace(/[IL]/g, '1');
}

/** Scrape Obsidian Notice toast for `Access key: …` after a protected publish. */
export async function readSharedKeyFromNotice(page: Page): Promise<string | null> {
	const raw = await page.evaluate(() => {
		const nodes = Array.from(document.querySelectorAll('.notice, .notice-container .notice'));
		for (const n of nodes) {
			const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
			const m = text.match(/Access key:\s*([0-9A-Za-z-]{10,})/i);
			if (m?.[1]) return m[1];
		}
		// Fallback: body text (notice may have dismissed visually but still briefly present)
		const body = document.body?.innerText || '';
		const m2 = body.match(/Access key:\s*([0-9A-Za-z-]{10,})/i);
		return m2?.[1] || null;
	});
	if (!raw) return null;
	const norm = normalizeNoticeKey(raw);
	return norm.length === 17 ? norm : raw;
}

/**
 * Product path: select Garden → open panel → Publish.
 * Also captures shared access key from the success Notice when present.
 *
 * @param opts.expectHostname — after custom-domain bind, wait for this host
 *   (e.g. e2e-….jiashu.ink) instead of only share.fsky.top.
 */
export async function publishGardenFolderViaUiWithAccess(
	page: Page,
	opts: { expectHostname?: string; timeoutMs?: number } = {},
): Promise<PublishUiResult> {
	await leaveCommunityPluginUi(page);
	await dismissHarmlessModals(page);

	const garden = page.locator('.nav-folder-title[data-path="Garden"]');
	await garden.waitFor({ timeout: 30_000 });
	await garden.click({ force: true });
	await sleep(400);

	await page.evaluate(async (pluginId) => {
		const w = window as unknown as {
			app: {
				plugins: {
					plugins: Record<
						string,
						{
							openOrFollowSelection: (
								f: unknown,
								file: null,
								opts: { createIfMissing: boolean },
							) => Promise<void>;
						}
					>;
				};
				vault: { getAbstractFileByPath: (p: string) => unknown };
			};
		};
		const plugin = w.app.plugins.plugins[pluginId];
		const folder = w.app.vault.getAbstractFileByPath('Garden');
		if (!plugin || !folder) throw new Error('plugin or Garden folder missing');
		await plugin.openOrFollowSelection(folder, null, { createIfMissing: true });
	}, PLUGIN_ID);
	await sleep(1000);
	await leaveCommunityPluginUi(page);

	const publishBtn = page
		.locator('button.btn.btn-primary')
		.filter({ hasText: /Publish again|Publish site|^Publish$|再次发布|发布站点|^发布$/ });
	if ((await publishBtn.count()) === 0) {
		await page.evaluate(async (pluginId) => {
			const w = window as unknown as {
				app: {
					plugins: { plugins: Record<string, { publishToWeb: (f: unknown) => Promise<void> }> };
					vault: { getAbstractFileByPath: (p: string) => unknown };
				};
			};
			const plugin = w.app.plugins.plugins[pluginId];
			const folder = w.app.vault.getAbstractFileByPath('Garden');
			await plugin.publishToWeb(folder);
		}, PLUGIN_ID);
	} else {
		await publishBtn.last().click({ force: true });
	}

	const expectHost = (opts.expectHostname || '').toLowerCase();
	const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
	let publicUrl = '';
	let sharedKey: string | null = null;
	while (Date.now() < deadline) {
		await leaveCommunityPluginUi(page);
		const state = await page.evaluate((host) => {
			// Prefer the publish result URL only — DomainSection also shows the hostname.
			const resultUrl =
				document.querySelector('.success-url-box .url, .state-result .url')?.textContent?.trim() ||
				'';
			const body = document.body?.innerText || '';
			const shareFromBody = body.match(/https:\/\/share\.fsky\.top\/s\/[A-Za-z0-9_-]+\/?/);
			const shareMatch =
				/share\.fsky\.top\/s\//i.test(resultUrl) ? resultUrl : shareFromBody?.[0] || '';
			let customMatch = '';
			if (host && resultUrl.toLowerCase().includes(host.toLowerCase())) {
				customMatch = resultUrl;
			}
			const noticeNodes = Array.from(document.querySelectorAll('.notice'));
			let noticeKey: string | null = null;
			for (const n of noticeNodes) {
				const t = (n.textContent || '').replace(/\s+/g, ' ');
				const km = t.match(/Access key:\s*([0-9A-Za-z-]{10,})/i);
				if (km?.[1]) {
					noticeKey = km[1];
					break;
				}
			}
			if (!noticeKey) {
				const km2 = body.match(/Access key:\s*([0-9A-Za-z-]{10,})/i);
				if (km2?.[1]) noticeKey = km2[1];
			}
			return {
				resultUrl,
				shareMatch,
				customMatch,
				building: !!document.querySelector('.spinner'),
				badge: document.querySelector('.result-badge')?.textContent?.trim() || '',
				stateTitle: document.querySelector('.state-title')?.textContent?.trim() || '',
				noticeKey,
			};
		}, expectHost);
		if (state.noticeKey) {
			const norm = normalizeNoticeKey(state.noticeKey);
			sharedKey = norm.length === 17 ? norm : state.noticeKey;
		}

		const candidate = expectHost ? state.customMatch : state.resultUrl || state.shareMatch;
		const hostOk = expectHost
			? candidate.toLowerCase().includes(expectHost)
			: /share\.fsky\.top\/s\//.test(candidate);
		const publishedOk = isPublishedUiState(state.badge, state.stateTitle);

		if (!state.building && candidate && hostOk && publishedOk) {
			publicUrl = candidate.replace(/\/?$/, '/');
			if (!/^https?:\/\//i.test(publicUrl)) {
				publicUrl = `https://${publicUrl.replace(/^\/+/, '')}`;
			}
			if (!sharedKey) {
				await sleep(800);
				sharedKey = await readSharedKeyFromNotice(page);
			}
			break;
		}
		await sleep(1500);
	}
	if (!publicUrl) {
		const debug = await page.evaluate(() => {
			const body = (document.body?.innerText || '').slice(0, 1200);
			const err = document.querySelector('.quota-error, .helper.warn')?.textContent?.trim() || '';
			const badge = document.querySelector('.result-badge')?.textContent?.trim() || '';
			const title = document.querySelector('.state-title')?.textContent?.trim() || '';
			const building = !!document.querySelector('.spinner');
			const urlText =
				document.querySelector('.success-url-box .url, .state-result .url')?.textContent?.trim() ||
				'';
			return { err, badge, title, building, body, urlText };
		});
		throw new Error(
			`Timed out waiting for Published URL in Obsidian UI` +
				(expectHost ? ` (expect host=${expectHost})` : '') +
				` (badge=${debug.badge} title=${debug.title} building=${debug.building} url=${debug.urlText} err=${debug.err}) body=${debug.body.replace(/\s+/g, ' ').slice(0, 400)}`,
		);
	}
	return { publicUrl, sharedKey };
}
