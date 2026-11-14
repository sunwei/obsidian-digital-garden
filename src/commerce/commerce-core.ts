/**
 * Pure commerce publish helpers (unit-tested).
 * Params and stub markdown live in the plugin workspace, never in the vault.
 */
import path from 'path';

export const COMMERCE_PAGE_SLUGS = ['purchase', 'pricing', 'privacy'] as const;
export type CommercePageSlug = (typeof COMMERCE_PAGE_SLUGS)[number];

export const DEFAULT_COMMERCE_PAGES = {
	purchase: '/purchase.html',
	pricing: '/pricing.html',
	privacy: '/privacy.html',
} as const;

export type CommerceShell = {
	v: 1;
	project: string;
	endpoint: string;
	pages: { purchase: string; pricing: string; privacy: string };
};

export type CommerceSiteParams = CommerceShell;

const PAGE_TITLES: Record<CommercePageSlug, { en: string; zh: string }> = {
	purchase: { en: 'Purchase', zh: '购买' },
	pricing: { en: 'Pricing', zh: '价格' },
	privacy: { en: 'Data & Privacy', zh: '数据与隐私' },
};

export function isZhLocale(locale: string | undefined | null): boolean {
	return String(locale || '').toLowerCase().startsWith('zh');
}

export function commerceShell(projectId: string, apiBase: string): CommerceShell {
	return {
		v: 1,
		project: projectId,
		endpoint: apiBase.replace(/\/$/, ''),
		pages: { ...DEFAULT_COMMERCE_PAGES },
	};
}

export function isCommerceShell(value: unknown): value is CommerceShell {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	const pages = v.pages as Record<string, unknown> | undefined;
	return (
		typeof v.project === 'string' &&
		typeof v.endpoint === 'string' &&
		!!pages &&
		typeof pages.purchase === 'string' &&
		typeof pages.pricing === 'string' &&
		typeof pages.privacy === 'string'
	);
}

/** Apply a fresh shell, or keep the last successful one when the request failed. */
export function applyCommerceParams(
	params: Record<string, unknown>,
	next: CommerceShell | null,
	failed: boolean,
): Record<string, unknown> {
	if (next) return { ...params, commerce: next };
	if (failed && isCommerceShell(params.commerce)) return params;
	return params;
}

export function applyHostingParams(
	params: Record<string, unknown>,
	hosting: 'share' | 'custom',
): Record<string, unknown> {
	const mdf =
		params.mdf && typeof params.mdf === 'object' ? { ...(params.mdf as Record<string, unknown>) } : {};
	mdf.hosting = hosting;
	return { ...params, mdf };
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
	return [
		'---',
		`title: ${JSON.stringify(title).slice(1, -1)}`,
		`layout: ${slug}`,
		'mdf_commerce_stub: true',
		'---',
		'',
	].join('\n');
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
	selling: boolean;
	offerCount: number;
	mode: 'live' | 'test' | null;
};

/** Read-only plugin copy: "Selling · 3 offers · live" / "Not enabled (manage in Dashboard)". */
export function formatSalesStatus(status: SalesStatusLine | null, labels: {
	selling: string;
	offers: string;
	disabled: string;
}): string {
	if (!status || !status.selling) return labels.disabled;
	const offers = labels.offers.replace('{{n}}', String(status.offerCount)).replace('{n}', String(status.offerCount));
	const mode = status.mode ? ` · ${status.mode}` : '';
	return `${labels.selling} · ${offers}${mode}`;
}

export function salesStatusFromOverview(body: Record<string, unknown> | null): SalesStatusLine | null {
	if (!body) return null;
	const counts = (body.counts ?? {}) as Record<string, unknown>;
	const offerCount = Number(counts.offers ?? 0) || 0;
	const connection = body.activeConnection as { mode?: string; status?: string } | null;
	const canSell = body.canSell === true;
	const mode = connection?.mode === 'live' || connection?.mode === 'test' ? connection.mode : null;
	return { selling: canSell && offerCount > 0, offerCount, mode };
}
