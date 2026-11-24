/** Minimal project shape for Settings ▸ Projects list filtering. */
export type SettingsProjectFilterInput = {
	kind?: string | null;
	status?: string | null;
	workspaceId?: string | null;
};

const HIDDEN_STATUSES = new Set(['deleted']);

/**
 * Settings list: Garden folder sites for this vault only.
 * Share notes (`kind: note`) and other-vault folders are excluded.
 * Legacy rows with empty workspaceId stay visible until claimed (same as PublishPanel).
 */
export function isGardenSettingsProject(
	project: SettingsProjectFilterInput,
	vaultWorkspaceId: string,
): boolean {
	if (project.status && HIDDEN_STATUSES.has(project.status)) return false;
	if (project.kind !== 'folder') return false;
	const rowWs =
		typeof project.workspaceId === 'string' && project.workspaceId.trim()
			? project.workspaceId.trim()
			: '';
	if (rowWs && rowWs !== vaultWorkspaceId) return false;
	return true;
}
