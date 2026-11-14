import type { CommerceApi } from './api.ts';
import { sanitizeLog } from './sanitize.ts';

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export type OfferPrice = {
	id: string;
	billing: string;
	interval?: string | null;
	listings?: { syncStatus: string; lastError: string | null; providerProductRef?: string | null }[];
};

export type OfferBody = {
	id: string;
	name: string;
	status: string;
	sellable?: boolean;
	prices: OfferPrice[];
};

export type ConnectionBody = {
	id: string;
	provider: string;
	mode: string;
	status: string;
	merchantName?: string | null;
	webhook?: { mode?: string; url?: string };
};

export async function syncOffer(
	api: CommerceApi,
	token: string,
	projectId: string,
	offerId: string,
	attempts = 6,
): Promise<OfferBody> {
	let last = '';
	for (let i = 0; i < attempts; i++) {
		const res = await api<OfferBody>('POST', `/v1/projects/${projectId}/offers/${offerId}/sync`, {
			token,
		});
		last = res.text;
		const pending = res.body.prices.some((p) =>
			(p.listings ?? []).some(
				(l) => l.syncStatus !== 'synced' && (l.lastError ?? '').includes('Too Many Requests'),
			),
		);
		const allSynced = res.body.prices.every((p) =>
			(p.listings ?? []).every((l) => l.syncStatus === 'synced'),
		);
		if (allSynced) return res.body;
		if (!pending) {
			if (!allSynced) throw new Error(`offer sync incomplete: ${sanitizeLog(last).slice(0, 500)}`);
			return res.body;
		}
		await sleep(2000 * (i + 1));
	}
	throw new Error(`offer sync did not complete: ${sanitizeLog(last).slice(0, 500)}`);
}

export async function putCommerceSettings(
	api: CommerceApi,
	token: string,
	projectId: string,
	opts: { contactEmail: string; senderName: string },
): Promise<void> {
	await api('PUT', `/v1/projects/${projectId}/commerce/settings`, {
		token,
		body: { contactEmail: opts.contactEmail, senderName: opts.senderName },
	});
}

export async function ensureCreemTestConnection(
	api: CommerceApi,
	token: string,
	creemApiKey: string,
): Promise<ConnectionBody> {
	const listed = await api<{ connections: ConnectionBody[] }>('GET', '/v1/commerce/connections', {
		token,
	});
	let connection = listed.body.connections.find(
		(c) => c.provider === 'creem' && c.mode === 'test' && c.status === 'active',
	);
	if (!connection) {
		const connected = await api<{
			connection: ConnectionBody;
			webhook: { mode: string; url: string };
		}>('POST', '/v1/commerce/connections', {
			token,
			body: { provider: 'creem', mode: 'test', apiKey: creemApiKey },
			ok: [201],
		});
		connection = { ...connected.body.connection, webhook: connected.body.webhook };
	}
	return connection;
}

export async function createSyncedDocsOffer(
	api: CommerceApi,
	token: string,
	projectId: string,
	opts: { name: string; summary?: string; amountMinor?: number },
): Promise<OfferBody> {
	const created = await api<OfferBody>('POST', `/v1/projects/${projectId}/offers`, {
		token,
		body: {
			name: opts.name,
			summary: opts.summary ?? opts.name,
			grants: [{ scope: 'docs' }],
			prices: [
				{
					billing: 'one_time',
					amount: { amountMinor: opts.amountMinor ?? 200, currency: 'USD' },
				},
			],
		},
		ok: [201],
	});
	return syncOffer(api, token, projectId, created.body.id);
}
