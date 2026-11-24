/**
 * Portable Garden project settings: extract from local config and apply to config.
 * HTTP lives in project-settings-sync.ts so unit tests can import this file without Obsidian.
 */
export const SETTINGS_PRODUCT = 'garden';

export type GardenThemeSettings = {
	slug: string;
	family?: string;
	variant?: string;
	versionPolicy: 'follow-catalog' | 'pin';
	pinnedVersion?: string;
};

export type GardenProjectSettings = {
	title?: string;
	theme?: GardenThemeSettings;
	branding?: { logo?: string; favicon?: string };
	navLinks?: Array<{ title: string; url: string }>;
	subscribe?: { enabled: boolean; title?: string; description?: string };
	paramOverrides?: Record<string, unknown>;
};

export type ProjectSettingsDocument = {
	product: string;
	schema_version: number;
	revision: number;
	settings: GardenProjectSettings;
	updated_at: number;
	updated_client?: string | null;
};

const SKIP_OVERRIDE_KEYS = new Set([
	'logo',
	'favicon',
	'navLinks',
	'subscribe',
	'mdfriday',
	'password',
	'autoPublish',
	'lastPublishUrl',
	'userStatic',
	'disqusShortname',
]);

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}


function readGardenSettings(value: unknown): GardenProjectSettings | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const rec = value as Record<string, unknown>;
	const out: GardenProjectSettings = {};
	const title = asString(rec.title);
	if (title) out.title = title;
	const theme = rec.theme;
	if (theme && typeof theme === 'object' && !Array.isArray(theme)) {
		const t = theme as Record<string, unknown>;
		const slug = asString(t.slug);
		if (slug) {
			out.theme = {
				slug,
				versionPolicy: t.versionPolicy === 'pin' ? 'pin' : 'follow-catalog',
				...(asString(t.family) ? { family: asString(t.family) } : {}),
				...(asString(t.variant) ? { variant: asString(t.variant) } : {}),
				...(asString(t.pinnedVersion) ? { pinnedVersion: asString(t.pinnedVersion) } : {}),
			};
		}
	}
	const branding = rec.branding;
	if (branding && typeof branding === 'object' && !Array.isArray(branding)) {
		const b = branding as Record<string, unknown>;
		const logo = asString(b.logo);
		const favicon = asString(b.favicon);
		if (logo || favicon) {
			out.branding = {
				...(logo ? { logo } : {}),
				...(favicon ? { favicon } : {}),
			};
		}
	}
	if (Array.isArray(rec.navLinks)) {
		out.navLinks = rec.navLinks
			.map((item) => {
				if (!item || typeof item !== 'object') return null;
				const row = item as Record<string, unknown>;
				const nt = asString(row.title);
				const url = asString(row.url);
				return nt && url ? { title: nt, url } : null;
			})
			.filter((row): row is { title: string; url: string } => !!row);
	}
	const sub = rec.subscribe;
	if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
		const s = sub as Record<string, unknown>;
		out.subscribe = {
			enabled: s.enabled === true,
			...(asString(s.title) ? { title: asString(s.title) } : {}),
			...(asString(s.description) ? { description: asString(s.description) } : {}),
		};
	}
	if (rec.paramOverrides && typeof rec.paramOverrides === 'object' && !Array.isArray(rec.paramOverrides)) {
		out.paramOverrides = rec.paramOverrides as Record<string, unknown>;
	}
	return out;
}


/** Pull portable fields out of Foundry config.json (and optional theme slug). */
export function extractProjectSettings(
	config: Record<string, unknown> | null | undefined,
	themeSlug?: string | null,
): GardenProjectSettings {
	const cfg = config ?? {};
	const params = (cfg.params && typeof cfg.params === 'object' ? cfg.params : {}) as Record<
		string,
		unknown
	>;
	const out: GardenProjectSettings = {};
	const title = asString(cfg.title);
	if (title) out.title = title;

	const mdfriday = (params.mdfriday && typeof params.mdfriday === 'object'
		? params.mdfriday
		: {}) as Record<string, unknown>;
	const slug = asString(themeSlug) || asString(mdfriday.slug);
	const family = asString(mdfriday.family);
	const variant = asString(mdfriday.variant);
	if (slug || family) {
		out.theme = {
			slug: slug || [family, variant].filter(Boolean).join('-') || 'canopy',
			versionPolicy: 'follow-catalog',
			...(family ? { family } : {}),
			...(variant ? { variant } : {}),
		};
	}

	const logo = asString(params.logo);
	const favicon = asString(params.favicon);
	if (logo || favicon) {
		out.branding = {
			...(logo ? { logo } : {}),
			...(favicon ? { favicon } : {}),
		};
	}

	if (Array.isArray(params.navLinks)) {
		out.navLinks = params.navLinks
			.map((item) => {
				if (!item || typeof item !== 'object') return null;
				const rec = item as Record<string, unknown>;
				const nt = asString(rec.title);
				const url = asString(rec.url);
				return nt && url ? { title: nt, url } : null;
			})
			.filter((row): row is { title: string; url: string } => !!row);
	}

	const sub = params.subscribe;
	if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
		const rec = sub as Record<string, unknown>;
		out.subscribe = {
			enabled: rec.enabled === true,
			...(asString(rec.title) ? { title: asString(rec.title) } : {}),
			...(asString(rec.description) ? { description: asString(rec.description) } : {}),
		};
	}

	const overrides: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (SKIP_OVERRIDE_KEYS.has(key) || value === undefined) continue;
		overrides[key] = value;
	}
	if (Object.keys(overrides).length) out.paramOverrides = overrides;

	return out;
}

