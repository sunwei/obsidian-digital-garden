/**
 * Headless Digital Garden publish path — same order as the plugin (core + staging API),
 * owned by obsidian-digital-garden (does not import cloudflare test-kit / Publish).
 *
 * guest → ensureCloudflareBinding(kind:folder, hostingMode:share) → build → publishCloudflare
 * Client header: obsidian-garden/<manifest.version>
 *
 * Note: hostingMode `share` is the free MDFriday shared-hosting lane (URL on share.fsky.top),
 * not the Share product. Garden's product id is the client header / plugin=garden.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreEngine = any;

export interface CatalogEntry {
	slug: string;
	family: string;
	variant: string;
	version: string;
	entitled: boolean;
	packUrl: string | null;
	kinds: string[];
	tags: string[];
	siteParams?: Record<string, unknown>;
	[k: string]: unknown;
}

export interface PluginSite {
	name: string;
	kind: 'note' | 'folder';
	sourcePath: string;
	vaultRelPath: string;
}

export interface PluginPublishResult {
	url: string;
	baseURL: string;
	siteId: string;
	projectId: string;
	filesUploaded: number;
	buildMs: number;
	publishMs: number;
	/** Last X-MDFriday-Client value sent to the API origin during this publish. */
	clientHeader: string;
	/** Root-scope shared keys from access-manifest ingest (I3), when publish was protected. */
	sharedKeys?: { scope: string; key: string; link: string }[];
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');

function corePackageDir(): string {
	const envDir = process.env.MDFRIDAY_CORE_DIR || process.env.CORE_DIR;
	if (envDir && existsSync(path.join(envDir, 'package.json'))) return path.resolve(envDir);
	const sibling = path.join(WORKSPACE_ROOT, 'core');
	if (existsSync(path.join(sibling, 'package.json'))) return sibling;
	const linked = path.join(REPO_ROOT, 'node_modules/@mdfriday/core');
	if (existsSync(path.join(linked, 'package.json'))) return linked;
	throw new Error('Cannot resolve @mdfriday/core — build sibling ../core or set MDFRIDAY_CORE_DIR');
}

async function loadCore(): Promise<{ core: CoreEngine; version: string }> {
	const dir = corePackageDir();
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
		name?: string;
		version: string;
	};
	if (pkg.name && pkg.name !== '@mdfriday/core') {
		throw new Error(`Expected @mdfriday/core at ${dir}, got ${pkg.name}`);
	}
	const entry = path.join(dir, 'dist/esm/index.js');
	if (!existsSync(entry)) {
		throw new Error(`@mdfriday/core build missing at ${entry} — run npm run build in ../core`);
	}
	const core = await import(pathToFileURL(entry).href);
	return { core, version: pkg.version };
}

function gardenClientHeader(): string {
	try {
		const m = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')) as {
			version?: string;
		};
		return `obsidian-garden/${m.version ?? '0.0.0'}`;
	} catch {
		return 'obsidian-garden/0.0.0';
	}
}

class FetchPublishHttpClient {
	lastClientHeader = '';
	apiOrigin: string;
	clientHeader: string;

	constructor(apiOrigin: string, clientHeader: string) {
		this.apiOrigin = apiOrigin;
		this.clientHeader = clientHeader;
	}

