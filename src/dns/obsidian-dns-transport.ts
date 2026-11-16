import { requestUrl } from 'obsidian';

// Structural copies of core's DnsTransport types (core's emitted .d.ts keeps `@internal/*`
// aliases that don't resolve for consumers, so importing them would degrade to `any`).
interface DnsTransportRequest {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string;
}

interface DnsTransportResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

interface DnsTransport {
	request(req: DnsTransportRequest): Promise<DnsTransportResponse>;
}

/**
 * DNS provider HTTP over Obsidian `requestUrl` (no CORS). Used by core's DNS adapters.
 * Deliberately silent: requests carry credentials / signatures, so nothing is logged here.
 * `throw: false` hands 4xx/5xx back to the adapters, which map them to domain errors.
 */
export class ObsidianDnsTransport implements DnsTransport {
	async request(req: DnsTransportRequest): Promise<DnsTransportResponse> {
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers ?? {})) {
			const lower = k.toLowerCase();
			// Electron rejects explicit Host / Content-Length (net::ERR_INVALID_ARGUMENT).
			if (lower === 'host' || lower === 'content-length') continue;
			headers[k] = v;
		}
		const res = await requestUrl({
			url: req.url,
			method: req.method,
			headers,
			...(req.body !== undefined ? { body: req.body } : {}),
			throw: false,
		});
		return { status: res.status, headers: res.headers, text: res.text };
	}
}