/** Merge a settings document into a Foundry config object (does not touch secrets or absolute paths). */
export function applyProjectSettingsToConfig(
	config: Record<string, unknown>,
	settings: GardenProjectSettings,
): Record<string, unknown> {
	const next = { ...config };
	if (settings.title) next.title = settings.title;
	const prevParams = (
		next.params && typeof next.params === 'object' ? next.params : {}
	) as Record<string, unknown>;
	const params: Record<string, unknown> = { ...prevParams };
	if (settings.branding) {
		if (settings.branding.logo !== undefined) params.logo = settings.branding.logo;
		if (settings.branding.favicon !== undefined) params.favicon = settings.branding.favicon;
	}
	if (settings.navLinks) params.navLinks = settings.navLinks;
	if (settings.subscribe) {
		const prevSub = (
			params.subscribe && typeof params.subscribe === 'object'
				? params.subscribe
				: {}
		) as Record<string, unknown>;
		params.subscribe = {
			...prevSub,
			enabled: settings.subscribe.enabled === true,
			...(settings.subscribe.title !== undefined ? { title: settings.subscribe.title } : {}),
			...(settings.subscribe.description !== undefined
				? { description: settings.subscribe.description }
				: {}),
		};
		delete (params.subscribe as Record<string, unknown>).endpoint;
		delete (params.subscribe as Record<string, unknown>).project;
	}
	if (settings.theme) {
		const prevMd = (
			params.mdfriday && typeof params.mdfriday === 'object' ? params.mdfriday : {}
		) as Record<string, unknown>;
		params.mdfriday = {
			...prevMd,
			...(settings.theme.family ? { family: settings.theme.family } : {}),
			...(settings.theme.variant ? { variant: settings.theme.variant } : {}),
		};
	}
	if (settings.paramOverrides) {
		for (const [key, value] of Object.entries(settings.paramOverrides)) {
			if (SKIP_OVERRIDE_KEYS.has(key)) continue;
			params[key] = value;
		}
	}
	next.params = params;
	return next;
}

export function shouldReplaceCachedSettings(
	localRevision: number | null | undefined,
	remoteRevision: number | null | undefined,
): boolean {
	if (remoteRevision == null || !Number.isFinite(remoteRevision)) return false;
	if (localRevision == null || !Number.isFinite(localRevision)) return true;
	return remoteRevision > localRevision;
}

export function parseSettingsDocument(raw: unknown): ProjectSettingsDocument | null {
	if (!raw || typeof raw !== 'object') return null;
	const rec = raw as Record<string, unknown>;
	const settings = rec.settings;
	const revision = Number(rec.revision);
	if (!Number.isFinite(revision) || revision < 1) return null;
	const parsedSettings = readGardenSettings(settings);
	if (!parsedSettings) return null;
	return {
		product: typeof rec.product === 'string' ? rec.product : SETTINGS_PRODUCT,
		schema_version: Number(rec.schema_version) || 1,
		revision,
		settings: parsedSettings,
		updated_at: Number(rec.updated_at) || 0,
		updated_client: typeof rec.updated_client === 'string' ? rec.updated_client : null,
	};
}

/** Normalize settings carried on a project list/detail row. */
export function settingsFromProjectRow(row: Record<string, unknown> | null | undefined): {
	revision: number;
	settings: GardenProjectSettings;
} | null {
	if (!row) return null;
	const revision = Number(row.settingsRevision ?? row.settings_revision);
	const settings = row.settings;
	const parsedSettings = readGardenSettings(settings);
	if (!Number.isFinite(revision) || revision < 1 || !parsedSettings) {
		return null;
	}
	return { revision, settings: parsedSettings };
}
