/**
 * Commerce capability — Obsidian side: site-params at publish, stub pages in the
 * plugin workspace (never overwriting vault notes), read-only sales status.
 */
import { Notice, requestUrl } from 'obsidian';
import type FridayPlugin from '../main';
import { withMdfridayClientHeader } from '../mdfriday-client';
import { resolveApiBaseUrl, resolveSiteBaseUrl } from '../cloudflare-env';
import {
	applyCommerceParams,
	applyHostingParams,
	isCommerceShell,
	salesStatusFromOverview,
	type CommerceShell,
	type SalesStatusLine,
} from './commerce-core';

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

export async function getSalesStatus(
	plugin: FridayPlugin,
	projectId: string,
): Promise<SalesStatusLine | null> {
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') return null;
	try {
		const r = await apiJson(plugin, auth.token, 'GET', `/v1/projects/${encodeURIComponent(projectId)}/commerce`);
		if (r.status !== 200 || !r.json) return null;
		return salesStatusFromOverview(r.json);
	} catch {
		return null;
	}
}

async function fetchSiteParams(
	plugin: FridayPlugin,
	token: string,
	projectId: string,
): Promise<CommerceShell | null> {
	const r = await apiJson(
		plugin,
		token,
		'GET',
		`/v1/projects/${encodeURIComponent(projectId)}/commerce/site-params`,
	);
	if (r.status !== 200 || !isCommerceShell(r.json)) return null;
	return {
		v: 1,
		project: r.json.project,
		endpoint: r.json.endpoint,
		pages: {
			purchase: r.json.pages.purchase || '/purchase.html',
			pricing: r.json.pages.pricing || '/pricing.html',
			privacy: r.json.pages.privacy || '/privacy.html',
		},
	};
}

/**
 * Publish step: write params.commerce and params.mdf.hosting.
 * Failures keep the last successful shell and are a non-blocking Notice.
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
		let next = applyHostingParams(params, ctx.hostingMode);
		if (ctx.auth.kind === 'guest') {
			// Guests still get hosting + last shell; site-params needs a user token.
			await ctx.saveConfig(ctx.projectName, 'params', next);
			return;
		}
		let shell: CommerceShell | null = null;
		let failed = false;
		try {
			shell = await fetchSiteParams(plugin, ctx.auth.token, ctx.projectId);
			if (!shell) failed = true;
		} catch (e) {
			console.warn('[commerce] site-params failed', e);
			failed = true;
		}
		next = applyCommerceParams(next, failed ? null : shell, failed);
		await ctx.saveConfig(ctx.projectName, 'params', next);
		if (failed) new Notice(tr(plugin, 'ui.commerce_sync_failed'));
	} catch (e) {
		console.warn('[commerce] publish sync failed', e);
	}
}

export { ensureCommerceStubPages } from './commerce-pages';
