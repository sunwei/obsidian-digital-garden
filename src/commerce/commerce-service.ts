/**
 * Commerce capability — Obsidian side: write commerce.enable + services.mdfriday
 * at publish, stub pages in the plugin workspace (never overwriting vault notes),
 * read-only sales status. Does not write params.commerce.
 */
import { Notice, requestUrl } from 'obsidian';
import type FridayPlugin from '../main';
import { withMdfridayClientHeader } from '../mdfriday-client';
import { resolveApiBaseUrl, resolveSiteBaseUrl } from '../cloudflare-env';
import {
	applyCommerceConfig,
	applyHostingParams,
	isCommerceEnabled,
	isCommerceSiteParams,
	isZhLocale,
	mdfridayService,
	salesStatusFromOverview,
	type MDFridayService,
	type SalesStatusLine,
} from './commerce-core';
import { resolveRemoteProjectId } from '../services/remote-project-context';

function tr(plugin: FridayPlugin, key: string, params?: Record<string, string | number>): string {
	return plugin.i18n?.t?.(key, params) ?? key;
}

function apiBase(plugin: FridayPlugin): string {
	return resolveApiBaseUrl(plugin.settings);
}

async function userToken(plugin: FridayPlugin): Promise<{ token: string; kind: 'user' | 'guest' } | null> {
	const mgr = plugin.projectServiceManager;
	if (!mgr) return null;
	return mgr.resolveAuthToken();
}

async function apiJson(
	plugin: FridayPlugin,
	token: string,
	method: 'GET',
	pathName: string,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
	const url = `${apiBase(plugin)}${pathName}`;
	const res = await requestUrl({
		url,
		method,
		headers: withMdfridayClientHeader(url, {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
		}),
		throw: false,
	});
	let json: Record<string, unknown> | null = null;
	try {
		json = (typeof res.json === 'object' && res.json ? res.json : JSON.parse(res.text || 'null')) as
			| Record<string, unknown>
			| null;
	} catch {
		json = null;
	}
	return { status: res.status, json };
}

export function dashboardSalesUrl(plugin: FridayPlugin, projectId: string): string {
	return `${resolveSiteBaseUrl(plugin.settings).replace(/\/$/, '')}/dashboard/sales/?id=${encodeURIComponent(projectId)}`;
}

/**
 * Sales overview for the local project (resolves Cloudflare binding like Subscribe).
 * Returns null when guest / unbound / error. `projectId` is attached for Dashboard links.
 */
export async function getSalesStatus(
	plugin: FridayPlugin,
	projectName: string,
): Promise<(SalesStatusLine & { projectId: string }) | null> {
	const projectId = await resolveRemoteProjectId(plugin, projectName, { rematch: true });
	if (!projectId) return null;
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') return null;
	try {
		const r = await apiJson(plugin, auth.token, 'GET', `/v1/projects/${encodeURIComponent(projectId)}/commerce`);
		if (r.status !== 200 || !r.json) return null;
		const line = salesStatusFromOverview(r.json);
		return line ? { ...line, projectId } : null;
	} catch {
		return null;
	}
}

async function fetchSiteParams(
	plugin: FridayPlugin,
	token: string,
	projectId: string,
): Promise<MDFridayService | null> {
	const r = await apiJson(
		plugin,
		token,
		'GET',
		`/v1/projects/${encodeURIComponent(projectId)}/commerce/site-params`,
	);
	if (r.status !== 200 || !isCommerceSiteParams(r.json)) return null;
	return mdfridayService(r.json.project, r.json.endpoint);
}

/**
 * Publish step: write commerce.enable + services.mdfriday + params.mdf.hosting.
 * Strips params.commerce. Failures keep the last successful connection (non-blocking Notice).
 */
export async function syncCommerceOnPublish(
	plugin: FridayPlugin,
	ctx: {
		projectName: string;
		projectId: string;
		auth: { token: string; kind: 'user' | 'guest' };
		hostingMode: 'share' | 'custom';
		getConfig: (projectName: string) => Promise<Record<string, unknown>>;
		saveConfig: (projectName: string, key: string, value: unknown) => Promise<boolean>;
	},
): Promise<void> {
	try {
		const config = await ctx.getConfig(ctx.projectName);
		const params = (config.params && typeof config.params === 'object' ? config.params : {}) as Record<
			string,
			unknown
		>;
		const hostedParams = applyHostingParams(params, ctx.hostingMode);

		if (ctx.auth.kind === 'guest') {
			// Guests still get hosting; strip legacy params.commerce; keep prior commerce/services.
			await ctx.saveConfig(ctx.projectName, 'params', hostedParams);
			return;
		}

		let shell: MDFridayService | null = null;
		let failed = false;
		try {
			shell = await fetchSiteParams(plugin, ctx.auth.token, ctx.projectId);
			if (!shell) failed = true;
		} catch (e) {
			console.warn('[commerce] site-params failed', e);
			failed = true;
		}

		const lang =
			typeof plugin.i18n?.getCurrentLanguage === 'function'
				? plugin.i18n.getCurrentLanguage()
				: '';
		const pricingNavTitle = isZhLocale(lang) ? '价格' : 'Pricing';
		const enable = isCommerceEnabled(config);
		const next = applyCommerceConfig({ ...config, params: hostedParams }, shell, failed, {
			pricingNavTitle,
			enable,
		});
		await ctx.saveConfig(ctx.projectName, 'params', next.params);
		await ctx.saveConfig(ctx.projectName, 'commerce', next.commerce);
		await ctx.saveConfig(ctx.projectName, 'services', next.services);
		if (enable && failed) new Notice(tr(plugin, 'ui.commerce_sync_failed'));
	} catch (e) {
		console.warn('[commerce] publish sync failed', e);
	}
}

export { ensureCommerceStubPages } from './commerce-pages';
