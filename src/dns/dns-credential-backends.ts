// Structural copies of core's SecretBackend / IndexBackend (see obsidian-dns-transport.ts for why).
interface SecretBackend {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

interface IndexBackend {
	load(): Promise<DnsCredentialIndexEntry[]>;
	save(index: DnsCredentialIndexEntry[]): Promise<void>;
}

/** Index entry: summary only, never any secret field. */
export interface DnsCredentialIndexEntry {
	id: string;
	provider: 'cloudflare' | 'aliyun' | 'dnspod' | 'godaddy';
	label: string;
	createdAt: number;
}

/** The slice of plugin state the DNS credential backends need. */
export interface DnsCredentialHost {
	settings: {
		dnsCredentialIndex: DnsCredentialIndexEntry[];
		/** key (`dns-cred-<id>`) → JSON `{ fields }`. Plain text inside data.json (see arch/custom-domain/04 §5). */
		dnsCredentialSecrets: Record<string, string>;
	};
	saveSettings(): Promise<void>;
}

/**
 * core `SecretBackend` / `IndexBackend` on top of the plugin's data.json.
 * data.json lives in the vault and may sync (Obsidian Sync / iCloud / git); the UI says so.
 */
export function createDnsCredentialBackends(host: DnsCredentialHost): {
	secretBackend: SecretBackend;
	indexBackend: IndexBackend;
} {
	const secretBackend: SecretBackend = {
		get: async (key) => host.settings.dnsCredentialSecrets[key] ?? null,
		set: async (key, value) => {
			host.settings.dnsCredentialSecrets = { ...host.settings.dnsCredentialSecrets, [key]: value };
			await host.saveSettings();
		},
		delete: async (key) => {
			const next = { ...host.settings.dnsCredentialSecrets };
			delete next[key];
			host.settings.dnsCredentialSecrets = next;
			await host.saveSettings();
		},
	};
	const indexBackend: IndexBackend = {
		load: async () => host.settings.dnsCredentialIndex.map((e) => ({ ...e })),
		save: async (index) => {
			host.settings.dnsCredentialIndex = index.map((e) => ({ ...e }));
			await host.saveSettings();
		},
	};
	return { secretBackend, indexBackend };
}
