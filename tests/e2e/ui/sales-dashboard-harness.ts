/**
 * Staging Dashboard Sales UI (fsky.top/dashboard/sales/) — contact, Creem connect, offers.
 * Auth: inject `mdf.session` with a staging Personal JWT (same shape as Access harness).
 * Never logs Creem keys or Access Key plaintext.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { playwrightLaunchOptions } from './playwright-launch.ts';

export interface SalesDashboardSession {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	siteBaseUrl: string;
}

async function expectToast(page: Page, re: RegExp, timeout = 30_000): Promise<void> {
	await page.locator('.mdf-app-toast, [role="status"], .toast').filter({ hasText: re }).first().waitFor({
		state: 'visible',
		timeout,
	}).catch(async () => {
		// Some builds use transient text in main region
		await page.getByText(re).first().waitFor({ state: 'visible', timeout: 5_000 });
	});
}

export async function openDashboardSales(opts: {
	siteBaseUrl: string;
	userJwt: string;
	userId: string;
	email: string;
	projectId: string;
	tab?: 'overview' | 'offers' | 'orders';
	headless?: boolean;
}): Promise<SalesDashboardSession> {
	const siteBaseUrl = opts.siteBaseUrl.replace(/\/$/, '');
	const browser = await chromium.launch(
		playwrightLaunchOptions({ headless: opts.headless !== false }),
	);
	const context = await browser.newContext();
	const page = await context.newPage();

	await page.goto(`${siteBaseUrl}/account/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await page.evaluate(
		({ token, userId, email }) => {
			const session = {
				token,
				user: { id: userId, email },
				expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
			};
			localStorage.setItem('mdf.session', JSON.stringify(session));
		},
		{ token: opts.userJwt, userId: opts.userId, email: opts.email },
	);

	const tab = opts.tab ?? 'overview';
	const salesUrl = `${siteBaseUrl}/dashboard/sales/?id=${encodeURIComponent(opts.projectId)}&tab=${tab}`;
	await page.goto(salesUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await page.waitForSelector('#mdf-sales-email, button.mdf-app-btn, [data-region="main"]', {
		timeout: 45_000,
	});
	if (page.url().includes('/account/')) {
		throw new Error(`Sales redirected to account (plan/commerce gate?) for project=${opts.projectId}`);
	}
	return { browser, context, page, siteBaseUrl };
}

export async function closeSalesDashboard(session: SalesDashboardSession | undefined): Promise<void> {
	if (!session) return;
	try {
		await session.context.close();
	} catch {
		/* ignore */
	}
	try {
		await session.browser.close();
	} catch {
		/* ignore */
	}
}

/** Overview: save contact email + sender, Connect Creem (test), create one-time offer granting docs. */
export async function configureSalesViaDashboardUi(
	session: SalesDashboardSession,
	opts: {
		contactEmail: string;
		senderName: string;
		creemApiKey: string;
		offerName: string;
		offerSummary?: string;
		/** Scope checkbox id suffix; default docs. Use '*' for all-access. */
		scopeSlug?: string;
	},
): Promise<void> {
	const { page } = session;
	await page.locator('#mdf-sales-email').waitFor({ state: 'visible', timeout: 45_000 });
	await page.locator('#mdf-sales-email').fill(opts.contactEmail);
	await page.locator('#mdf-sales-sender').fill(opts.senderName);
	await page.locator('.mdf-sales-form').getByRole('button', { name: /Save|保存/i }).click();
	await expectToast(page, /Saved|已保存/i);

	await page.getByRole('button', { name: /Connect Creem|连接 Creem/i }).click();
	const dialog = page.locator('.mdf-app-dialog');
	await dialog.waitFor({ state: 'visible', timeout: 15_000 });
	await dialog.locator('#dlg-mode').selectOption('test');
	await dialog.locator('#dlg-apiKey').fill(opts.creemApiKey);
	await dialog.getByRole('button', { name: /Connect Creem|连接/i }).click();
	await expectToast(page, /Connected|已连接/i, 60_000);
	await page.locator('.mdf-sales-connection').waitFor({ state: 'visible', timeout: 30_000 });

	await page.getByRole('tab', { name: /Offers|权益包|商品/i }).click();
	const newOfferBtn = page.locator('[data-region="actions"]').getByRole('button', {
		name: /New offer|新建/i,
	});
	await newOfferBtn.waitFor({ state: 'visible', timeout: 20_000 });
	await newOfferBtn.click();
	const offerDialog = page.locator('.mdf-app-dialog');
	await offerDialog.waitFor({ state: 'visible', timeout: 15_000 });
	await offerDialog.locator('#dlg-name').fill(opts.offerName);
	await offerDialog.locator('#dlg-summary').fill(opts.offerSummary ?? opts.offerName);

	const scope = opts.scopeSlug ?? 'docs';
	// Node has no CSS.escape — escape manually for id selectors.
	const scopeSel =
		scope === '*'
			? offerDialog.locator('#dlg-scopes-\\*')
			: offerDialog.locator(`#dlg-scopes-${scope.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`);
	if (await scopeSel.count()) {
		if (!(await scopeSel.isChecked())) await scopeSel.check();
	} else {
		// Fallback: check first available scope checkbox
		const first = offerDialog.locator('[id^="dlg-scopes-"]').first();
		if (await first.count()) {
			if (!(await first.isChecked())) await first.check();
		}
	}

	await offerDialog.locator('.mdf-sales-price').nth(0).locator('input[inputmode="decimal"]').fill('2.00');
	await offerDialog.getByRole('button', { name: /Save|保存|创建/i }).click();
	await expectToast(page, /Offer created|已创建|创建成功/i, 60_000);
	await page
		.locator('[data-region="main"]')
		.filter({ hasText: opts.offerName })
		.waitFor({ state: 'visible', timeout: 30_000 });
}
