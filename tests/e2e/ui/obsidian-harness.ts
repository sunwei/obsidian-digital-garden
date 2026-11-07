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
		.filter({ hasText: /Publish again|Publish site|^Publish$/ });
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
		if (
			!state.building &&
			(state.badge === 'Published' || state.stateTitle === 'Published') &&
			(state.urlText || state.match)
		) {
			publicUrl = (state.urlText || state.match).replace(/\/?$/, '/');
			break;
		}
		await sleep(1500);
	}
	if (!publicUrl) {
		throw new Error('Timed out waiting for Published URL in Obsidian UI');
	}
	return publicUrl;
}

export function readSmokePluginData(): {
	mdfKey: string | null;
	pathConfigs?: Record<string, unknown>;
} {
	const p = path.join(SMOKE_VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');
	if (!existsSync(p)) return { mdfKey: null };
	return JSON.parse(readFileSync(p, 'utf8')) as {
		mdfKey: string | null;
		pathConfigs?: Record<string, unknown>;
	};
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

export async function closeObsidianSession(session: ObsidianSession | undefined): Promise<void> {
	if (!session) return;
	try {
		await session.browser.close();
	} catch {
		/* disconnect only */
	}
	try {
		if (session.child.pid) process.kill(-session.child.pid, 'SIGTERM');
	} catch {
		try {
			session.child.kill('SIGTERM');
		} catch {
			/* ignore */
		}
	}
	await sleep(800);
	try {
		if (session.child.pid) process.kill(-session.child.pid, 'SIGKILL');
	} catch {
		/* ignore */
	}
}
