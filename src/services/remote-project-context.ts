/**
 * Unified remote-project identity for the plugin.
 *
 * Division of labour:
 * - Vault = note content (source of truth for publish payload)
 * - Local project.json binding = pointer to remote project id
 * - Account API quota.features = entitlement source of truth
 * - Control-plane APIs = keys / offers / subscribers / releases (source of truth for stats)
 *
 * This module only owns the **pointer** (projectId + site meta): resolve from local
 * binding, rematch from API when missing, cache for the session, invalidate on publish
 * / account change. Capability cards must not invent their own binding lookups.
 */
import type FridayPlugin from '../main';
import { normalizeVaultPath, pathsEqual } from './project-path';

export type RemoteProjectIdentity = {
	projectName: string;
	projectId: string;
	siteId?: string;
	hostingMode?: 'share' | 'custom';
	publicBaseUrl?: string;
	refreshedAt: number;
	source: 'binding' | 'rematch' | 'publish' | 'cache';
};

export type ResolveRemoteProjectOpts = {
	projectName: string;
	/** Vault path for rematch when local binding is missing. */
	vaultPath?: string | null;
	/** Skip cache and re-read binding / rematch. */
	force?: boolean;
	/** Attempt listProjects rematch when unbound (default true). */
	rematch?: boolean;
	/** Verify remote still exists when binding is present (default false). */
	verify?: boolean;
};

type CacheEntry = {
	identity: RemoteProjectIdentity | null;
	inflight?: Promise<RemoteProjectIdentity | null>;
};

const CACHE_TTL_MS = 60_000;

class RemoteProjectContextImpl {
	private cache = new Map<string, CacheEntry>();
	private revision = 0;
	private listeners = new Set<(revision: number) => void>();

	getRevision(): number {
		return this.revision;
	}

