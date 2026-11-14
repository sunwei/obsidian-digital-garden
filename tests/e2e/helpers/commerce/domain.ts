/**
 * Custom-domain bind for Garden G6 (Aliyun DNS + CF SaaS custom hostname).
 * Mirrors cloudflare E2E-12 bindCustomHostname; DNS helpers imported from sibling test-kit.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	deleteAliyunDnsRecord,
	describeDomainRecords,
	pingAliyunDns,
	upsertAliyunDnsRecord,
	type AliyunDnsConfig,
} from '../../../../../cloudflare/packages/test-kit/src/aliyun-dns.ts';
import {
	deleteCustomHostname,
	waitForCname,
	waitForTxt,
} from '../../../../../cloudflare/packages/test-kit/src/dns.ts';
import type { CommerceApi } from './api.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CF_ROOT = path.resolve(HERE, '../../../../..', 'cloudflare');

function parseEnvFile(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i < 0) continue;
		const k = t.slice(0, i).trim();
		let v = t.slice(i + 1).trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1);
		}
		out[k] = v;
	}
	return out;
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function poll<T>(
	fn: () => Promise<T | null>,
	opts: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
	const deadline = Date.now() + opts.timeoutMs;
	let lastErr: unknown;
	while (Date.now() < deadline) {
		try {
			const v = await fn();
			if (v) return v;
		} catch (e) {
			lastErr = e;
		}
		await sleep(opts.intervalMs);
	}
	throw new Error(
		`poll timeout (${opts.timeoutMs}ms) waiting for ${opts.label}${lastErr ? `: ${lastErr}` : ''}`,
	);
}

export type DomainE2eConfig = {
	aliyun: AliyunDnsConfig;
	hostname: string;
	cnameTarget: string;
	saasZoneId: string;
	cfToken: string;
	apiBase: string;
};

export type BoundDomain = {
	hostname: string;
	publicBaseUrl: string;
	domainId: string;
	cfCustomHostnameId: string;
	aliyunRecordIds: string[];
	certCa: string | null;
	certWaitSeconds: number;
};

type CfCustomHostname = {
	result?: {
		id?: string;
		status?: string;
		hostname?: string;
		ownership_verification?: { type?: string; name?: string; value?: string };
		ssl?: {
			status?: string;
			certificate_authority?: string;
			txt_name?: string;
			txt_value?: string;
			validation_records?: Array<{ txt_name?: string; txt_value?: string }>;
			dcv_delegation_records?: Array<{ cname?: string; cname_target?: string }>;
		};
	};
};

export function domainPrereqs(): { ok: boolean; missing: string[] } {
	if (process.env.E2E_COMMERCE_DOMAIN !== '1') {
		return { ok: false, missing: ['E2E_COMMERCE_DOMAIN=1'] };
	}
	try {
		loadDomainE2eConfig('probe');
		return { ok: true, missing: [] };
	} catch (e) {
		return { ok: false, missing: [e instanceof Error ? e.message : String(e)] };
	}
}

export function loadDomainE2eConfig(runId: string): DomainE2eConfig {
	const varsPath = path.join(CF_ROOT, '.staging.vars');
	if (!existsSync(varsPath)) throw new Error(`Missing ${varsPath} for domain E2E`);
	const file = parseEnvFile(readFileSync(varsPath, 'utf8'));
	const cfg = { ...file, ...process.env } as Record<string, string>;

	const accessKeyId = cfg.ALIYUN_ACCESS_KEY_ID || '';
	const accessKeySecret = cfg.ALIYUN_ACCESS_KEY_SECRET || '';
	const domainName = cfg.E2E_EXTERNAL_DOMAIN || '';
	const enabled =
		cfg.E2E_EXTERNAL_ENABLED === '1' ||
		cfg.E2E_EXTERNAL_ENABLED === 'true' ||
		Boolean(accessKeyId && domainName);
	if (!enabled || !accessKeyId || !accessKeySecret || !domainName) {
		throw new Error(
			'Domain E2E needs ALIYUN_ACCESS_KEY_ID/SECRET and E2E_EXTERNAL_DOMAIN in cloudflare/.staging.vars',
		);
	}
	const saasZoneId = cfg.SAAS_ZONE_ID || '';
	const cfToken = cfg.CLOUDFLARE_API_TOKEN || cfg.CF_API_TOKEN || '';
	if (!saasZoneId || !cfToken) {
		throw new Error('Domain E2E needs SAAS_ZONE_ID and CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)');
	}
	const cnameTarget = cfg.CNAME_TARGET || `cname.${cfg.SAAS_ZONE || 'sure40.com'}`;
	const hostPrefix = cfg.E2E_HOST_PREFIX || 'e2e';
	const safeRun =
		runId.replace(/[^a-zA-Z0-9]/g, '').slice(-16) || Date.now().toString(36);
	const label = (process.env.E2E_DOMAIN_LABEL || 'g6').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'g6';
	const hostname = `${hostPrefix}-${label}-${safeRun}.${domainName}`.toLowerCase();
	const apiBase = (cfg.API_BASE_URL || `https://${cfg.API_HOST || 'api.fsky.top'}`).replace(/\/$/, '');

	return {
		aliyun: { accessKeyId, accessKeySecret, domainName },
		hostname,
		cnameTarget,
		saasZoneId,
		cfToken,
		apiBase,
	};
}

async function fetchCustomHostname(
	saasZoneId: string,
	token: string,
	hostnameId: string,
): Promise<CfCustomHostname> {
	const ch = await fetch(
		`https://api.cloudflare.com/client/v4/zones/${saasZoneId}/custom_hostnames/${hostnameId}`,
		{ headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
	);
	return (await ch.json()) as CfCustomHostname;
}

/**
 * Bind throwaway hostname: ownership TXT + CNAME → verify → SSL DCV → sync-cert active.
 */