	private headersFor(url: string, headers?: Record<string, string>): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(headers ?? {})) {
			const lower = k.toLowerCase();
			if (lower === 'host' || lower === 'content-length') continue;
			out[k] = v;
		}
		try {
			const u = new URL(url);
			if (u.origin === this.apiOrigin && !u.pathname.startsWith('/v1/dev/r2/')) {
				out['X-MDFriday-Client'] = this.clientHeader;
				this.lastClientHeader = this.clientHeader;
			}
		} catch {
			/* ignore */
		}
		return out;
	}

	private async send(method: string, url: string, headers: Record<string, string>, body?: BodyInit) {
		const res = await fetch(url, { method, headers: this.headersFor(url, headers), body });
		const text = method === 'HEAD' ? '' : await res.text();
		const trimmed = text.trim();
		let data: unknown;
		if (trimmed) {
			try {
				data = JSON.parse(trimmed);
			} catch {
				data = text;
			}
		}
		return {
			status: res.status,
			ok: res.status >= 200 && res.status < 300,
			statusText: String(res.status),
			data,
			async text() {
				return text;
			},
			async json() {
				return data ?? null;
			},
		};
	}

	postJSON(url: string, data: unknown, headers?: Record<string, string>) {
		return this.send('POST', url, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(data ?? {}));
	}
	patchJSON(url: string, data: unknown, headers?: Record<string, string>) {
		return this.send('PATCH', url, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(data ?? {}));
	}
	putJSON(url: string, data: unknown, headers?: Record<string, string>) {
		return this.send('PUT', url, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(data ?? {}));
	}
	async postMultipart(): Promise<never> {
		throw new Error('postMultipart is not used by the Cloudflare publish path');
	}
	putBinary(url: string, data: Buffer | Uint8Array, headers?: Record<string, string>) {
		const view = data instanceof Uint8Array ? data : new Uint8Array(data);
		return this.send('PUT', url, headers ?? { 'Content-Type': 'application/octet-stream' }, view as unknown as BodyInit);
	}
	get(url: string, headers?: Record<string, string>) {
		return this.send('GET', url, headers ?? {});
	}
	delete(url: string, headers?: Record<string, string>) {
		return this.send('DELETE', url, headers ?? {});
	}
	head(url: string, headers?: Record<string, string>) {
		return this.send('HEAD', url, headers ?? {});
	}
}

export async function fetchThemeCatalog(apiBase: string, authToken?: string): Promise<CatalogEntry[]> {
	const res = await fetch(`${apiBase.replace(/\/$/, '')}/v1/theme-catalog?_=${Date.now()}`, {
		headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
	});
	if (!res.ok) throw new Error(`theme-catalog ${res.status}`);
	const body = (await res.json()) as { entries: CatalogEntry[] };
	return body.entries;
}

export class GardenPluginDriver {
	readonly baseDir: string;
	readonly vaultDir: string;
	readonly workspaceDir: string;
	publish: CoreEngine;
	project: CoreEngine;
	projectConfig: CoreEngine;
	build: CoreEngine;
	workspace: CoreEngine;
	http: FetchPublishHttpClient;
	patchFn: (entry: CatalogEntry) => {
		module: unknown;
		params: Record<string, unknown>;
	};
	coreVersion = '';
	clientHeader = '';
	workspaceId = '';
	opts: { apiBaseUrl: string; publicBaseUrl: string; tmpRoot?: string };

	constructor(opts: { apiBaseUrl: string; publicBaseUrl: string; tmpRoot?: string }) {
		this.opts = opts;
		this.publish = undefined as unknown as CoreEngine;
		this.project = undefined as unknown as CoreEngine;
		this.projectConfig = undefined as unknown as CoreEngine;
		this.build = undefined as unknown as CoreEngine;
		this.workspace = undefined as unknown as CoreEngine;
		this.http = undefined as unknown as FetchPublishHttpClient;
		this.patchFn = undefined as unknown as GardenPluginDriver['patchFn'];
		const base = mkdtempSync(path.join(opts.tmpRoot ?? tmpdir(), 'mdf-garden-e2e-'));
		this.baseDir = base;
		this.vaultDir = path.join(base, 'vault');
		this.workspaceDir = path.join(base, 'vault/.obsidian/plugins/mdfriday-garden/workspace');
		mkdirSync(this.workspaceDir, { recursive: true });
	}

