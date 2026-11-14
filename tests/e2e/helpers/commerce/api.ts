/**
 * Thin MDFriday commerce API client for Garden E2E.
 * Behavior aligned with cloudflare/packages/test-kit/src/commerce (arch/commerce/12).
 */
import { sanitizeLog } from './sanitize.ts';

export type ApiResult<T> = { status: number; body: T; text: string };

export function createCommerceApi(apiBase: string) {
	const base = apiBase.replace(/\/$/, '');
	return async function api<T>(
		method: string,
		pathname: string,
		opts: { token?: string; body?: unknown; ok?: number[] } = {},
	): Promise<ApiResult<T>> {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (opts.token) headers.authorization = `Bearer ${opts.token}`;
		const res = await fetch(`${base}${pathname}`, {
			method,
			headers,
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		});
		const text = await res.text();
		let body: T;
		try {
			body = JSON.parse(text) as T;
		} catch {
			body = text as T;
		}
		const allowed = opts.ok ?? [200, 201];
		if (!allowed.includes(res.status)) {
			throw new Error(`${method} ${pathname} → ${res.status}: ${sanitizeLog(text).slice(0, 500)}`);
		}
		return { status: res.status, body, text };
	};
}

export type CommerceApi = ReturnType<typeof createCommerceApi>;