export async function bindE2eHostname(
	api: CommerceApi,
	token: string,
	projectId: string,
	cfg: DomainE2eConfig,
): Promise<BoundDomain> {
	await pingAliyunDns(cfg.aliyun);
	const aliyunRecordIds: string[] = [];

	const added = await api<{
		id: string;
		hostname: string;
		txtName: string;
		txtValue: string;
		cnameTarget: string;
	}>('POST', `/v1/projects/${projectId}/domains`, {
		token,
		body: { hostname: cfg.hostname },
		ok: [200, 201],
	});
	const domainId = added.body.id;

	aliyunRecordIds.push(
		await upsertAliyunDnsRecord(cfg.aliyun, {
			fqdn: added.body.txtName,
			type: 'TXT',
			content: added.body.txtValue,
			ttl: 600,
		}),
	);
	aliyunRecordIds.push(
		await upsertAliyunDnsRecord(cfg.aliyun, {
			fqdn: cfg.hostname,
			type: 'CNAME',
			content: cfg.cnameTarget,
			ttl: 600,
		}),
	);
	console.log(
		JSON.stringify({
			event: 'g6.dns.upserted',
			hostname: cfg.hostname,
			txt: added.body.txtName,
			cnameTarget: cfg.cnameTarget,
		}),
	);

	await waitForTxt(added.body.txtName, added.body.txtValue, 300_000);
	await waitForCname(cfg.hostname, cfg.cnameTarget, 180_000);
	await api('POST', `/v1/domains/${domainId}/verify`, { token, ok: [200, 201] });

	await fetch(
		`https://api.cloudflare.com/client/v4/zones/${cfg.saasZoneId}/custom_hostnames/fallback_origin`,
		{
			method: 'PUT',
			headers: {
				authorization: `Bearer ${cfg.cfToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ origin: cfg.cnameTarget }),
		},
	).catch(() => null);

	const domainList = await api<{
		domains: Array<{ id: string; cf_custom_hostname_id?: string }>;
	}>('GET', `/v1/projects/${projectId}/domains`, { token });
	const cfCustomHostnameId = domainList.body.domains?.find((d) => d.id === domainId)
		?.cf_custom_hostname_id;
	if (!cfCustomHostnameId) {
		throw new Error('cf_custom_hostname_id missing after verify — check CF_API_TOKEN on Worker');
	}
	const createdAt = Date.now();

	const chDetail = await poll(
		async () => {
			const json = await fetchCustomHostname(cfg.saasZoneId, cfg.cfToken, cfCustomHostnameId);
			const ssl = json.result?.ssl;
			const hasTxt = Boolean(ssl?.txt_name || ssl?.validation_records?.[0]?.txt_name);
			const hasDcv = Boolean(ssl?.dcv_delegation_records?.[0]?.cname);
			if (hasTxt || hasDcv) return json;
			return null;
		},
		{ timeoutMs: 180_000, intervalMs: 5_000, label: 'CF custom hostname SSL records' },
	);

	const ov = chDetail.result?.ownership_verification;
	if (ov?.type === 'txt' && ov.name && ov.value) {
		aliyunRecordIds.push(
			await upsertAliyunDnsRecord(cfg.aliyun, {
				fqdn: ov.name,
				type: 'TXT',
				content: ov.value,
				ttl: 600,
			}),
		);
		await waitForTxt(ov.name, ov.value, 180_000);
	}

	const ssl = chDetail.result?.ssl ?? {};
	const dcv = ssl.dcv_delegation_records?.[0];
	const sslTxtName = ssl.txt_name ?? ssl.validation_records?.[0]?.txt_name;
	const sslTxtValue = ssl.txt_value ?? ssl.validation_records?.[0]?.txt_value;
	if (dcv?.cname && dcv?.cname_target) {
		const target = dcv.cname_target.replace(/\.$/, '');
		const id = await upsertAliyunDnsRecord(cfg.aliyun, {
			fqdn: dcv.cname,
			type: 'CNAME',
			content: target,
			ttl: 600,
		});
		aliyunRecordIds.push(id);
		console.log(JSON.stringify({ event: 'g6.dns.dcv', cname: dcv.cname, target, recordId: id }));
		await waitForCname(dcv.cname, target, 180_000);
	} else if (sslTxtName && sslTxtValue) {
		const id = await upsertAliyunDnsRecord(cfg.aliyun, {
			fqdn: sslTxtName,
			type: 'TXT',
			content: sslTxtValue,
			ttl: 600,
		});
		aliyunRecordIds.push(id);
		console.log(JSON.stringify({ event: 'g6.dns.acme_txt', sslTxtName, recordId: id }));
		await waitForTxt(sslTxtName, sslTxtValue, 180_000);
	} else {
		throw new Error(`No SSL TXT or DCV CNAME from CF: ${JSON.stringify(ssl)}`);
	}

	await poll(
		async () => {
			const sync = await api<{ activated?: boolean; status?: string }>(
				'POST',
				`/v1/domains/${domainId}/sync-cert`,
				{ token, ok: [200, 201] },
			);
			return sync.body.activated ? sync.body : null;
		},
		{ timeoutMs: 600_000, intervalMs: 10_000, label: 'external domain cert active' },
	).catch(async (e) => {
		const cur = (await fetchCustomHostname(cfg.saasZoneId, cfg.cfToken, cfCustomHostnameId).catch(
			() => ({}),
		)) as CfCustomHostname;
		const s2 = cur.result?.ssl ?? {};
		throw new Error(
			`${e instanceof Error ? e.message : e} (ca=${s2.certificate_authority} ssl=${s2.status} hostname=${cur.result?.status})`,
		);
	});

	const cur = await fetchCustomHostname(cfg.saasZoneId, cfg.cfToken, cfCustomHostnameId);
	const certCa = cur.result?.ssl?.certificate_authority ?? null;
	const certWaitSeconds = Math.round((Date.now() - createdAt) / 1000);
	console.log(
		JSON.stringify({
			event: 'g6.cert.active',
			ca: certCa,
			waitSeconds: certWaitSeconds,
			hostname: cfg.hostname,
		}),
	);

	return {
		hostname: cfg.hostname,
		publicBaseUrl: `https://${cfg.hostname}/`,
		domainId,
		cfCustomHostnameId,
		aliyunRecordIds,
		certCa,
		certWaitSeconds,
	};
}

/** Best-effort: delete CF custom hostname, API domain, and Aliyun records for this bind. */
export async function cleanupBoundDomain(
	api: CommerceApi,
	token: string,
	bound: BoundDomain | undefined,
	cfg: DomainE2eConfig | undefined,
	opts: { keepData?: boolean } = {},
): Promise<void> {
	if (!bound || !cfg || opts.keepData) return;

	try {
		await deleteCustomHostname(
			{ apiToken: cfg.cfToken, zoneId: cfg.saasZoneId, saasZoneId: cfg.saasZoneId },
			bound.cfCustomHostnameId,
		);
	} catch (e) {
		console.warn('cleanup CF custom hostname', e instanceof Error ? e.message.slice(0, 120) : e);
	}

	try {
		await api('DELETE', `/v1/domains/${bound.domainId}`, { token, ok: [200, 204] });
	} catch (e) {
		console.warn('cleanup API domain', e instanceof Error ? e.message.slice(0, 120) : e);
	}

	for (const id of bound.aliyunRecordIds) {
		try {
			await deleteAliyunDnsRecord(cfg.aliyun, id);
		} catch {
			/* ignore */
		}
	}

	// Sweep leftover RR matching hostname leaf
	try {
		const host = bound.hostname.replace(`.${cfg.aliyun.domainName}`, '');
		const rows = await describeDomainRecords(cfg.aliyun, { rrKeyWord: host, pageSize: 100 });
		for (const row of rows) {
			if (row.RR === host || row.RR.startsWith(`${host}.`) || row.RR.endsWith(`.${host}`)) {
				await deleteAliyunDnsRecord(cfg.aliyun, row.RecordId);
			}
		}
	} catch {
		/* ignore */
	}
}
