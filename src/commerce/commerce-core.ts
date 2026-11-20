/**
 * Pure commerce publish helpers (unit-tested).
 * Connection lives in commerce.enable + services.mdfriday — never params.commerce.
 * Stub markdown lives in the plugin workspace, never in the vault.
 */
import path from 'path';

export const COMMERCE_PAGE_SLUGS = ['purchase', 'pricing', 'privacy'] as const;
export type CommercePageSlug = (typeof COMMERCE_PAGE_SLUGS)[number];

export const DEFAULT_COMMERCE_PAGES = {
	purchase: '/purchase.html',
	pricing: '/pricing.html',
	privacy: '/privacy.html',
} as const;

/** Connection written under `services.mdfriday`. */
export type MDFridayService = {
	project: string;
	endpoint: string;
};

/** Top-level `commerce` block. */
export type CommerceConfigBlock = {
	enable: boolean;
};

/** site-params API payload (still returns pages for tooling; plugin does not stamp them into params). */
export type CommerceSiteParams = MDFridayService & {
	v?: number;
	pages?: { purchase: string; pricing: string; privacy: string };
};

const PAGE_TITLES: Record<CommercePageSlug, { en: string; zh: string }> = {
	purchase: { en: 'Purchase', zh: '购买' },
	pricing: { en: 'Pricing', zh: '价格' },
	privacy: { en: 'Data & Privacy', zh: '数据与隐私' },
};

export function isZhLocale(locale: string | undefined | null): boolean {
	return String(locale || '').toLowerCase().startsWith('zh');
}

export function mdfridayService(projectId: string, apiBase: string): MDFridayService {
	return {
		project: projectId,
		endpoint: apiBase.replace(/\/$/, ''),
	};
}

export function isMDFridayService(value: unknown): value is MDFridayService {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return typeof v.project === 'string' && typeof v.endpoint === 'string' && !!v.project && !!v.endpoint;
}

/** Accept site-params JSON (project + endpoint required; pages optional). */
export function isCommerceSiteParams(value: unknown): value is CommerceSiteParams {
	return isMDFridayService(value);
}

function readEnable(config: Record<string, unknown>): boolean {
	const block = config.commerce;
	if (!block || typeof block !== 'object') return false;
	const enable = (block as Record<string, unknown>).enable;
	return enable === true || enable === 1;
}

function readMDFriday(config: Record<string, unknown>): MDFridayService | null {
	const services = config.services;
	if (!services || typeof services !== 'object') return null;
	const mdfriday = (services as Record<string, unknown>).mdfriday;
	return isMDFridayService(mdfriday) ? { project: mdfriday.project, endpoint: mdfriday.endpoint } : null;
}

export type NavLink = { title: string; url: string };

/** Normalize pricing URLs for navLink matching. */
export function isPricingNavUrl(url: string): boolean {
	const raw = String(url || '').trim().toLowerCase();
	if (!raw) return false;
	const noHash = raw.split('#')[0]?.split('?')[0] ?? raw;
	const trimmed = noHash.replace(/\/+$/, '');
	return (
		trimmed === '/pricing.html' ||
		trimmed === '/pricing' ||
		trimmed === 'pricing.html' ||
		trimmed === 'pricing' ||
		trimmed.endsWith('/pricing.html') ||
		trimmed.endsWith('/pricing')
	);
}

/**
 * Ensure a Pricing entry exists in navLinks. Does not overwrite an existing
 * pricing URL's title (user may have customized it).
 */
export function ensurePricingNavLink(
	navLinks: unknown,
	title: string,
	url = '/pricing.html',
): NavLink[] {
	const list: NavLink[] = [];
	if (Array.isArray(navLinks)) {
		for (const item of navLinks) {
			if (!item || typeof item !== 'object') continue;
			const rec = item as Record<string, unknown>;
			const t = typeof rec.title === 'string' ? rec.title : '';
			const u = typeof rec.url === 'string' ? rec.url : typeof rec.href === 'string' ? rec.href : '';
			if (!t && !u) continue;
			list.push({ title: t || title, url: u || url });
		}
	}
	if (list.some((l) => isPricingNavUrl(l.url))) return list;
	return [...list, { title, url }];
}

