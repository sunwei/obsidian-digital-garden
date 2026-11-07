/**
 * Fire-and-forget BUILD_* diagnostics for the publish path.
 * Never await from callers that affect publish UX. Swallows all errors.
 * Skips when there is no Key yet (do not mint a Key just to report).
 */
import { requestUrl } from 'obsidian';
import type FridayPlugin from '../main';
import { withMdfridayClientHeader, MDFRIDAY_CLIENT_HEADER } from '../mdfriday-client';

export type BuildMode = 'themed' | 'faithful';
export type BuildEventType = 'BUILD_STARTED' | 'BUILD_SUCCEEDED' | 'BUILD_FAILED';
export type BuildErrorCode =
	| 'build_failed'
	| 'package_failed'
	| 'path_unavailable'
	| 'timeout'
	| 'cancelled'
	| 'unknown';

const TIMEOUT_MS = 2000;

export function classifyBuildError(err: unknown): BuildErrorCode {
	const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
	if (!msg.trim()) return 'unknown';
	if (msg.includes('path') && (msg.includes('unavail') || msg.includes('not found') || msg.includes('no such'))) {
		return 'path_unavailable';
	}
	if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
	if (msg.includes('cancel')) return 'cancelled';
	if (msg.includes('package') || msg.includes('faithful') || msg.includes('snapshot')) return 'package_failed';
	if (msg.includes('build')) return 'build_failed';
	return 'unknown';
}

function pluginVersion(plugin: FridayPlugin): string | null {
	const v = (plugin.manifest?.version || '').trim();
	return v ? v.slice(0, 32) : null;
}

/**
 * Report a publish-path build event. Callers must not await.
 * UI / Notices / preview windows should run first.
 */
export function reportBuildEvent(
	plugin: FridayPlugin,
	opts: {
		event_type: BuildEventType;
		mode: BuildMode;
		duration_ms?: number;
		error_code?: BuildErrorCode;
		project_id?: string | null;
	},
): void {
	try {
		const key = (plugin.settings?.mdfKey || '').trim();
		if (!key) return;
		const apiBase = (plugin.settings?.cloudflareApiBaseUrl || '').replace(/\/$/, '');
		if (!apiBase) return;

		const body: Record<string, unknown> = {
			event_type: opts.event_type,
			mode: opts.mode,
		};
		if (opts.duration_ms != null && Number.isFinite(opts.duration_ms) && opts.duration_ms >= 0) {
			body.duration_ms = Math.round(opts.duration_ms);
		}
		if (opts.event_type === 'BUILD_FAILED') {
			body.error_code = opts.error_code || 'unknown';
		}
		if (opts.project_id && /^p_[a-zA-Z0-9]+$/.test(opts.project_id)) {
			body.project_id = opts.project_id;
		}
		const ver = pluginVersion(plugin);
		if (ver) body.plugin_version = ver;

		const url = `${apiBase}/v1/analytics/events`;
		const headers = withMdfridayClientHeader(url, {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
		}) ?? {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
		};

		void Promise.race([
			requestUrl({
				url,
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				throw: false,
			}),
			new Promise<null>((resolve) => window.setTimeout(() => resolve(null), TIMEOUT_MS)),
		]).catch(() => {
			/* swallow — never surface to publish/preview */
		});
	} catch {
		/* swallow sync setup errors too */
	}
}

/** @internal exported for tests / debugging */
export const _internals = { TIMEOUT_MS, MDFRIDAY_CLIENT_HEADER };
