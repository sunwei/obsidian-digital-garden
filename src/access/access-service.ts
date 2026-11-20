/**
 * Access keys capability — plugin-side status for the Advanced panel.
 * Keys are issued in the Dashboard; here we only show an active-key count.
 */
import { requestUrl } from 'obsidian';
import type FridayPlugin from '../main';
import { withMdfridayClientHeader } from '../mdfriday-client';
import { resolveApiBaseUrl, resolveSiteBaseUrl } from '../cloudflare-env';
import { resolveRemoteProjectId } from '../services/remote-project-context';

export type AccessKeyStatus = {
	projectId: string;
	activeKeyCount: number;
};

function apiBase(plugin: FridayPlugin): string {
	return resolveApiBaseUrl(plugin.settings);
}

async function userToken(plugin: FridayPlugin): Promise<{ token: string; kind: 'user' | 'guest' } | null> {
	const mgr = plugin.projectServiceManager;
	if (!mgr) return null;
	return mgr.resolveAuthToken();
}

export function dashboardAccessUrl(plugin: FridayPlugin, projectId: string | null): string {
	const site = resolveSiteBaseUrl(plugin.settings).replace(/\/$/, '');
	const q = projectId ? `?id=${encodeURIComponent(projectId)}` : '';
	return `${site}/dashboard/access/${q}`;
}

/**
 * Active access-key count for the local project (resolves Cloudflare binding like Subscribe).
 * Null when guest / unbound / error.
 */
export async function getAccessKeyStatus(
	plugin: FridayPlugin,
	projectName: string,
): Promise<AccessKeyStatus | null> {
	const projectId = await resolveRemoteProjectId(plugin, projectName, { rematch: true });
	if (!projectId) return null;
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') return null;
	try {
		const url = `${apiBase(plugin)}/v1/projects/${encodeURIComponent(projectId)}/access-keys?status=active`;
		const res = await requestUrl({
			url,
			method: 'GET',
			headers: withMdfridayClientHeader(url, {
				Authorization: `Bearer ${auth.token}`,
				Accept: 'application/json',
			}),
			throw: false,
		});
		if (res.status !== 200) return null;
		let json: Record<string, unknown> | null = null;
		try {
			json = (typeof res.json === 'object' && res.json ? res.json : JSON.parse(res.text || 'null')) as
				| Record<string, unknown>
				| null;
		} catch {
			json = null;
		}
		const keysCandidate = json?.keys ?? json?.accessKeys;
		const keys = Array.isArray(keysCandidate)
			? keysCandidate
			: Array.isArray(json)
				? json
				: [];
		return { projectId, activeKeyCount: keys.length };
	} catch {
		return null;
	}
}

export function readAccessEnabled(params: Record<string, unknown> | null | undefined): boolean {
	const raw = params?.access;
	if (!raw || typeof raw !== 'object') return false;
	return (raw as Record<string, unknown>).enabled === true;
}

export function writeAccessParams(
	prevParams: Record<string, unknown> | null | undefined,
	enabled: boolean,
	opts: { guest: boolean },
): Record<string, unknown> {
	const base = prevParams && typeof prevParams === 'object' ? { ...prevParams } : {};
	const on = !opts.guest && enabled;
	if (!on) {
		const prev = base.access;
		if (!prev || typeof prev !== 'object') {
			// Never configured and still off — omit the key.
			delete base.access;
			return base;
		}
		base.access = { ...(prev as Record<string, unknown>), enabled: false };
		return base;
	}
	const prev = base.access && typeof base.access === 'object' ? (base.access as Record<string, unknown>) : {};
	base.access = { ...prev, enabled: true };
	return base;
}
