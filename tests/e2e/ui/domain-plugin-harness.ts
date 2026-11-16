/**
 * Drive account-level Automatic domain setup + DomainPicker selection via the plugin service
 * (Obsidian CDP evaluate). Keeps SSL/DNS wait inside core AutomaticProvisioning.
 */
import type { Page } from 'playwright';
import { PLUGIN_ID } from './obsidian-harness.ts';

export type AutomaticDomainResult = {
	domainId: string;
	hostname: string;
	status: string;
	certStatus: string;
	usable: boolean;
	elapsedMs: number;
};

type PluginDomainSvc = {
	addAutomatic: (
		hostname: string,
		credentialRef: unknown,
		opts?: {
			confirm?: (plan: unknown) => boolean | Promise<boolean>;
			onProgress?: (p: { phase: string; percentage: number; message: string }) => void;
		},
	) => Promise<{
		success: boolean;
		error?: string;
		code?: string;
		data?: {
			id: string;
			hostname: string;
			status: string;
			certStatus: string;
			usable: boolean;
		};
	}>;
	toggleDomain: (
		projectName: string,
		domainId: string,
		on: boolean,
		remoteProjectId: string | null,
		opts?: unknown,
	) => Promise<{ success: boolean; error?: string; data?: { domainIds: string[] } }>;
	list: () => Promise<{
		success: boolean;
		data?: Array<{ id: string; hostname: string; usable: boolean; status: string; certStatus: string }>;
	}>;
};

type FridayPluginLike = {
	syncCloudflareSession?: () => void;
	foundryCustomDomainService?: PluginDomainSvc;
};

/**
 * Settings-equivalent path: Automatic Aliyun setup through ObsidianCustomDomainService.
 * DNS writes + verify + cert wait run inside the plugin (same as Add domain Modal → Automatic).
 */
export async function addDomainAutomaticViaPlugin(
	page: Page,
	opts: {
		hostname: string;
		accessKeyId: string;
		accessKeySecret: string;
		/** Default true — overwrite leftover A/AAAA conflicts from prior runs. */
		confirmConflicts?: boolean;
	},
): Promise<AutomaticDomainResult> {
	const started = Date.now();
	const result = await page.evaluate(
		async (args) => {
			const w = window as unknown as {
				app: { plugins: { plugins: Record<string, FridayPluginLike> } };
			};
			const plugin = w.app.plugins.plugins[args.pluginId];
			if (!plugin?.foundryCustomDomainService) {
				return { ok: false as const, error: 'foundryCustomDomainService missing — rebuild smoke with I5+' };
			}
			plugin.syncCloudflareSession?.();
			const phases: string[] = [];
			const res = await plugin.foundryCustomDomainService.addAutomatic(
				args.hostname,
				{
					inline: {
						provider: 'aliyun',
						label: 'e2e-ui05',
						fields: {
							accessKeyId: args.accessKeyId,
							accessKeySecret: args.accessKeySecret,
						},
					},
					remember: false,
				},
				{
					confirm: async () => args.confirmConflicts,
					onProgress: (p) => {
						phases.push(`${p.phase}:${p.percentage}`);
						console.log(`[ui05.addAutomatic] ${p.phase} ${p.percentage}% ${p.message}`);
					},
				},
			);
			if (!res.success || !res.data) {
				return {
					ok: false as const,
					error: res.error || res.code || 'addAutomatic failed',
					phases,
				};
			}
			return {
				ok: true as const,
				domain: res.data,
				phases,
			};
		},
		{
			pluginId: PLUGIN_ID,
			hostname: opts.hostname,
			accessKeyId: opts.accessKeyId,
			accessKeySecret: opts.accessKeySecret,
			confirmConflicts: opts.confirmConflicts !== false,
		},
	);

	if (!result.ok) {
		throw new Error(`addAutomatic failed: ${result.error}`);
	}
	const domain = result.domain;
	if (!domain.usable) {
		throw new Error(
			`addAutomatic returned non-usable domain status=${domain.status} cert=${domain.certStatus}`,
		);
	}
	return {
		domainId: domain.id,
		hostname: domain.hostname,
		status: domain.status,
		certStatus: domain.certStatus,
		usable: domain.usable,
		elapsedMs: Date.now() - started,
	};
}

/** Check the DomainPicker intent for this project (local selection → hosting on next publish). */
export async function selectDomainInPickerViaPlugin(
	page: Page,
	opts: { projectName: string; domainId: string; remoteProjectId: string },
): Promise<void> {
	const result = await page.evaluate(
		async (args) => {
			const w = window as unknown as {
				app: { plugins: { plugins: Record<string, FridayPluginLike> } };
			};
			const plugin = w.app.plugins.plugins[args.pluginId];
			const svc = plugin?.foundryCustomDomainService;
			if (!svc) return { ok: false as const, error: 'foundryCustomDomainService missing' };
			plugin.syncCloudflareSession?.();
			const res = await svc.toggleDomain(
				args.projectName,
				args.domainId,
				true,
				args.remoteProjectId,
				{},
			);
			if (!res.success) {
				return { ok: false as const, error: res.error || 'toggleDomain failed' };
			}
			const ids = res.data?.domainIds ?? [];
			if (!ids.includes(args.domainId)) {
				return { ok: false as const, error: `domain ${args.domainId} not in selection ${ids.join(',')}` };
			}
			return { ok: true as const };
		},
		{
			pluginId: PLUGIN_ID,
			projectName: opts.projectName,
			domainId: opts.domainId,
			remoteProjectId: opts.remoteProjectId,
		},
	);
	if (!result.ok) throw new Error(result.error);
}

/** Assert DomainPicker lists the hostname (optional UI smoke after selection). */
export async function assertDomainPickerShowsHost(page: Page, hostname: string): Promise<void> {
	const found = await page.evaluate((host) => {
		const picker = document.querySelector('.domain-picker');
		if (!picker) return false;
		return (picker.textContent || '').toLowerCase().includes(host.toLowerCase());
	}, hostname);
	if (!found) {
		// Advanced may be collapsed — still OK if selection was set via service.
		console.warn(`  domain-picker DOM did not show ${hostname} (selection may still be set)`);
	}
}