	async init(): Promise<void> {
		const { core: f, version } = await loadCore();
		this.coreVersion = version;
		f.setGlobalLogLevel?.(f.LogLevel?.ERROR ?? 3);
		this.workspace = f.createObsidianWorkspaceService();
		const exists = await this.workspace.workspaceExists(this.workspaceDir);
		if (!exists.success || !exists.data) {
			const r = await this.workspace.initWorkspace(this.workspaceDir);
			if (!r.success) throw new Error(`initWorkspace: ${r.error}`);
			this.workspaceId = r.data?.id ?? '';
		} else {
			const info = await this.workspace.getWorkspaceInfo(this.workspaceDir);
			this.workspaceId = info.data?.id ?? '';
		}
		this.project = f.createObsidianProjectService();
		this.projectConfig = f.createObsidianProjectConfigService();
		this.build = f.createObsidianBuildService();
		this.clientHeader = gardenClientHeader();
		this.http = new FetchPublishHttpClient(new URL(this.opts.apiBaseUrl).origin, this.clientHeader);
		this.publish = f.createObsidianPublishService(this.http, {
			apiBaseUrl: this.opts.apiBaseUrl,
			publicBaseUrl: this.opts.publicBaseUrl,
			enableCloudflare: true,
		});
		this.publish.applyCloudflareEndpoints?.({
			apiBaseUrl: this.opts.apiBaseUrl,
			publicBaseUrl: this.opts.publicBaseUrl,
		});
		const themeFile = path.join(REPO_ROOT, 'src/theme/theme-config.ts');
		const mod = await import(pathToFileURL(themeFile).href);
		this.patchFn = mod.buildThemeConfigPatch;
	}

	async guestKey(): Promise<{ key: string; guestId: string; contentExpiresAt?: number }> {
		const g = await this.publish.guest();
		const key = g.key || g.token;
		if (!g.success || !key) throw new Error(`guest: ${g.error}`);
		return { key, guestId: g.guestId, contentExpiresAt: g.contentExpiresAt };
	}

	writeVault(files: Record<string, string>): void {
		for (const [rel, body] of Object.entries(files)) {
			const abs = path.join(this.vaultDir, rel);
			mkdirSync(path.dirname(abs), { recursive: true });
			writeFileSync(abs, body);
		}
	}

	async createNoteProject(name: string, vaultRelPath: string, theme: CatalogEntry): Promise<PluginSite> {
		const sourcePath = path.join(this.vaultDir, vaultRelPath);
		if (!vaultRelPath.endsWith('.md')) throw new Error('createNoteProject expects a .md source');
		if (!existsSync(sourcePath)) throw new Error(`vault path missing: ${sourcePath}`);
		const created = await this.project.createProject({
			name,
			workspacePath: this.workspaceDir,
			sourceFile: sourcePath,
		});
		if (!created.success) throw new Error(`createProject: ${created.error}`);
		await this.applyThemeConfig(name, theme);
		return { name, kind: 'note', sourcePath, vaultRelPath };
	}

	/** Primary Garden path: folder / wiki site. */
	async createFolderProject(name: string, vaultRelPath: string, theme: CatalogEntry): Promise<PluginSite> {
		const sourcePath = path.join(this.vaultDir, vaultRelPath);
		if (!existsSync(sourcePath)) throw new Error(`vault folder missing: ${sourcePath}`);
		const created = await this.project.createProject({
			name,
			workspacePath: this.workspaceDir,
			sourceFolder: sourcePath,
		});
		if (!created.success) throw new Error(`createProject(folder): ${created.error}`);
		await this.applyThemeConfig(name, theme);
		return { name, kind: 'folder', sourcePath, vaultRelPath };
	}

	private async applyThemeConfig(name: string, theme: CatalogEntry): Promise<void> {
		if (!theme.packUrl) throw new Error(`theme ${theme.slug} not entitled`);
		const patch = this.patchFn(theme);
		const initialConfig: Record<string, unknown> = {
			baseURL: '/',
			title: name,
			contentDir: 'content',
			publishDir: 'public',
			defaultContentLanguage: 'en',
			taxonomies: { tag: 'tags', category: 'categories' },
			module: patch.module,
			markdown: { useInternalRenderer: true },
			params: { branding: true, ...patch.params },
			publish: { method: 'cloudflare' },
		};
		const set = await this.projectConfig.setAll(this.workspaceDir, name, initialConfig);
		if (!set.success) throw new Error(`setAll: ${set.error}`);
	}

