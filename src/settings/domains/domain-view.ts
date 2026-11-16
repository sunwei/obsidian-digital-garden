import type {
	ObsidianCustomDomain,
	ObsidianDomainSelection,
	ObsidianProjectDomains,
} from '@mdfriday/core';
import { dnsShortHost } from '../../services/dns-host';
import type FridayPlugin from '../../main';

export type UiT = (key: string, params?: Record<string, string | number>) => string;

/** `plugin.i18n.t` for `ui.*` keys. Short keys: `uiT(plugin)('domains_add')`. */
export function uiT(plugin: FridayPlugin): UiT {
	return (key, params) => plugin.i18n?.t?.(`ui.${key}`, params) ?? key;
}

/** Prefer server `quota.features`; fall back to plan name when features not yet refreshed. */
function hasQuotaFeature(plugin: FridayPlugin, feature: string, planFallback: string[]): boolean {
	const s = plugin.settings;
	const features = s.mdfQuotaFeatures || [];
	if (features.length > 0) return features.includes(feature);
	return planFallback.includes((s.mdfKeyPlan || '').toLowerCase());
}

/** Account can own custom domains (Personal+ / `custom_domain` feature). */
export function canUseCustomDomains(plugin: FridayPlugin): boolean {
	return hasQuotaFeature(plugin, 'custom_domain', ['personal', 'pro']);
}

/** Account can enable Selling / commerce (Personal+ / `commerce` feature from account API). */
export function canUseCommerce(plugin: FridayPlugin): boolean {
	return hasQuotaFeature(plugin, 'commerce', ['personal', 'pro']);
}

/** Tell open UIs (settings tab, sidebar picker) that domains / selection changed. */
export function notifyDomainsChanged(plugin: FridayPlugin): void {
	plugin.app.workspace.trigger('friday:domains-changed');
}

export function isApexHost(hostname: string): boolean {
	return dnsShortHost(hostname) === '@';
}

export function stripScheme(url: string): string {
	return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function siteUrlOrHost(url: string | null | undefined, fallbackHost: string): string {
	return url && url.trim() ? url : `https://${fallbackHost}/`;
}

/**
 * Status text for a settings row.
 * Example: `Active · Primary · Project: p_… · Workspace: …`
 * Unattached: `Not attached · Project: — · Workspace: —`
 */
export function domainStatusLine(t: UiT, domain: ObsidianCustomDomain): string {
	const parts: string[] = [];
	if (domain.status === 'paused') {
		parts.push(t('domains_status_paused'));
	} else if (domain.usable) {
		parts.push(domain.boundProject ? t('domains_status_active') : t('domains_unbound'));
	} else if (domain.certStatus === 'failed') {
		parts.push(t('domains_status_cert_failed'));
	} else if (domain.nextStep === 'wait_cert') {
		parts.push(t('domains_status_waiting_cert'));
	} else {
		parts.push(t('domains_status_waiting_dns'));
	}
	if (domain.usable && domain.boundProject) {
		parts.push(domain.boundProject.title);
		if (domain.isPrimary) parts.push(t('domains_primary'));
	}
	const projectId = domain.projectId || domain.boundProject?.id || '';
	const workspaceId = domain.boundProject?.workspaceId?.trim() || '';
	parts.push(t('domains_project_id', { id: projectId || '—' }));
	parts.push(t('domains_workspace_id', { id: workspaceId || '—' }));
	return parts.join(' · ');
}

export interface PendingMove {
	domainId: string;
	hostname: string;
	fromTitle: string;
	/** Source project loses its primary domain (case A or B) — it needs a republish. */
	wasPrimary: boolean;
	/** Case A: this is the source project's only domain, so it goes offline. */
	siteGoesOffline: boolean;
}

/**
 * Domains in the selection that currently belong to another project and are confirmed to move
 * on publish (arch 05 §4.2). Derived from the live domain list, same rule as `MoveImpact`.
 */
export function pendingMoves(
	selection: ObsidianDomainSelection,
	domains: ObsidianCustomDomain[],
	currentProjectId: string | null,
): PendingMove[] {
	const moves: PendingMove[] = [];
	for (const id of selection.allowMoveFrom) {
		const domain = domains.find((d) => d.id === id);
		if (!domain?.boundProject || domain.projectId === currentProjectId) continue;
		const siblings = domains.filter(
			(d) => d.projectId === domain.projectId && d.id !== domain.id,
		);
		moves.push({
			domainId: domain.id,
			hostname: domain.hostname,
			fromTitle: domain.boundProject.title,
			wasPrimary: domain.isPrimary || siblings.length === 0,
			siteGoesOffline: siblings.length === 0,
		});
	}
	return moves;
}

/** Selection differs from what the server currently has bound to this project. */
export function selectionDiffersFromServer(
	selection: ObsidianDomainSelection,
	bound: ObsidianProjectDomains | null,
): boolean {
	const boundIds = bound ? bound.domains.map((d) => d.id) : [];
	if (selection.domainIds.length !== boundIds.length) return true;
	if (!selection.domainIds.every((id) => boundIds.includes(id))) return true;
	if (selection.domainIds.length === 0) return false;
	return (selection.primaryDomainId ?? null) !== (bound?.primaryDomainId ?? null);
}

/** Emitted by DomainPicker whenever the local selection (publish intent) changes or reloads. */
export interface DomainSelectionInfo {
	/** Empty selection → share hosting. */
	isShare: boolean;
	primaryHostname: string | null;
	/** Selection differs from what is bound on the server — takes effect on publish. */
	pending: boolean;
	/** Selection has domains that move away from other projects on publish. */
	hasMoves: boolean;
}