	subscribe(listener: (revision: number) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private bump(): void {
		this.revision += 1;
		for (const fn of this.listeners) {
			try {
				fn(this.revision);
			} catch (e) {
				console.warn('[RemoteProjectContext] listener failed', e);
			}
		}
	}

	/** Synchronous peek — does not start a resolve. */
	peek(projectName: string): RemoteProjectIdentity | null {
		if (!projectName) return null;
		return this.cache.get(projectName)?.identity ?? null;
	}

	invalidate(projectName?: string): void {
		if (projectName) this.cache.delete(projectName);
		else this.cache.clear();
		this.bump();
	}

	/**
	 * Remember identity after a successful publish (session + optional disk already written).
	 */
	rememberFromPublish(
		projectName: string,
		partial: {
			projectId: string;
			siteId?: string;
			hostingMode?: 'share' | 'custom';
			publicBaseUrl?: string;
		},
	): RemoteProjectIdentity {
		const identity: RemoteProjectIdentity = {
			projectName,
			projectId: partial.projectId,
			refreshedAt: Date.now(),
			source: 'publish',
			...(partial.siteId ? { siteId: partial.siteId } : {}),
			...(partial.hostingMode ? { hostingMode: partial.hostingMode } : {}),
			...(partial.publicBaseUrl ? { publicBaseUrl: partial.publicBaseUrl } : {}),
		};
		this.cache.set(projectName, { identity });
		this.bump();
		return identity;
	}

	async resolve(
		plugin: FridayPlugin,
		opts: ResolveRemoteProjectOpts,
	): Promise<RemoteProjectIdentity | null> {
		const name = opts.projectName?.trim();
		if (!name) return null;

		const existing = this.cache.get(name);
		const now = Date.now();
		if (
			!opts.force &&
			existing?.identity &&
			now - existing.identity.refreshedAt < CACHE_TTL_MS
		) {
			return { ...existing.identity, source: 'cache' };
		}
		if (!opts.force && existing?.inflight) {
			return existing.inflight;
		}

		const inflight = this.resolveUncached(plugin, name, opts);
		this.cache.set(name, { identity: existing?.identity ?? null, inflight });
		try {
			const identity = await inflight;
			this.cache.set(name, { identity });
			this.bump();
			return identity;
		} catch (e) {
			this.cache.set(name, { identity: existing?.identity ?? null });
			throw e;
		}
	}

	private async resolveUncached(
		plugin: FridayPlugin,
		projectName: string,
		opts: ResolveRemoteProjectOpts,
	): Promise<RemoteProjectIdentity | null> {
		const fromBinding = await this.readBinding(plugin, projectName);
		if (fromBinding) {
			if (opts.verify) {
				const ok = await this.verifyRemote(plugin, fromBinding.projectId);
				if (!ok) {
					this.cache.delete(projectName);
					// fall through to rematch
				} else {
					return fromBinding;
				}
			} else {
				return fromBinding;
			}
		}

		if (opts.rematch === false) return null;
		const vaultPath = opts.vaultPath ?? this.inferVaultPath(plugin);
		const rematched = await this.rematchFromApi(plugin, projectName, vaultPath);
		return rematched;
	}

	private inferVaultPath(plugin: FridayPlugin): string | null {
		try {
			const contents = plugin.site?.getCurrentContents?.() ?? [];
			const first = contents[0];
			const raw =
				(first?.file?.path as string | undefined) ||
				(first?.folder?.path as string | undefined) ||
				null;
			return normalizeVaultPath(raw);
		} catch {
			return null;
		}
	}

	private async readBinding(
		plugin: FridayPlugin,
		projectName: string,
	): Promise<RemoteProjectIdentity | null> {
		const foundry = plugin.foundryPublishService;
		if (!foundry || !plugin.absWorkspacePath) return null;
		try {
			const bind = await foundry.getCloudflareBinding({
				workspacePath: plugin.absWorkspacePath,
				projectName,
			});
			if (!bind.success || !bind.cloudflareProjectId) return null;
			return {
				projectName,
				projectId: bind.cloudflareProjectId,
				refreshedAt: Date.now(),
				source: 'binding',
				...(bind.siteId ? { siteId: bind.siteId } : {}),
				...(bind.hostingMode === 'custom' || bind.hostingMode === 'share'
					? { hostingMode: bind.hostingMode }
					: {}),
				...(bind.publicBaseUrl ? { publicBaseUrl: bind.publicBaseUrl } : {}),
			};
		} catch {
			return null;
		}
	}

	private async verifyRemote(plugin: FridayPlugin, projectId: string): Promise<boolean> {
		const mgr = plugin.projectServiceManager;
		if (!mgr) return true;
		try {
			const listed = await mgr.listRemoteCloudflareProjects();
			if (!listed.success || !listed.projects) return true; // network blip — keep binding
			return listed.projects.some((p) => p.id === projectId);
		} catch {
			return true;
		}
	}

	private async rematchFromApi(
		plugin: FridayPlugin,
		projectName: string,
		vaultPath: string | null,
	): Promise<RemoteProjectIdentity | null> {
		const mgr = plugin.projectServiceManager;
		if (!mgr || !vaultPath) return null;
		try {
			const listed = await mgr.listRemoteCloudflareProjects();
			if (!listed.success || !listed.projects?.length) return null;
			const workspaceId = plugin.getWorkspaceId?.() ?? plugin.settings.workspaceId ?? null;
			const match = listed.projects.find((p) => {
				if (!p.id || !pathsEqual(p.sourcePath, vaultPath)) return false;
				if (workspaceId && p.workspaceId && p.workspaceId !== workspaceId) return false;
				return true;
			});
			if (!match?.id) return null;

			const hostingMode =
				match.hostingMode === 'custom' || match.hostingMode === 'share'
					? match.hostingMode
					: 'share';
			const identity: RemoteProjectIdentity = {
				projectName,
				projectId: match.id,
				refreshedAt: Date.now(),
				source: 'rematch',
				hostingMode,
				...(match.siteId ? { siteId: match.siteId } : {}),
				...(match.publicUrl ? { publicBaseUrl: match.publicUrl } : {}),
			};

			await this.writeBackBinding(plugin, projectName, identity);
			return identity;
		} catch (e) {
			console.warn('[RemoteProjectContext] rematch failed', e);
			return null;
		}
	}

	private async writeBackBinding(
		plugin: FridayPlugin,
		projectName: string,
		identity: RemoteProjectIdentity,
	): Promise<void> {
		const foundry = plugin.foundryPublishService as
			| {
					adoptCloudflareBinding?: (opts: {
						workspacePath: string;
						projectName: string;
						cloudflareProjectId: string;
						hostingMode?: 'share' | 'custom';
						siteId?: string;
						publicBaseUrl?: string;
					}) => Promise<{ success: boolean; error?: string }>;
			  }
			| null;
		if (!foundry?.adoptCloudflareBinding || !plugin.absWorkspacePath) return;
		try {
			const res = await foundry.adoptCloudflareBinding({
				workspacePath: plugin.absWorkspacePath,
				projectName,
				cloudflareProjectId: identity.projectId,
				hostingMode: identity.hostingMode ?? 'share',
				...(identity.siteId ? { siteId: identity.siteId } : {}),
				...(identity.publicBaseUrl ? { publicBaseUrl: identity.publicBaseUrl } : {}),
			});
			if (!res.success) {
				console.warn('[RemoteProjectContext] adopt binding failed', res.error);
			}
		} catch (e) {
			console.warn('[RemoteProjectContext] adopt binding error', e);
		}
	}
}

/** Process-wide singleton — one identity map for the Obsidian plugin session. */
export const remoteProjectContext = new RemoteProjectContextImpl();

/** Convenience: project id only (Subscribe / Access / Sales / History). */
export async function resolveRemoteProjectId(
	plugin: FridayPlugin,
	projectName: string,
	opts?: Omit<ResolveRemoteProjectOpts, 'projectName'>,
): Promise<string | null> {
	const identity = await remoteProjectContext.resolve(plugin, { projectName, ...opts });
	return identity?.projectId ?? null;
}
