/**
 * Format server content/project expiry for Share UI.
 * Timestamps are epoch milliseconds. Never invent a TTL client-side.
 * Wording avoids "UTC" — uses local calendar date when helpful.
 * User-facing strings come from i18n (`t`); English defaults keep unit tests standalone.
 */

export type ContentExpiryKind = 'none' | 'expired' | 'hours' | 'days' | 'date';

export type ExpiryTranslate = (
	key: string,
	params?: Record<string, unknown>,
) => string;

export interface ContentExpiryFormatOptions {
	/** i18n.t — keys under ui.expiry_* */
	t?: ExpiryTranslate;
	/** BCP 47 locale for the date fragment (e.g. zh-CN, en-US) */
	locale?: string;
}

export interface ContentExpiryInfo {
	kind: ContentExpiryKind;
	/** Absolute ms, when known */
	expiresAt: number | null;
	/** Short label for the strip, e.g. "Expires in 2 days" / "将在 2 天后失效" */
	label: string;
	/** True when local clock is past expiresAt (server cleanup may already have run) */
	isExpired: boolean;
}

const EN_FALLBACK: Record<string, string> = {
	'ui.expiry_expired': 'This link may have expired',
	'ui.expiry_in_1_hour': 'Expires in 1 hour',
	'ui.expiry_in_hours': 'Expires in {{n}} hours',
	'ui.expiry_in_1_day': 'Expires in 1 day · {{date}}',
	'ui.expiry_in_days': 'Expires in {{n}} days · {{date}}',
	'ui.expiry_on_date': 'Expires {{date}}',
};

function interpolate(template: string, params?: Record<string, unknown>): string {
	if (!params) return template;
	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
		const value = params[key];
		return value !== undefined ? String(value) : match;
	});
}

function translate(
	t: ExpiryTranslate | undefined,
	key: string,
	params?: Record<string, unknown>,
): string {
	if (t) {
		const out = t(key, params);
		if (out && out !== key) return out;
	}
	return interpolate(EN_FALLBACK[key] ?? key, params);
}

function formatExpiryDate(expiresAt: number, locale?: string): string {
	const opts: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	};
	try {
		return new Date(expiresAt).toLocaleDateString(locale || undefined, opts);
	} catch {
		return new Date(expiresAt).toLocaleDateString(undefined, opts);
	}
}

/** Normalize possibly-seconds values; API uses ms, tolerate accidental seconds. */
export function normalizeExpiryMs(raw: number): number | null {
	if (!Number.isFinite(raw) || raw <= 0) return null;
	// Heuristic: < year 2001 in ms means value was likely seconds
	if (raw < 1_000_000_000_000) return Math.round(raw * 1000);
	return Math.round(raw);
}

export function formatContentExpiry(
	raw: number | null | undefined,
	nowMs: number = Date.now(),
	opts: ContentExpiryFormatOptions = {},
): ContentExpiryInfo {
	const { t, locale } = opts;
	if (raw == null) {
		return { kind: 'none', expiresAt: null, label: '', isExpired: false };
	}
	const expiresAt = normalizeExpiryMs(raw);
	if (expiresAt == null) {
		return { kind: 'none', expiresAt: null, label: '', isExpired: false };
	}
	const delta = expiresAt - nowMs;
	if (delta <= 0) {
		return {
			kind: 'expired',
			expiresAt,
			label: translate(t, 'ui.expiry_expired'),
			isExpired: true,
		};
	}
	const hourMs = 60 * 60 * 1000;
	const dayMs = 24 * hourMs;
	if (delta < dayMs) {
		const hours = Math.max(1, Math.ceil(delta / hourMs));
		return {
			kind: 'hours',
			expiresAt,
			label:
				hours === 1
					? translate(t, 'ui.expiry_in_1_hour')
					: translate(t, 'ui.expiry_in_hours', { n: hours }),
			isExpired: false,
		};
	}
	const days = Math.ceil(delta / dayMs);
	const dateLabel = formatExpiryDate(expiresAt, locale);
	if (days <= 14) {
		return {
			kind: 'days',
			expiresAt,
			label:
				days === 1
					? translate(t, 'ui.expiry_in_1_day', { date: dateLabel })
					: translate(t, 'ui.expiry_in_days', { n: days, date: dateLabel }),
			isExpired: false,
		};
	}
	return {
		kind: 'date',
		expiresAt,
		label: translate(t, 'ui.expiry_on_date', { date: dateLabel }),
		isExpired: false,
	};
}

/** Prefer per-note project expiry; fall back to account guest contentExpiresAt. */
export function resolveDisplayExpiresAt(opts: {
	pathExpiresAt?: number | null;
	accountContentExpiresAt?: number | null;
	isGuest: boolean;
}): number | null {
	const path = opts.pathExpiresAt;
	if (typeof path === 'number' && Number.isFinite(path) && path > 0) {
		return normalizeExpiryMs(path);
	}
	if (
		opts.isGuest &&
		typeof opts.accountContentExpiresAt === 'number' &&
		Number.isFinite(opts.accountContentExpiresAt) &&
		opts.accountContentExpiresAt > 0
	) {
		return normalizeExpiryMs(opts.accountContentExpiresAt);
	}
	return null;
}
