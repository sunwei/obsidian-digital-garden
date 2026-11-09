/**
 * G3 visitor helper: drive the live published site unlock UI (theme access.js).
 * Uses a separate Playwright Chromium (not Obsidian CDP).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { inventWrongAccessKey, unlockPublishedPage } from '../access-unlock.ts';
import { playwrightLaunchOptions } from './playwright-launch.ts';

export interface VisitorUnlockOpts {
	pageUrl: string;
	sharedKey: string;
	canary: string;
	teaser: string;
	apiBase: string;
	/** Optional supporting assert via public session/keys (does not replace UI unlock). */
	alsoAssertApiDecrypt?: boolean;
}

export interface VisitorUnlockResult {
	lockedHadCanary: boolean;
	teaserVisible: boolean;
	wrongKeyFailed: boolean;
	sharedKeyUnlocked: boolean;
	apiDecryptOk?: boolean;
}

async function pageText(page: Page): Promise<string> {
	return page.evaluate(() => document.body?.innerText || '');
}

async function htmlSource(page: Page): Promise<string> {
	return page.content();
}

/**
 * Open published URL → assert locked (teaser, no canary) → wrong key fails →
 * shared key unlocks via #mdf-access-key-input / Unlock button.
 */
export async function unlockPublishedSiteInBrowser(
	opts: VisitorUnlockOpts,
): Promise<VisitorUnlockResult> {
	let browser: Browser | undefined;
	const result: VisitorUnlockResult = {
		lockedHadCanary: true,
		teaserVisible: false,
		wrongKeyFailed: false,
		sharedKeyUnlocked: false,
	};

	try {
		browser = await chromium.launch(playwrightLaunchOptions({ headless: false }));
		const context = await browser.newContext();
		const page = await context.newPage();

		await page.goto(opts.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		// access.js boots on DOMContentLoaded; card may start hidden then show
		await page.waitForSelector('#mdf-encrypt-content[data-format="2"], #mdf-access-key-input', {
			timeout: 30_000,
		});
		await sleep(800);

		const lockedHtml = await htmlSource(page);
		result.lockedHadCanary = lockedHtml.includes(opts.canary);
		const lockedText = await pageText(page);
		result.teaserVisible =
			lockedText.includes(opts.teaser) ||
			lockedHtml.includes(opts.teaser) ||
			!!(await page.locator('.mdf-access-teaser, #mdf-access-card').count());

		// Ensure unlock card is visible
		const card = page.locator('#mdf-access-card');
		const input = page.locator('#mdf-access-key-input');
		await page.evaluate(() => {
			const c = document.getElementById('mdf-access-card');
			if (c) c.hidden = false;
		});
		await input.waitFor({ state: 'visible', timeout: 15_000 });

		// Wrong key
		const wrong = inventWrongAccessKey();
		await input.fill(wrong);
		await page.locator('#mdf-access-unlock-btn').click();
		await sleep(1500);
		const status = page.locator('#mdf-access-status');
		const statusText = ((await status.textContent()) || '').trim();
		const stillLocked = await page.locator('#mdf-encrypt-content').count();
		const afterWrong = await pageText(page);
		result.wrongKeyFailed =
			stillLocked > 0 &&
			!afterWrong.includes(opts.canary) &&
			(/not valid|unable to unlock|try again|invalid|check the access key/i.test(statusText) ||
				statusText.length > 0);

		// Clear and enter shared key (use another key if button present)
		const another = page.locator('#mdf-access-another');
		if (await another.isVisible().catch(() => false)) {
			await another.click();
			await sleep(200);
		}
		await input.fill('');
		await input.fill(opts.sharedKey);
		await page.locator('#mdf-access-unlock-btn').click();

		// Success: encrypt shell replaced; canary appears in body text
		await page.waitForFunction(
			(canary: string) => {
				const body = document.body?.innerText || '';
				const shell = document.getElementById('mdf-encrypt-content');
				return body.includes(canary) && !shell;
			},
			opts.canary,
			{ timeout: 45_000 },
		);
		result.sharedKeyUnlocked = true;

		if (opts.alsoAssertApiDecrypt) {
			const { plainHtml } = await unlockPublishedPage(opts.apiBase, lockedHtml, opts.sharedKey);
			result.apiDecryptOk = plainHtml.includes(opts.canary);
		}

		await context.close();
		return result;
	} finally {
		try {
			await browser?.close();
		} catch {
			/* ignore */
		}
	}
}

export { inventWrongAccessKey };

/** Probe a published URL: public (canary visible, no gate) vs locked (teaser / shell). */
export async function probePublishedPage(opts: {
	pageUrl: string;
	canary: string;
	teaser?: string;
}): Promise<{ status: number; html: string; hasCanary: boolean; hasAccessShell: boolean; hasTeaser: boolean; hasAccessCssLink: boolean }> {
	const res = await fetch(opts.pageUrl);
	const html = await res.text();
	return {
		status: res.status,
		html,
		hasCanary: html.includes(opts.canary),
		hasAccessShell: /data-format=["']2["']/.test(html) && /mdf-encrypt-content|mdf-access-key-input/.test(html),
		hasTeaser: Boolean(opts.teaser && html.includes(opts.teaser)),
		hasAccessCssLink: /caps\/access\/style\.css/.test(html),
	};
}

export interface TryUnlockOpts {
	pageUrl: string;
	accessKey: string;
	canary: string;
	teaser?: string;
	/** Expect unlock to succeed */
	expectUnlock: boolean;
	headless?: boolean;
}

/**
 * Fresh Chromium: open page, try one key via access.js UI.
 * Does not log the key. Clears storage so prior sessions do not leak.
 */
export async function tryUnlockPublishedPageInBrowser(opts: TryUnlockOpts): Promise<{
	unlocked: boolean;
	lockedHadCanary: boolean;
	teaserVisible: boolean;
	statusText: string;
}> {
	let browser: Browser | undefined;
	try {
		browser = await chromium.launch(
			playwrightLaunchOptions({ headless: opts.headless === true ? true : false }),
		);
		const context = await browser.newContext();
		const page = await context.newPage();
		let lastNavErr: unknown;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				await page.goto(opts.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
				lastNavErr = undefined;
				break;
			} catch (err) {
				lastNavErr = err;
				await sleep(800 * attempt);
			}
		}
		if (lastNavErr) throw lastNavErr;
		await page.waitForSelector('#mdf-encrypt-content[data-format="2"], #mdf-access-key-input', {
			timeout: 30_000,
		});
		await sleep(600);

		const lockedHtml = await page.content();
		const lockedHadCanary = lockedHtml.includes(opts.canary);
		const lockedText = await page.evaluate(() => document.body?.innerText || '');
		const teaserVisible = opts.teaser
			? lockedText.includes(opts.teaser) || lockedHtml.includes(opts.teaser)
			: !!(await page.locator('.mdf-access-teaser, #mdf-access-card').count());

		await page.evaluate(() => {
			const c = document.getElementById('mdf-access-card');
			if (c) c.hidden = false;
		});
		const input = page.locator('#mdf-access-key-input');
		await input.waitFor({ state: 'visible', timeout: 15_000 });
		await input.fill(opts.accessKey);
		await page.locator('#mdf-access-unlock-btn').click();

		if (opts.expectUnlock) {
			await page.waitForFunction(
				(canary: string) => {
					const body = document.body?.innerText || '';
					const shell = document.getElementById('mdf-encrypt-content');
					return body.includes(canary) && !shell;
				},
				opts.canary,
				{ timeout: 45_000 },
			);
			const statusText = ((await page.locator('#mdf-access-status').textContent().catch(() => '')) || '').trim();
			await context.close();
			return { unlocked: true, lockedHadCanary, teaserVisible, statusText };
		}

		await sleep(2000);
		const statusText = ((await page.locator('#mdf-access-status').textContent().catch(() => '')) || '').trim();
		const after = await page.evaluate(() => document.body?.innerText || '');
		const shellLeft = (await page.locator('#mdf-encrypt-content').count()) > 0;
		const unlocked = after.includes(opts.canary) && !shellLeft;
		await context.close();
		return { unlocked, lockedHadCanary, teaserVisible, statusText };
	} finally {
		try {
			await browser?.close();
		} catch {
			/* ignore */
		}
	}
}

