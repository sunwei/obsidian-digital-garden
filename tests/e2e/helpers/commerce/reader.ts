import type { Browser, Page } from 'playwright';
import type { CommerceApi } from './api.ts';
import { payOnCreemCheckout } from './pay.ts';
import { normalizeAccessKey } from './sanitize.ts';

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export type ClaimBody = {
	status: string;
	key?: string;
	unlockUrl?: string | null;
	title?: string;
	retryAfterMs?: number;
};

async function poll<T>(
	fn: () => Promise<T | null>,
	opts: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
	const deadline = Date.now() + opts.timeoutMs;
	let lastErr: unknown;
	while (Date.now() < deadline) {
		try {
			const v = await fn();
			if (v) return v;
		} catch (e) {
			lastErr = e;
		}
		await sleep(opts.intervalMs);
	}
	throw new Error(
		`poll timeout (${opts.timeoutMs}ms) waiting for ${opts.label}${lastErr ? `: ${lastErr}` : ''}`,
	);
}

export async function claimUntilReady(
	api: CommerceApi,
	intentId: string,
	token: string,
	returnQuery: string,
): Promise<ClaimBody> {
	return poll(
		async () => {
			const res = await api<ClaimBody>('POST', '/v1/public/commerce/claim', {
				body: { intentId, token, returnQuery },
				ok: [200],
			});
			if (res.body.status === 'ready' && res.body.key) return res.body;
			if (res.body.status === 'expired' || res.body.status === 'invalid') {
				throw new Error(`claim returned ${res.body.status}`);
			}
			return null;
		},
		{ timeoutMs: 180_000, intervalMs: 2_000, label: `claim ${intentId}` },
	);
}

function siteUrl(publicBaseUrl: string, rel: string): string {
	const base = publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`;
	return new URL(rel.replace(/^\//, ''), base).href;
}

/**
 * Reader: open locked page → buy → Creem pay → claim Key → unlock canary.
 * Returns the issued Key (caller must not log plaintext).
 */
export async function readerPurchaseAndUnlock(
	browser: Browser,
	opts: {
		api: CommerceApi;
		publicBaseUrl: string;
		lockedPageRel: string;
		canary: string;
		readerEmail: string;
		creemApiKey: string;
		priceButtonText?: RegExp;
	},
): Promise<{ key: string; successUrl: string }> {
	const context = await browser.newContext();
	await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
	const page = await context.newPage();
	try {
		await page.goto(siteUrl(opts.publicBaseUrl, opts.lockedPageRel), {
			waitUntil: 'domcontentloaded',
			timeout: 60_000,
		});
		await page.locator('#mdf-access-card').waitFor({ state: 'visible', timeout: 45_000 });
		await page.locator('#mdf-commerce-offers').waitFor({ state: 'visible', timeout: 45_000 });
		await page.locator('#mdf-commerce-offers .mdf-commerce-offer').waitFor({ state: 'visible', timeout: 30_000 });

		const priceBtn = page
			.locator('#mdf-commerce-offers button.mdf-commerce-price')
			.filter({ hasText: opts.priceButtonText ?? /one.?time/i })
			.first();
		await priceBtn.waitFor({ state: 'visible', timeout: 30_000 });
		await priceBtn.click();

		await page.locator('#mdf-commerce-email').waitFor({ state: 'visible', timeout: 30_000 });
		await page.locator('#mdf-commerce-email').fill(opts.readerEmail);
		await page.locator('form.mdf-commerce-confirm button[type="submit"]').click();
		await page.waitForURL((url) => /creem|checkout/i.test(url.toString()), { timeout: 60_000 });

		const pay = await payOnCreemCheckout(page, {
			checkoutUrl: null,
			email: opts.readerEmail,
			creemApiKey: opts.creemApiKey,
		});
		if (!pay.ok) throw new Error(pay.blocked);

		if (pay.via === 'creem_getCheckout' || !page.url().includes('ci=')) {
			await page.goto(pay.successUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		}

		const success = new URL(page.url());
		const intentId = success.searchParams.get('ci') || '';
		const token = success.searchParams.get('t') || '';
		if (!intentId || !token) throw new Error('purchase success URL missing ci/t');

		await page.locator('.mdf-purchase__key').waitFor({ state: 'visible', timeout: 180_000 });
		let key = normalizeAccessKey(await page.locator('.mdf-purchase__key').innerText());
		if (!key || key.length < 8) {
			const claim = await claimUntilReady(opts.api, intentId, token, success.search);
			key = normalizeAccessKey(claim.key || '');
		}
		if (!key) throw new Error('purchase Key empty after claim');

		await unlockPageWithKey(page, siteUrl(opts.publicBaseUrl, opts.lockedPageRel), key, opts.canary);
		return { key, successUrl: page.url() };
	} finally {
		await context.close();
	}
}

export async function unlockPageWithKey(
	page: Page,
	pageUrl: string,
	key: string,
	canary: string,
): Promise<void> {
	await page.goto(`${pageUrl}#mdf-key=${encodeURIComponent(key)}`, {
		waitUntil: 'domcontentloaded',
		timeout: 60_000,
	});
	const unlockedViaHash = await poll(
		async () => {
			const body = await page.innerText('body').catch(() => '');
			return body.includes(canary) ? true : null;
		},
		{ timeoutMs: 20_000, intervalMs: 400, label: 'unlock via hash' },
	).catch(() => false);

	if (!unlockedViaHash) {
		const input = page.locator('#mdf-access-key-input');
		await input.waitFor({ state: 'visible', timeout: 15_000 });
		await input.fill(key);
		await page.locator('#mdf-access-unlock-btn').click();
		await poll(
			async () => {
				const body = await page.innerText('body').catch(() => '');
				return body.includes(canary) ? true : null;
			},
			{ timeoutMs: 30_000, intervalMs: 400, label: 'unlock via form' },
		);
	}
	const body = await page.innerText('body');
	if (!body.includes(canary)) throw new Error('canary not visible after unlock');
}
