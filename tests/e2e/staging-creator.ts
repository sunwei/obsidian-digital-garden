/**
 * Staging creator bootstrap for Garden access E2E (Dashboard + plugin publish).
 *
 * Same pattern as Cloudflare E2E-10 / test-kit `bootstrapUser` + `createKey`:
 * insert a real users row in staging D1, mint a user JWT with JWT_SECRET from
 * `cloudflare/.staging.vars`, then POST /v1/keys for an MDF_ plugin key.
 *
 * Never logs secrets. Requires sibling `../cloudflare` with wrangler auth
 * (`wrangler login` on this Mac, or CLOUDFLARE_API_TOKEN with D1 Edit).
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '../..', '..');
const CF_ROOT = path.resolve(WORKSPACE, 'cloudflare');

export interface StagingCreator {
	userId: string;
	email: string;
	/** User JWT — Dashboard session + creator Access API */
	token: string;
	/** MDF_ key — GardenPluginDriver publish */
	mdfKey: string;
	apiBase: string;
	siteBaseUrl: string;
	cfRoot: string;
	accountId: string;
}

function parseEnvFile(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i < 0) continue;
		const k = t.slice(0, i).trim();
		let v = t.slice(i + 1).trim();
		if (
			(v.startsWith('"') && v.endsWith('"')) ||
			(v.startsWith("'") && v.endsWith("'"))
		) {
			v = v.slice(1, -1);
		}
		out[k] = v;
	}
	return out;
}

function loadStagingVars(): Record<string, string> {
	const p = path.join(CF_ROOT, '.staging.vars');
	if (!existsSync(p)) {
		throw new Error(
			`Missing ${p}. Required for staging creator mint (JWT_SECRET, CLOUDFLARE_ACCOUNT_ID). Same file Cloudflare E2E / theme:release use.`,
		);
	}
	return parseEnvFile(readFileSync(p, 'utf8'));
}

function b64url(data: Buffer | string): string {
	const buf = typeof data === 'string' ? Buffer.from(data) : data;
	return buf.toString('base64url');
}

function signJwt(payload: { sub: string; plan: string }, secret: string, ttlSeconds = 7 * 24 * 3600): string {
	const header = { alg: 'HS256', typ: 'JWT' };
	const iat = Math.floor(Date.now() / 1000);
	const body = { sub: payload.sub, plan: payload.plan, iat, exp: iat + ttlSeconds };
	const h = b64url(JSON.stringify(header));
	const p = b64url(JSON.stringify(body));
	const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
	return `${h}.${p}.${sig}`;
}

function sqlStr(v: string): string {
	return `'${v.replace(/'/g, "''")}'`;
}

function wranglerEnv(accountId: string): NodeJS.ProcessEnv {
	const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
	// CF_API_TOKEN is a Worker runtime secret; if leaked into CLI auth it can lack D1 Edit.
	delete env.CF_API_TOKEN;
	return env;
}

function d1Execute(accountId: string, sql: string): void {
	const cfg = path.join(CF_ROOT, 'workers/api/wrangler.toml');
	const r = spawnSync(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			'mdfriday-staging',
			'--remote',
			'--env',
			'staging',
			'-c',
			cfg,
			'--command',
			sql,
		],
		{
			cwd: CF_ROOT,
			encoding: 'utf8',
			env: wranglerEnv(accountId),
			maxBuffer: 10 * 1024 * 1024,
		},
	);
	if (r.status !== 0) {
		const out = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '').trim();
		throw new Error(
			`wrangler d1 execute failed (exit ${r.status}). Need \`wrangler login\` on this Mac or CLOUDFLARE_API_TOKEN with D1 Edit. Detail: ${out.slice(0, 500)}`,
		);
	}
}

