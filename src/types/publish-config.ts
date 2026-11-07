/**
 * Path-scoped publish domain model (Phase 0).
 *
 * Entry points (inventory):
 * - file-menu → main.addPublishMenuItems → publishToWeb → Site.applyDefaultsAndPublish
 * - file-menu → addToPublishListMenuItem → openPublishPanel (config only)
 * - command publish-to-web / quick-share → same as above
 * - Site.startPublish → sidebar form state (mode / theme / password)
 *
 * Defaults (right-click direct publish):
 * - folder → mode=themed, default theme (quartz), no password
 *
 * Garden is folder/wiki only. Single-note as-is belongs to Share.
 */

import { DEFAULT_THEME_SLUGS } from '../utils/theme';

export type SelectionKind = 'note' | 'folder';

/** Garden persists themed only; faithful kept in the union for legacy pathConfigs. */
export type PublishMode = 'faithful' | 'themed';

export type AccountTier = 'guest' | 'free' | 'pro';

export interface PathPublishConfig {
	mode: PublishMode;
	/** Catalog slug; required when mode=themed */
	themeSlug?: string;
	/** Local flag only — plaintext submitted at publish time, not persisted */
	hasPasswordFlag?: boolean;
	/**
	 * Server project/content expiry (epoch ms). Cached for UI only —
	 * cleanup is always decided by the API. Never invent client-side TTL.
	 */
	contentExpiresAt?: number | null;
	updatedAt?: number;
}

export interface PublishRecord {
	url: string;
	publishedAt: number;
	mode: PublishMode;
	projectName: string;
	path?: string;
}

export function selectionKindFromContents(contents: {
	file?: unknown;
	folder?: unknown;
}[]): SelectionKind {
	const first = contents[0];
	if (first?.folder) return 'folder';
	return 'note';
}

/** Right-click / quick-publish defaults (ignore saved path config). */
export function getDefaultPublishConfig(_kind: SelectionKind = 'folder'): PathPublishConfig {
	return {
		mode: 'themed',
		themeSlug: DEFAULT_THEME_SLUGS.QUARTZ,
		hasPasswordFlag: false,
	};
}

/** Garden always publishes themed/wiki; legacy faithful configs are coerced. */
export function coercePublishMode(
	_kind: SelectionKind,
	_mode: PublishMode | undefined,
): PublishMode {
	return 'themed';
}
