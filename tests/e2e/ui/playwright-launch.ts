import type { LaunchOptions } from 'playwright';

/**
 * Prefer system Chrome when Playwright's bundled browser isn't cached
 * (agent sandboxes). Override with PLAYWRIGHT_CHROME_CHANNEL=chromium.
 */
export function playwrightLaunchOptions(
	overrides: LaunchOptions = {},
): LaunchOptions {
	const channel =
		(process.env.PLAYWRIGHT_CHROME_CHANNEL as LaunchOptions['channel']) ||
		'chrome';
	return { channel, ...overrides };
}
