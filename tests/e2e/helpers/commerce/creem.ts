import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeLog } from './sanitize.ts';

const CREEM_TEST_API = 'https://test-api.creem.io';
export const CREEM_TEST_SUCCESS_CARD = '4111111111111111';

const PROTECTED_BILLING_WEBHOOKS = new Set([
	'wh_test_4O691JQA00JFFXmMDpJ5HP',
	'wh_test_64S1b0KbsOadhwL1DJD9BO',
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CF_ROOT = path.resolve(HERE, '../../../../..', 'cloudflare');

function parseEnvFile(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i < 0) continue;
		const k = t.slice(0, i).trim();
		let v = t.slice(i + 1).trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1);
		}
		out[k] = v;
	}
	return out;
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

/** Load E2E_CREEM_TEST_API_KEY from cloudflare/.staging.vars (never CREEM_API_KEY). */
export function loadCreemTestApiKey(): string {
	const fromEnv = process.env.E2E_CREEM_TEST_API_KEY?.trim();
	const varsPath = path.join(CF_ROOT, '.staging.vars');
	const file = existsSync(varsPath) ? parseEnvFile(readFileSync(varsPath, 'utf8')) : {};
	const key = fromEnv || file.E2E_CREEM_TEST_API_KEY || '';
	if (key.length < 8) {
		throw new Error(
			`E2E_CREEM_TEST_API_KEY missing (env or ${varsPath}). Required for Garden commerce E2E.`,
		);
	}
	const billing = file.CREEM_API_KEY || process.env.CREEM_API_KEY || '';
	if (billing && key === billing) {
		throw new Error('E2E_CREEM_TEST_API_KEY must not be the platform billing CREEM_API_KEY');
	}
	return key;
}

export function commercePrereqs(): { ok: boolean; missing: string[] } {
	const missing: string[] = [];
	if (process.env.E2E_COMMERCE !== '1') {
		return { ok: false, missing: ['E2E_COMMERCE=1 (opt-in)'] };
	}
	try {
		loadCreemTestApiKey();
	} catch (e) {
		missing.push(e instanceof Error ? e.message : String(e));
	}
	return { ok: missing.length === 0, missing };
}

function listFrom(body: unknown): Record<string, unknown>[] {
	if (Array.isArray(body)) return body as Record<string, unknown>[];
	if (body && typeof body === 'object') {
		const rec = body as Record<string, unknown>;
		const list = rec.data ?? rec.items ?? rec.webhooks ?? rec.products;
		if (Array.isArray(list)) return list as Record<string, unknown>[];
	}
	return [];
}

export async function creemTestRequest<T>(
	apiKey: string,
	method: string,
	pathname: string,
	body?: unknown,
): Promise<T> {
	let lastErr: Error | null = null;
	for (let attempt = 0; attempt < 6; attempt++) {
		const headers: Record<string, string> = {
			'x-api-key': apiKey,
			accept: 'application/json',
			'user-agent': 'mdfriday-commerce/1.0',
		};
		let raw: string | undefined;
		if (body !== undefined) {
			headers['content-type'] = 'application/json';
			raw = JSON.stringify(body);
		}
		const res = await fetch(`${CREEM_TEST_API}${pathname}`, { method, headers, body: raw });
		const text = await res.text();
		if (res.status === 429 || res.status >= 500) {
			lastErr = new Error(`Creem ${method} ${pathname} → ${res.status}`);
			await sleep(1000 * 2 ** attempt);
			continue;
		}
		if (!res.ok) {
			throw new Error(`Creem ${method} ${pathname} → ${res.status}: ${sanitizeLog(text).slice(0, 300)}`);
		}
		if (!text) return undefined as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			return text as T;
		}
	}
	throw lastErr ?? new Error(`Creem ${method} ${pathname} failed after retries`);
}

export async function cleanupCreemWebhooks(
	apiKey: string,
	keepConnectionId: string | null,
): Promise<{ kept: string[]; deleted: string[] }> {
	const body = await creemTestRequest<unknown>(apiKey, 'GET', '/v1/webhooks');
	const items = listFrom(body);
	const kept: string[] = [];
	const deleted: string[] = [];
	for (const item of items) {
		const id = typeof item.id === 'string' ? item.id : '';
		const url = typeof item.url === 'string' ? item.url : '';
		const name = typeof item.name === 'string' ? item.name : '';
		if (!id) continue;
		if (PROTECTED_BILLING_WEBHOOKS.has(id) || /\/v1\/billing\/webhook\/?$/.test(url)) {
			kept.push(`${id} ${name}`.trim());
			continue;
		}
		const isCommerce = /\/v1\/commerce\/webhooks\//.test(url) || /\/v1\/webhooks\/commerce\//.test(url);
		const isKeep =
			keepConnectionId &&
			isCommerce &&
			(url.endsWith(`/${keepConnectionId}`) || url.includes(`/${keepConnectionId}`));
		if (isKeep) {
			kept.push(`${id} ${name}`.trim());
			continue;
		}
		if (isCommerce || /^MDFriday/i.test(name)) {
			await creemTestRequest(apiKey, 'DELETE', `/v1/webhooks/${encodeURIComponent(id)}`);
			deleted.push(`${id} ${name}`.trim());
			continue;
		}
		kept.push(`${id} ${name}`.trim());
	}
	return { kept, deleted };
}
