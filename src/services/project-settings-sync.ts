/**
 * Portable Garden project settings: talk to GET/PUT /v1/projects/:id/settings.
 */
import { withMdfridayClientHeader } from '../mdfriday-client';
import {
	SETTINGS_PRODUCT,
	parseSettingsDocument,
	type GardenProjectSettings,
	type ProjectSettingsDocument,
} from './project-settings-payload';

export {
	SETTINGS_PRODUCT,
	applyProjectSettingsToConfig,
	extractProjectSettings,
	parseSettingsDocument,
	settingsFromProjectRow,
	shouldReplaceCachedSettings,
	type GardenProjectSettings,
	type GardenThemeSettings,
	type ProjectSettingsDocument,
} from './project-settings-payload';

async function requestJson(opts: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}): Promise<{ status: number; json: unknown }> {
	const { requestUrl } = await import('obsidian');
	const res = await requestUrl({
		url: opts.url,
		method: opts.method,
		headers: opts.headers,
		body: opts.body,
		throw: false,
	});
	const rawJson: unknown = res.json;
	let json: unknown = rawJson;
	if (typeof rawJson !== 'object' || rawJson === null) {
		try {
			json = JSON.parse(res.text || '{}') as unknown;
		} catch {
			json = {};
		}
	}
	return { status: res.status, json };
}

export async function fetchProjectSettings(opts: {
	apiBase: string;
	token: string;
	projectId: string;
}): Promise<ProjectSettingsDocument | null> {
	const url = `${opts.apiBase.replace(/\/$/, '')}/v1/projects/${opts.projectId}/settings`;
	const res = await requestJson({
		url,
		method: 'GET',
		headers: withMdfridayClientHeader(url, { Authorization: `Bearer ${opts.token}` }),
	});
	if (res.status === 404) return null;
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`GET settings HTTP ${res.status}`);
	}
	return parseSettingsDocument(res.json);
}

export async function putProjectSettings(opts: {
	apiBase: string;
	token: string;
	projectId: string;
	settings: GardenProjectSettings;
	revision: number;
}): Promise<ProjectSettingsDocument> {
	const url = `${opts.apiBase.replace(/\/$/, '')}/v1/projects/${opts.projectId}/settings`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${opts.token}`,
		'Content-Type': 'application/json',
	};
	if (opts.revision <= 0) headers['If-None-Match'] = '*';
	else headers['If-Match'] = `"${opts.revision}"`;

	const res = await requestJson({
		url,
		method: 'PUT',
		headers: withMdfridayClientHeader(url, headers),
		body: JSON.stringify({ product: SETTINGS_PRODUCT, settings: opts.settings, revision: opts.revision }),
	});

	const parsed = res.json;
	if (res.status === 409) {
		const err = new Error('SETTINGS_CONFLICT') as Error & {
			current?: ProjectSettingsDocument | null;
		};
		err.current = parseSettingsDocument(
			(parsed as { error?: { details?: { current?: unknown } } })?.error?.details?.current,
		);
		throw err;
	}
	if (res.status < 200 || res.status >= 300) {
		const msg =
			(parsed as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
		throw new Error(msg);
	}
	const doc = parseSettingsDocument(parsed);
	if (!doc) throw new Error('Invalid settings response');
	return doc;
}

/** Create or update after a successful publish. 409 is retried once as last-write-wins. */
export async function upsertProjectSettingsAfterPublish(opts: {
	apiBase: string;
	token: string;
	projectId: string;
	settings: GardenProjectSettings;
	localRevision?: number | null;
}): Promise<ProjectSettingsDocument> {
	const known = opts.localRevision && opts.localRevision > 0 ? opts.localRevision : 0;
	try {
		return await putProjectSettings({ ...opts, revision: known });
	} catch (err) {
		const conflict = err instanceof Error && err.message === 'SETTINGS_CONFLICT';
		const current = (err as { current?: ProjectSettingsDocument | null })?.current;
		if (conflict) {
			const latest = current ?? (await fetchProjectSettings(opts));
			if (latest) return putProjectSettings({ ...opts, revision: latest.revision });
		}
		if (known > 0) {
			return putProjectSettings({ ...opts, revision: 0 });
		}
		throw err;
	}
}
