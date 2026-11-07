/**
 * Headless visitor unlock helpers for access format 2.
 * Mirrors theme `families/base/static/access.js` (session → keys → AES-GCM + AAD).
 * No Obsidian UI; used by G2 headless E2E only.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function normalizeAccessKey(raw: string): string {
	return String(raw || '')
		.toUpperCase()
		.replace(/[-\s]/g, '')
		.replace(/O/g, '0')
		.replace(/[IL]/g, '1');
}

function checkChar(body: string): string {
	let sum = 0;
	for (let i = 0; i < body.length; i++) {
		const idx = ALPHABET.indexOf(body[i]!);
		if (idx < 0) return '';
		sum = (sum + idx * (i + 1)) % 32;
	}
	return ALPHABET[sum]!;
}

/** Valid-format key that is extremely unlikely to be issued (for negative cases). */
export function inventWrongAccessKey(): string {
	const body = 'ZZZZZZZZZZZZZZZZ';
	return body + checkChar(body);
}

export interface AccessShellAttrs {
	projectId: string;
	resourceId: string;
	keyId: string;
	encryptedB64: string;
	scope: string;
	apiBase: string;
}

/** Parse `#mdf-encrypt-content` (format 2) attributes from published HTML. */
export function parseAccessShell(html: string, fallbackApiBase: string): AccessShellAttrs {
	const m = html.match(/id=["']mdf-encrypt-content["'][^>]*>/i) || html.match(/data-format=["']2["'][^>]*>/i);
	const tag = m?.[0] ?? html;
	const attr = (name: string): string => {
		const re = new RegExp(`${name}=["']([^"']+)["']`, 'i');
		return re.exec(tag)?.[1] ?? '';
	};
	// Prefer the encrypt-content element block when present.
	const block =
		/id=["']mdf-encrypt-content["'][\s\S]*?(?=\/>|>)/i.exec(html)?.[0] ??
		/data-format=["']2["'][\s\S]*?(?=\/>|>)/i.exec(html)?.[0] ??
		tag;
	const get = (name: string): string => {
		const re = new RegExp(`${name}=["']([^"']+)["']`, 'i');
		return re.exec(block)?.[1] ?? attr(name);
	};
	const projectId = get('data-project');
	const resourceId = get('data-resource');
	const keyId = get('data-key');
	const encryptedB64 = get('data-encrypted');
	const scope = get('data-scope') || 'site';
	const apiFromPage = get('data-api');
	if (!projectId || !resourceId || !keyId || !encryptedB64) {
		throw new Error(
			`access shell incomplete: project=${projectId} resource=${resourceId} key=${keyId} enc=${encryptedB64 ? 'yes' : 'no'}`,
		);
	}
	return {
		projectId,
		resourceId,
		keyId,
		encryptedB64,
		scope,
		apiBase: (apiFromPage || fallbackApiBase).replace(/\/$/, ''),
	};
}

function b64ToBytes(b64: string): Uint8Array {
	return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/** AES-256-GCM format 2 decrypt — same AAD as theme access.js. */
export async function decryptAccessV2(
	cekB64: string,
	encryptedB64: string,
	projectId: string,
	resourceId: string,
	keyId: string,
): Promise<string> {
	const cek = b64ToBytes(cekB64);
	const raw = b64ToBytes(encryptedB64);
	const iv = raw.slice(0, 12);
	const ct = raw.slice(12);
	const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
	const aad = new TextEncoder().encode(`mdf2|${projectId}|${resourceId}|${keyId}`);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
	return new TextDecoder().decode(plain);
}

export async function createAccessSession(
	apiBase: string,
	projectId: string,
	secrets: string[],
): Promise<{ token?: string; rejected?: { reason?: string }[]; expiresAt?: number }> {
	const res = await fetch(`${apiBase.replace(/\/$/, '')}/v1/public/access/session`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ projectId, secrets }),
	});
	const text = await res.text();
	let body: { token?: string; rejected?: { reason?: string }[]; expiresAt?: number };
	try {
		body = JSON.parse(text) as typeof body;
	} catch {
		throw new Error(`access/session ${res.status}: ${text.slice(0, 200)}`);
	}
	if (!res.ok) throw new Error(`access/session ${res.status}: ${text.slice(0, 300)}`);
	return body;
}

export async function fetchAccessKeys(
	apiBase: string,
	sessionToken: string,
	items: { resourceId: string; keyId: string }[],
): Promise<{
	keys: { keyId: string; cek: string; resourceId?: string }[];
	denied: { resourceId: string; reason: string }[];
}> {
	const res = await fetch(`${apiBase.replace(/\/$/, '')}/v1/public/access/keys`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({ items }),
	});
	const text = await res.text();
	let body: {
		keys?: { keyId: string; cek: string; resourceId?: string }[];
		denied?: { resourceId: string; reason: string }[];
	};
	try {
		body = JSON.parse(text) as typeof body;
	} catch {
		throw new Error(`access/keys ${res.status}: ${text.slice(0, 200)}`);
	}
	if (!res.ok) throw new Error(`access/keys ${res.status}: ${text.slice(0, 300)}`);
	return { keys: body.keys ?? [], denied: body.denied ?? [] };
}

/** Full unlock: session → CEK → plaintext HTML fragment. */
export async function unlockPublishedPage(
	apiBase: string,
	html: string,
	secret: string,
): Promise<{ plainHtml: string; shell: AccessShellAttrs }> {
	const shell = parseAccessShell(html, apiBase);
	const session = await createAccessSession(shell.apiBase, shell.projectId, [
		normalizeAccessKey(secret),
	]);
	if (!session.token) {
		const reason = session.rejected?.[0]?.reason || 'no_token';
		throw new Error(`access session rejected: ${reason}`);
	}
	const keys = await fetchAccessKeys(shell.apiBase, session.token, [
		{ resourceId: shell.resourceId, keyId: shell.keyId },
	]);
	const hit = keys.keys[0];
	if (!hit?.cek) {
		const denied = keys.denied[0];
		throw new Error(`access keys denied: ${denied?.reason ?? 'no_cek'} resource=${shell.resourceId}`);
	}
	const plainHtml = await decryptAccessV2(
		hit.cek,
		shell.encryptedB64,
		shell.projectId,
		shell.resourceId,
		shell.keyId,
	);
	return { plainHtml, shell };
}
