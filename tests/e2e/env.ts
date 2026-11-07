/**
 * Staging endpoints for Garden-owned E2E (no cloudflare repo required at runtime).
 */
export type E2eEnvName = 'staging';

export interface GardenE2eEnv {
	name: E2eEnvName;
	apiBase: string;
	shareBase: string;
	runId: string;
}

const STAGING: Omit<GardenE2eEnv, 'runId'> = {
	name: 'staging',
	apiBase: 'https://api.fsky.top',
	shareBase: 'https://share.fsky.top',
};

export function loadGardenE2eEnv(): GardenE2eEnv {
	const raw = (process.env.MDF_E2E_ENV || process.env.MDFRIDAY_ENV || 'staging').trim();
	if (raw !== 'staging') {
		throw new Error(`Garden E2E currently supports staging only (got ${raw})`);
	}
	const runId =
		process.env.MDF_E2E_RUN_ID?.trim() ||
		`garden-e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	return { ...STAGING, runId };
}

/** Guest TTL is 7 rolling days; allow clock / deploy skew. */
export const SEVEN_DAYS_MS = 7 * 86_400_000;
export const EXPIRY_TOLERANCE_MS = 2 * 3_600_000; // ±2h
