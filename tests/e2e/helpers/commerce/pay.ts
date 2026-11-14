import type { Page } from 'playwright';
import { creemTestRequest, CREEM_TEST_SUCCESS_CARD } from './creem.ts';
import { redactPageText, redactUrl } from './sanitize.ts';

export type PayResult =
	| { ok: true; successUrl: string; via: 'redirect' | 'creem_getCheckout' }
	| { ok: false; blocked: string; url: string };

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export function isClaimSuccessUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return Boolean(parsed.searchParams.get('ci') && parsed.searchParams.get('t'));
	} catch {
		return false;
	}
}

function checkoutRefFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		const q = parsed.searchParams.get('checkout_id') || parsed.searchParams.get('checkoutId');
		if (q) return q;
		const parts = parsed.pathname.split('/').filter(Boolean);
		const last = parts[parts.length - 1] ?? '';
		if (/^(ch_|chk_|che_)/i.test(last) || last.startsWith('ch_')) return last;
		const named = parts.find((p) => /^(ch_|chk_|che_)/i.test(p));
		return named ?? null;
	} catch {
		return null;
	}
}

async function visibleText(page: Page): Promise<string> {
	const chunks: string[] = [];
	for (const frame of page.frames()) {
		const text = await frame.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
		if (text.trim()) chunks.push(text);
	}
	return chunks.join('\n');
}

function detectBlocker(url: string, text: string): string | null {
	const blob = `${url}\n${text}`;
	if (
		/recaptcha|h-captcha|hcaptcha|cf-challenge|cdn-cgi\/challenge|are you (a |human)|verify you are human|captcha/i.test(
			blob,
		)
	) {
		return `CAPTCHA or bot challenge at ${url}: ${redactPageText(text)}`;
	}
	if (
		/3-?d secure|3ds|authentication required|complete authentication/i.test(blob) &&
		!/test/i.test(text)
	) {
		return `3DS / authentication wall at ${url}: ${redactPageText(text)}`;
	}
	return null;
}

async function lookupPaidSuccessUrl(
	creemApiKey: string,
	checkoutRef: string | null,
): Promise<string | null> {
	if (!checkoutRef) return null;
	try {
		const body = await creemTestRequest<Record<string, unknown>>(
			creemApiKey,
			'GET',
			`/v1/checkouts?checkout_id=${encodeURIComponent(checkoutRef)}`,
		);
		const rec = (
			body.object && typeof body.object === 'object'
				? body.object
				: Array.isArray(body.data)
					? body.data[0]
					: body
		) as Record<string, unknown> | undefined;
		if (!rec || typeof rec !== 'object') return null;
		const status = String(rec.status ?? '');
		const successUrl = String(rec.success_url ?? rec.successUrl ?? '');
		if (status === 'completed' && isClaimSuccessUrl(successUrl)) return successUrl;
	} catch {
		return null;
	}
	return null;
}

export async function payOnCreemCheckout(
	page: Page,
	opts: { checkoutUrl: string | null; email: string; creemApiKey: string; buyerName?: string },
): Promise<PayResult> {
	const buyerName = opts.buyerName ?? 'Garden E2E Buyer';
	if (opts.checkoutUrl) {
		await page.goto(opts.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	}
	const checkoutRef = checkoutRefFromUrl(opts.checkoutUrl || page.url());

	const nameInput = page.locator('#name');
	try {
		await nameInput.waitFor({ state: 'visible', timeout: 30_000 });
	} catch {
		const payVisible = await page
			.locator('button[type="submit"]')
			.filter({ hasText: /Pay \$|Subscribe/i })
			.isVisible()
			.catch(() => false);
		if (!payVisible) {
			throw new Error(
				`Creem checkout did not show the name field at ${redactUrl(page.url())}: ${redactPageText(await visibleText(page))}`,
			);
		}
	}
	if (await nameInput.isVisible().catch(() => false)) {
		await nameInput.fill(buyerName);
		await nameInput.blur();
		const emailInput = page.locator('#email');
		if (
			(await emailInput.isVisible().catch(() => false)) &&
			(await emailInput.isEnabled().catch(() => false))
		) {
			await emailInput.fill(opts.email);
		}
		const continueBtn = page.getByRole('button', { name: /Continue to payment/i });
		await continueBtn.waitFor({ state: 'visible', timeout: 20_000 });
		await page.waitForFunction(() => {
			const btn = [...document.querySelectorAll('button')].find((el) =>
				/Continue to payment/i.test(el.textContent || ''),
			);
			if (!btn) return false;
			const text = (btn.textContent || '').trim();
			return !(btn as HTMLButtonElement).disabled && !/updating/i.test(text);
		}, { timeout: 20_000 });
		await continueBtn.click();
		await page.getByRole('button', { name: /Pay \$|Subscribe/i }).waitFor({ state: 'visible', timeout: 20_000 });
	}

	const cardIframe = page.locator('iframe[title="card-form"]');
	try {
		await cardIframe.waitFor({ state: 'visible', timeout: 45_000 });
	} catch {
		const text = await visibleText(page);
		const blocked = detectBlocker(page.url(), text);
		const pulled = await lookupPaidSuccessUrl(opts.creemApiKey, checkoutRef);
		if (pulled) return { ok: true, successUrl: pulled, via: 'creem_getCheckout' };
		return {
			ok: false,
			blocked:
				blocked ??
				`Payment card form did not appear at ${redactUrl(page.url())}: ${redactPageText(text)}`,
			url: page.url(),
		};
	}

	const holder = page.locator('input[name="cardHolderName"]');
	await holder.waitFor({ state: 'visible', timeout: 15_000 });
	await holder.fill(buyerName);
	const card = page.frameLocator('iframe[title="card-form"]');
	const number = card.locator('input[name="number"]');
	const exp = card.locator('input[name="expirationDate"]');
	const cvv = card.locator('input[name="cvv"]');
	await number.click();
	await number.fill('');
	await number.pressSequentially(CREEM_TEST_SUCCESS_CARD, { delay: 40 });
	await exp.click();
	await exp.fill('');
	await exp.pressSequentially('1230', { delay: 40 });
	await cvv.click();
	await cvv.fill('');
	await cvv.pressSequentially('123', { delay: 40 });
	await sleep(500);

	const payBtn = page.locator('button[type="submit"]').filter({ hasText: /Pay|Subscribe/i });
	await payBtn.waitFor({ state: 'visible', timeout: 15_000 });
	await payBtn.click();

	try {
		await page.waitForURL((u) => isClaimSuccessUrl(u.toString()), { timeout: 90_000 });
		return { ok: true, successUrl: page.url(), via: 'redirect' };
	} catch {
		const text = await visibleText(page);
		const blocked = detectBlocker(page.url(), text);
		const pulled = await lookupPaidSuccessUrl(opts.creemApiKey, checkoutRef);
		if (pulled) return { ok: true, successUrl: pulled, via: 'creem_getCheckout' };
		return {
			ok: false,
			blocked: blocked ?? `Timed out after Pay at ${redactUrl(page.url())}: ${redactPageText(text)}`,
			url: page.url(),
		};
	}
}