/**
 * Build the next top-level commerce + services + params patches.
 * Always strips `params.commerce` (no dual-write / no leftover shell).
 * Enable is **user-driven** (`commerce.enable` / opts.enable) — site-params alone
 * must not flip selling on. When enable is true, upserts Pricing into params.navLinks.
 */
export function applyCommerceConfig(
	config: Record<string, unknown>,
	next: MDFridayService | null,
	failed: boolean,
	opts?: { pricingNavTitle?: string; enable?: boolean },
): {
	commerce: CommerceConfigBlock;
	services: Record<string, unknown>;
	params: Record<string, unknown>;
} {
	const prevParams =
		config.params && typeof config.params === 'object'
			? { ...(config.params as Record<string, unknown>) }
			: {};
	delete prevParams.commerce;

	const services =
		config.services && typeof config.services === 'object'
			? { ...(config.services as Record<string, unknown>) }
			: {};

	const wantEnable = opts?.enable !== undefined ? !!opts.enable : readEnable(config);

	const withPricingNav = (params: Record<string, unknown>): Record<string, unknown> => ({
		...params,
		navLinks: ensurePricingNavLink(
			params.navLinks,
			opts?.pricingNavTitle || 'Pricing',
			'/pricing.html',
		),
	});

	if (!wantEnable) {
		delete services.mdfriday;
		return {
			commerce: { enable: false },
			services,
			params: prevParams,
		};
	}

	if (next) {
		services.mdfriday = { project: next.project, endpoint: next.endpoint };
		return {
			commerce: { enable: true },
			services,
			params: withPricingNav(prevParams),
		};
	}

	if (failed) {
		const prev = readMDFriday(config);
		if (prev) {
			services.mdfriday = prev;
			return {
				commerce: { enable: true },
				services,
				params: withPricingNav(prevParams),
			};
		}
		// Keep the user's enable intent; connection is incomplete until Dashboard is ready.
		return {
			commerce: { enable: true },
			services,
			params: prevParams,
		};
	}

	return {
		commerce: { enable: true },
		services,
		params: prevParams,
	};
}

export function applyHostingParams(
	params: Record<string, unknown>,
	hosting: 'share' | 'custom',
): Record<string, unknown> {
	const mdf =
		params.mdf && typeof params.mdf === 'object' ? { ...(params.mdf as Record<string, unknown>) } : {};
	mdf.hosting = hosting;
	const next = { ...params, mdf };
	delete next.commerce;
	return next;
}

export function vaultNoteCandidates(sourceDir: string, slug: CommercePageSlug): string[] {
	const root = sourceDir.replace(/\\/g, '/').replace(/\/+$/, '');
	const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
	return [join(root, `${slug}.md`), join(root, `${slug}/index.md`)];
}

export function vaultHasCommerceNote(
	existingPaths: Iterable<string>,
	sourceDir: string,
	slug: CommercePageSlug,
): boolean {
	const set = new Set(
		[...existingPaths].map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')),
	);
	return vaultNoteCandidates(sourceDir, slug).some((c) => set.has(c) || set.has(c.toLowerCase()));
}

export function planCommerceStubs(
	existingPaths: Iterable<string>,
	sourceDir: string,
): { write: CommercePageSlug[]; skip: CommercePageSlug[] } {
	const write: CommercePageSlug[] = [];
	const skip: CommercePageSlug[] = [];
	for (const slug of COMMERCE_PAGE_SLUGS) {
		if (vaultHasCommerceNote(existingPaths, sourceDir, slug)) skip.push(slug);
		else write.push(slug);
	}
	return { write, skip };
}

