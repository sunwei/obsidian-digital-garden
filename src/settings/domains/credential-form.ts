import { Setting } from 'obsidian';
import type { ObsidianDnsCredentialInput } from '@mdfriday/core';
import type { UiT } from './domain-view';

/** Providers with an automatic-setup adapter in core (Aliyun first: it's the hand-tested one). */
export type AutoDnsProvider = 'aliyun' | 'cloudflare' | 'dnspod';
export const AUTO_DNS_PROVIDERS: readonly AutoDnsProvider[] = ['aliyun', 'cloudflare', 'dnspod'];

export function isAutoDnsProvider(value: string): value is AutoDnsProvider {
	return (AUTO_DNS_PROVIDERS as readonly string[]).includes(value);
}

export function providerLabel(t: UiT, provider: string): string {
	return isAutoDnsProvider(provider) ? t(`domains_provider_${provider}`) : provider;
}

interface FieldSpec {
	key: string;
	labelKey: string;
}

/** Field names match what core's adapters read (`apiToken`, or `accessKeyId` / `accessKeySecret`). */
export function credentialFields(provider: AutoDnsProvider): FieldSpec[] {
	switch (provider) {
		case 'cloudflare':
			return [{ key: 'apiToken', labelKey: 'domains_cred_api_token' }];
		case 'aliyun':
			return [
				{ key: 'accessKeyId', labelKey: 'domains_cred_access_key_id' },
				{ key: 'accessKeySecret', labelKey: 'domains_cred_access_key_secret' },
			];
		case 'dnspod':
			return [
				{ key: 'accessKeyId', labelKey: 'domains_cred_secret_id' },
				{ key: 'accessKeySecret', labelKey: 'domains_cred_secret_key' },
			];
	}
}

/** Typed-in values for a new credential. Lives only in the modal; never logged. */
export interface CredentialDraft {
	label: string;
	values: Record<string, string>;
}

export function emptyDraft(): CredentialDraft {
	return { label: '', values: {} };
}

/** null when a required field is empty. */
export function draftToInput(
	provider: AutoDnsProvider,
	draft: CredentialDraft,
): ObsidianDnsCredentialInput | null {
	const fields: Record<string, string> = {};
	for (const { key } of credentialFields(provider)) {
		const value = (draft.values[key] ?? '').trim();
		if (!value) return null;
		fields[key] = value;
	}
	const label = draft.label.trim();
	return { provider, fields, ...(label ? { label } : {}) };
}

/** Name + provider-specific password inputs + least-privilege hint. */
export function renderCredentialFields(
	container: HTMLElement,
	t: UiT,
	provider: AutoDnsProvider,
	draft: CredentialDraft,
): void {
	new Setting(container).setName(t('domains_credential_label')).addText((text) => {
		text.setPlaceholder(providerLabel(t, provider));
		text.setValue(draft.label);
		text.onChange((v) => {
			draft.label = v;
		});
	});
	for (const { key, labelKey } of credentialFields(provider)) {
		new Setting(container).setName(t(labelKey)).addText((text) => {
			text.inputEl.type = 'password';
			text.inputEl.autocomplete = 'off';
			text.inputEl.spellcheck = false;
			text.setValue(draft.values[key] ?? '');
			text.onChange((v) => {
				draft.values[key] = v;
			});
		});
	}
	container.createEl('p', {
		text: t(`domains_cred_hint_${provider}`),
		cls: 'setting-item-description',
	});
}