export function stagingCreatorPrereqs(): { ok: boolean; missing: string[] } {
	const missing: string[] = [];
	if (!existsSync(CF_ROOT)) missing.push(`sibling cloudflare repo at ${CF_ROOT}`);
	const varsPath = path.join(CF_ROOT, '.staging.vars');
	if (!existsSync(varsPath)) missing.push(`cloudflare/.staging.vars (JWT_SECRET, CLOUDFLARE_ACCOUNT_ID)`);
	else {
		const v = parseEnvFile(readFileSync(varsPath, 'utf8'));
		if (!v.JWT_SECRET) missing.push('JWT_SECRET in cloudflare/.staging.vars');
		if (!v.CLOUDFLARE_ACCOUNT_ID) missing.push('CLOUDFLARE_ACCOUNT_ID in cloudflare/.staging.vars');
	}
	if (!existsSync(path.join(CF_ROOT, 'node_modules/.bin/wrangler'))) {
		missing.push('cloudflare/node_modules wrangler (npm install in cloudflare/)');
	}
	return { ok: missing.length === 0, missing };
}

/** Create a disposable staging creator (user JWT + MDF_ key). */
export async function createStagingCreator(label: string, runId: string): Promise<StagingCreator> {
	const pre = stagingCreatorPrereqs();
	if (!pre.ok) {
		throw new Error(
			`Cannot mint staging creator. Missing:\n- ${pre.missing.join('\n- ')}\n` +
				`Same prerequisites as Cloudflare \`npm run e2e:access\` (E2E-10).`,
		);
	}
	const vars = loadStagingVars();
	const accountId = vars.CLOUDFLARE_ACCOUNT_ID;
	const jwtSecret = vars.JWT_SECRET;
	const apiBase = (vars.API_BASE_URL || `https://${vars.API_HOST || 'api.fsky.top'}`).replace(/\/$/, '');
	const siteBaseUrl = `https://${vars.WWW_HOST || 'fsky.top'}`;

	const userId = `usr_e2e_garden_${label}_${runId}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
	const email = `e2e-garden-${label}-${runId}@mdfriday.test`;
	const t = Date.now();

	d1Execute(
		accountId,
		`INSERT OR REPLACE INTO users (id, email, display_name, plan, storage_bytes, status, created_at, updated_at)
     VALUES (${sqlStr(userId)}, ${sqlStr(email)}, ${sqlStr(`Garden E2E ${label}`)}, 'free', 0, 'active', ${t}, ${t})`,
	);

	const token = signJwt({ sub: userId, plan: 'free' }, jwtSecret);

	const keyRes = await fetch(`${apiBase}/v1/keys`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'X-MDFriday-Client': 'obsidian-garden/e2e',
		},
		body: JSON.stringify({ client: 'obsidian-garden' }),
	});
	const keyText = await keyRes.text();
	let keyBody: { key?: string; id?: string };
	try {
		keyBody = JSON.parse(keyText) as typeof keyBody;
	} catch {
		throw new Error(`POST /v1/keys ${keyRes.status}: ${keyText.slice(0, 200)}`);
	}
	if (!keyRes.ok || !keyBody.key) {
		throw new Error(`POST /v1/keys ${keyRes.status}: ${keyText.slice(0, 300)}`);
	}

	return {
		userId,
		email,
		token,
		mdfKey: keyBody.key,
		apiBase,
		siteBaseUrl,
		cfRoot: CF_ROOT,
		accountId,
	};
}

/** Best-effort cleanup: delete staging project (API) and remove the e2e user row (D1). */
export async function cleanupStagingCreator(
	creator: StagingCreator,
	opts: { projectId?: string; clientHeader?: string; keepData?: boolean },
): Promise<void> {
	if (opts.keepData) return;
	if (opts.projectId) {
		try {
			await fetch(`${creator.apiBase}/v1/projects/${opts.projectId}`, {
				method: 'DELETE',
				headers: {
					authorization: `Bearer ${creator.mdfKey}`,
					'X-MDFriday-Client': opts.clientHeader || 'obsidian-garden/e2e',
				},
			});
		} catch {
			/* ignore */
		}
	}
	try {
		// Best-effort: keys/projects may leave FK rows; orphan usr_e2e_* rows are swept by CF e2e.
		d1Execute(
			creator.accountId,
			`DELETE FROM api_keys WHERE user_id = ${sqlStr(creator.userId)}; DELETE FROM users WHERE id = ${sqlStr(creator.userId)}`,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg)) {
			console.warn('cleanup staging user row skipped (FK leftovers; ok for staging e2e)');
		} else {
			console.warn('cleanup staging user row failed', msg.slice(0, 200));
		}
	}
}
