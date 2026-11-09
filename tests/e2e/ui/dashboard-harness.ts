/**
 * Staging Dashboard Access UI (fsky.top/dashboard/access/) — issue & revoke keys.
 * Auth: inject `mdf.session` with a staging user JWT (same shape as account-flow.js).
 * Never logs the issued secret.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { playwrightLaunchOptions } from './playwright-launch.ts';

export interface DashboardSession {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	siteBaseUrl: string;
}

export interface IssueKeyResult {
	secret: string;
	label: string;
}

function redact(s: string): string {
	if (!s) return '';
	if (s.length <= 4) return '****';
	return `${s.slice(0, 2)}…${s.slice(-2)} (len=${s.length})`;
}

/**
 * Open headed Chromium, inject session, land on Access page for the project.
 */
export async function openDashboardAccess(opts: {
	siteBaseUrl: string;
	userJwt: string;
	userId: string;
	email: string;
	projectId: string;
	headless?: boolean;
}): Promise<DashboardSession> {
	const siteBaseUrl = opts.siteBaseUrl.replace(/\/$/, '');
	const browser = await chromium.launch(
		playwrightLaunchOptions({ headless: opts.headless === true }),
	);
	const context = await browser.newContext();
	const page = await context.newPage();

	// Seed session before any dashboard navigation (OAuth is Google-only on staging).
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

	const accessUrl = `${siteBaseUrl}/dashboard/access/?id=${encodeURIComponent(opts.projectId)}&tab=keys`;
	await page.goto(accessUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await page.waitForSelector('#mdf-acc-site, button.mdf-app-btn, [data-region="main"]', {
		timeout: 45_000,
	});
	// Wait for keys toolbar / New key button (i18n: en "New key" / zh "新建密钥")
	await page
		.getByRole('button', { name: /New key|新建密钥/i })
		.first()
		.waitFor({ state: 'visible', timeout: 45_000 })
		.catch(async () => {
			const body = await page.locator('[data-region="main"]').innerText().catch(() => '');
			throw new Error(
				`Dashboard Access did not show New key for project=${opts.projectId}. main=${body.slice(0, 300)}`,
			);
		});

	return { browser, context, page, siteBaseUrl };
}

export async function closeDashboard(session: DashboardSession | undefined): Promise<void> {
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

/**
 * Click New key → fill label → grant one or more scope slugs → Generate →
 * read one-time secret from the dialog body.
 * Pass `scopeSlugs` for multi-scope grants; `scopeSlug` remains as a single-scope alias.
 */
export async function issueAccessKeyViaDashboardUi(
	session: DashboardSession,
	opts: { label: string; scopeSlug?: string; scopeSlugs?: string[] },
): Promise<IssueKeyResult> {
	const { page } = session;
	const wanted = [
		...new Set(
			(opts.scopeSlugs?.length ? opts.scopeSlugs : opts.scopeSlug ? [opts.scopeSlug] : []).filter(
				Boolean,
			),
		),
	];
	if (!wanted.length) throw new Error('issueAccessKeyViaDashboardUi requires scopeSlug(s)');

	await page.getByRole('button', { name: /New key|新建密钥/i }).first().click();

	const dialog = page.locator('.mdf-app-dialog, [role="dialog"]').last();
	await dialog.waitFor({ state: 'visible', timeout: 15_000 });

	const labelInput = dialog.locator('#dlg-label');
	await labelInput.waitFor({ state: 'visible', timeout: 10_000 });
	await labelInput.fill(opts.label);

	const wantedSet = new Set(wanted);
	const scopeBoxes = dialog.locator('input[type="checkbox"]');
	const count = await scopeBoxes.count();
	if (count === 0) {
		throw new Error('Create-key dialog has no scope checkboxes');
	}
	for (let i = 0; i < count; i++) {
		const box = scopeBoxes.nth(i);
		const val = await box.getAttribute('value');
		const checked = await box.isChecked();
		if (val && wantedSet.has(val)) {
			if (!checked) await box.check();
		} else if (checked) {
			await box.uncheck();
		}
	}
	for (const slug of wanted) {
		const byValue = dialog.locator(`input[type="checkbox"][value="${slug}"]`);
		if ((await byValue.count()) === 0) {
			throw new Error(
				`Scope checkbox for "${slug}" not found. Hint: publish must register the independent scope first.`,
			);
		}
		if (!(await byValue.isChecked())) await byValue.check();
	}

	await dialog.getByRole('button', { name: /Generate|生成/i }).click();

	// One-time secret dialog
	await sleep(800);
	const secretDialog = page.locator('.mdf-app-dialog, [role="dialog"]').last();
	await secretDialog.waitFor({ state: 'visible', timeout: 30_000 });
	const titleText = ((await secretDialog.locator('h2, h1, .mdf-app-dialog_title').first().textContent()) || '').trim();
	if (!/Copy the key|只显示一次|secretOnce|立即复制/i.test(titleText + (await secretDialog.innerText()))) {
		// Still accept if body looks like a 17-char key
	}
	const bodyText = await secretDialog.innerText();
	const keyMatch =
		bodyText.match(/\b([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z])\b/i) ||
		bodyText.match(/\b([0-9A-HJ-NP-Z]{17})\b/i);
	if (!keyMatch?.[1]) {
		throw new Error(
			`Could not parse issued access key from Dashboard dialog (label=${opts.label}). Dialog text length=${bodyText.length}`,
		);
	}
	const normalized = keyMatch[1].replace(/-/g, '').toUpperCase();
	if (normalized.length !== 17) {
		throw new Error(`Issued key has unexpected length ${normalized.length}`);
	}

	// Dismiss dialog (Copy / confirm)
	const confirm = secretDialog.getByRole('button', { name: /Copy|复制|OK|确定|Close|关闭/i }).first();
	if (await confirm.isVisible().catch(() => false)) {
		await confirm.click();
	} else {
		await page.keyboard.press('Escape');
	}
	await sleep(500);

	console.log(`  dashboard issued key label=${opts.label} scopes=${wanted.join(",")} ${redact(normalized)}`);
	return { secret: normalized, label: opts.label };
}

/**
 * Click Revoke on the row matching `label`, confirm the danger dialog.
 */
export async function revokeAccessKeyViaDashboardUi(
	session: DashboardSession,
	opts: { label: string },
): Promise<void> {
	const { page } = session;
	// Ensure keys tab
	const keysTab = page.getByRole('tab', { name: /Keys|密钥/i });
	if (await keysTab.count()) {
		await keysTab.first().click().catch(() => undefined);
		await sleep(300);
	}

	const row = page.locator('tr, .mdf-app-table_row, tbody tr').filter({ hasText: opts.label }).first();
	await row.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
		throw new Error(`Dashboard key row not found for label=${opts.label}`);
	});

	const revokeBtn = row.getByRole('button', { name: /Revoke|撤销/i });
	await revokeBtn.click();

	const dialog = page.locator('.mdf-app-dialog, [role="dialog"]').last();
	await dialog.waitFor({ state: 'visible', timeout: 10_000 });
	await dialog.getByRole('button', { name: /Revoke|撤销/i }).click();
	await sleep(1000);

	// Row should show revoked badge or disappear from active filter
	console.log(`  dashboard revoked key label=${opts.label}`);
}