	async buildAndPublish(
		site: PluginSite,
		auth: { token: string; guest: boolean },
		opts: { force?: boolean } = {},
	): Promise<PluginPublishResult> {
		const binding = await this.publish.ensureCloudflareBinding({
			workspacePath: this.workspaceDir,
			projectName: site.name,
			authToken: auth.token,
			hostingMode: 'share',
			apiBaseUrl: this.opts.apiBaseUrl,
			publicBaseUrl: this.opts.publicBaseUrl,
			sourcePath: site.vaultRelPath,
			kind: site.kind,
			title: site.name,
		});
		if (!binding.success) throw new Error(`ensureCloudflareBinding: ${binding.error} ${binding.code ?? ''}`);
		const baseURL = `${this.opts.publicBaseUrl.replace(/\/$/, '')}/s/${binding.siteId}/`;
		const set = await this.projectConfig.set(this.workspaceDir, site.name, 'baseURL', baseURL);
		if (!set.success) throw new Error(`set baseURL: ${set.error}`);

		// Mirror ProjectServiceManager / test-kit PluginDriver: pass access so SSG
		// encrypts protected pages and writes access-manifest.json (I3).
		let access:
			| {
					workspaceId: string;
					projectId: string;
					remoteProjectId: string;
					epochs?: Record<string, number>;
					apiBaseUrl?: string;
			  }
			| undefined;
		try {
			let epochs: Record<string, number> = {};
			if (typeof this.publish.getAccessState === 'function') {
				const state = await this.publish.getAccessState(auth.token, binding.cloudflareProjectId);
				for (const [slug, v] of Object.entries(state?.scopes ?? {})) {
					epochs[slug] = (v as { epoch: number }).epoch;
				}
			}
			access = {
				workspaceId: this.workspaceId || 'e2e-workspace',
				projectId: site.name,
				remoteProjectId: binding.cloudflareProjectId,
				epochs,
				apiBaseUrl: this.opts.apiBaseUrl,
			};
		} catch {
			/* first publish / API optional */
		}

		const b0 = Date.now();
		const built = await this.build.buildProject({
			workspacePath: this.workspaceDir,
			projectNameOrPath: site.name,
			clean: true,
			...(access ? { access } : {}),
		});
		if (!built.success) throw new Error(`buildProject: ${built.error}`);
		const buildMs = Date.now() - b0;

		const p0 = Date.now();
		const result = await this.publish.publishCloudflare({
			workspacePath: this.workspaceDir,
			projectName: site.name,
			authToken: auth.token,
			guest: auth.guest,
			apiBaseUrl: this.opts.apiBaseUrl,
			publicBaseUrl: this.opts.publicBaseUrl,
			hostingMode: 'share',
			force: opts.force === true,
			sourcePath: site.vaultRelPath,
			kind: site.kind,
			title: site.name,
			releaseTheme: { mode: 'themed' },
		});
		if (!result.success) throw new Error(`publishCloudflare: ${result.error} ${result.code ?? ''}`);
		const sharedKeys = result.data?.sharedKeys as
			| { scope: string; key: string; link: string }[]
			| undefined;
		return {
			url: result.data?.url ?? `${baseURL}index.html`,
			baseURL,
			siteId: binding.siteId,
			projectId: binding.cloudflareProjectId,
			filesUploaded: result.data?.filesUploaded ?? 0,
			buildMs,
			publishMs: Date.now() - p0,
			clientHeader: this.http.lastClientHeader || this.clientHeader,
			...(sharedKeys?.length ? { sharedKeys } : {}),
		};
	}

	dispose(): void {
		rmSync(this.baseDir, { recursive: true, force: true });
	}
}

export { REPO_ROOT, WORKSPACE_ROOT };
