import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	formatContentExpiry,
	normalizeExpiryMs,
	resolveDisplayExpiresAt,
} from '../src/utils/content-expiry.ts';
import { en } from '../src/i18n/locales/en.ts';
import { zhCn } from '../src/i18n/locales/zh-cn.ts';
import { interpolateTemplate, getNestedValue } from '../src/i18n/utils.ts';

function makeT(ns: typeof en) {
	return (key: string, params?: Record<string, unknown>) => {
		const value = getNestedValue(ns, key);
		if (typeof value !== 'string') return key;
		return interpolateTemplate(value, params);
	};
}

describe('content-expiry', () => {
	it('normalizeExpiryMs accepts ms and seconds', () => {
		assert.equal(normalizeExpiryMs(1_700_000_000_000), 1_700_000_000_000);
		assert.equal(normalizeExpiryMs(1_700_000_000), 1_700_000_000_000);
		assert.equal(normalizeExpiryMs(0), null);
	});

	it('formatContentExpiry never invents a date when missing', () => {
		assert.equal(formatContentExpiry(null).kind, 'none');
		assert.equal(formatContentExpiry(undefined).label, '');
	});

	it('formatContentExpiry English defaults without UTC', () => {
		const now = Date.UTC(2026, 10, 6, 1, 0, 0);
		const inTwoDays = now + 2 * 24 * 60 * 60 * 1000;
		const info = formatContentExpiry(inTwoDays, now, { locale: 'en-US' });
		assert.equal(info.kind, 'days');
		assert.match(info.label, /Expires in 2 days/);
		assert.equal(info.label.includes('UTC'), false);

		const oneDay = formatContentExpiry(now + 24 * 60 * 60 * 1000, now, { locale: 'en-US' });
		assert.match(oneDay.label, /Expires in 1 day/);

		const past = formatContentExpiry(now - 1000, now);
		assert.equal(past.isExpired, true);
		assert.match(past.label, /expired/i);
	});

	it('formatContentExpiry uses zh-cn strings via t', () => {
		const now = Date.UTC(2026, 10, 6, 1, 0, 0);
		const inSevenDays = now + 7 * 24 * 60 * 60 * 1000;
		const info = formatContentExpiry(inSevenDays, now, {
			t: makeT(zhCn),
			locale: 'zh-CN',
		});
		assert.equal(info.kind, 'days');
		assert.match(info.label, /将在 7 天后失效/);
		assert.match(info.label, /2026/);
		assert.equal(info.label.includes('UTC'), false);
		assert.equal(info.label.includes('Expires'), false);

		const expired = formatContentExpiry(now - 1, now, { t: makeT(zhCn) });
		assert.equal(expired.label, '此链接可能已失效');
	});

	it('formatContentExpiry uses en locale keys via t', () => {
		const now = Date.UTC(2026, 10, 6, 1, 0, 0);
		const info = formatContentExpiry(now + 3 * 60 * 60 * 1000, now, {
			t: makeT(en),
			locale: 'en-US',
		});
		assert.equal(info.kind, 'hours');
		assert.match(info.label, /Expires in 3 hours/);
	});

	it('resolveDisplayExpiresAt prefers path over account for guests', () => {
		assert.equal(
			resolveDisplayExpiresAt({
				pathExpiresAt: 2_000_000_000_000,
				accountContentExpiresAt: 1_700_000_000_000,
				isGuest: true,
			}),
			2_000_000_000_000,
		);
		assert.equal(
			resolveDisplayExpiresAt({
				pathExpiresAt: null,
				accountContentExpiresAt: 1_700_000_000_000,
				isGuest: false,
			}),
			null,
		);
		assert.equal(
			resolveDisplayExpiresAt({
				pathExpiresAt: null,
				accountContentExpiresAt: 1_700_000_000_000,
				isGuest: true,
			}),
			1_700_000_000_000,
		);
	});
});