export function stubMarkdown(slug: CommercePageSlug, locale?: string): string {
	const zh = isZhLocale(locale);
	const title = zh ? PAGE_TITLES[slug].zh : PAGE_TITLES[slug].en;
	const lines = [
		'---',
		`title: ${JSON.stringify(title).slice(1, -1)}`,
		`layout: ${slug}`,
		'mdf_commerce_stub: true',
	];
	// Functional pages: hide from explorer / search / graph (Pricing lives in navLinks).
	if (slug === 'purchase' || slug === 'pricing') {
		lines.push('unlisted: true');
	}
	lines.push('---', '');
	return lines.join('\n');
}

export type OverlayKind = 'none' | 'write-into-dir' | 'materialize-overlay' | 'refresh-overlay';

export type OverlayPlan = {
	kind: OverlayKind;
	originalTarget?: string;
	write: CommercePageSlug[];
	skip: CommercePageSlug[];
};

export function planContentOverlay(input: {
	contentIsSymlink: boolean;
	contentTarget?: string | null;
	overlayActive: boolean;
	write: CommercePageSlug[];
	skip: CommercePageSlug[];
}): OverlayPlan {
	const { write, skip } = input;
	if (write.length === 0 && !input.overlayActive) {
		return { kind: 'none', write, skip };
	}
	if (input.contentIsSymlink) {
		return {
			kind: 'materialize-overlay',
			originalTarget: input.contentTarget || undefined,
			write,
			skip,
		};
	}
	if (input.overlayActive) {
		return {
			kind: 'refresh-overlay',
			originalTarget: input.contentTarget || undefined,
			write,
			skip,
		};
	}
	return { kind: 'write-into-dir', write, skip };
}

export type OverlayState = {
	v: 1;
	originalTarget: string;
	stubs: CommercePageSlug[];
};

export function overlayStatePath(projectPath: string): string {
	return path.join(projectPath, '.mdfriday', 'commerce-overlay.json');
}

export function stubDirPath(projectPath: string): string {
	return path.join(projectPath, '.mdfriday', 'commerce-pages');
}

export type SalesStatusLine = {
	/** Checkout connection is ready (plan + contact + active provider). */
	canSell: boolean;
	/** Compat alias of `canSell` for older call sites / tests. Prefer `canSell`. */
	selling: boolean;
	offerCount: number;
	ordersLast30d: number;
	mode: 'live' | 'test' | null;
};

/** Compact status line (legacy). Prefer the stats bar in SalesSection. */
export function formatSalesStatus(status: SalesStatusLine | null, labels: {
	selling: string;
	offers: string;
	disabled: string;
}): string {
	if (!status) return labels.disabled;
	const ready = status.canSell === true;
	if (!ready && status.offerCount === 0) return labels.disabled;
	const offers = labels.offers.replace('{{n}}', String(status.offerCount)).replace('{n}', String(status.offerCount));
	const mode = status.mode ? ` · ${status.mode}` : '';
	const prefix = ready ? labels.selling : labels.disabled;
	return `${prefix} · ${offers}${mode}`;
}

export function salesStatusFromOverview(body: Record<string, unknown> | null): SalesStatusLine | null {
	if (!body) return null;
	const counts = (body.counts ?? {}) as Record<string, unknown>;
	const offerCount = Number(counts.offers ?? 0) || 0;
	const ordersLast30d = Number(counts.ordersLast30d ?? 0) || 0;
	const connection = body.activeConnection as { mode?: string; status?: string } | null;
	const canSell = body.canSell === true;
	const mode = connection?.mode === 'live' || connection?.mode === 'test' ? connection.mode : null;
	return { canSell, selling: canSell, offerCount, ordersLast30d, mode };
}

/** Public for UI / tests — whether top-level commerce.enable is on. */
export function isCommerceEnabled(config: Record<string, unknown> | null | undefined): boolean {
	if (!config) return false;
	return readEnable(config);
}
