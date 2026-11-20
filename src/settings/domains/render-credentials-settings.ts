import { Notice, Setting, type SettingDefinitionItem } from 'obsidian';
import type { ObsidianDnsCredentialSummary } from '@mdfriday/core';
import type FridayPlugin from '../../main';
import { AddCredentialModal } from './add-credential-modal';
import { confirmModal } from './confirm-modal';
import { providerLabel } from './credential-form';
import { uiT } from './domain-view';

/** Single Domains-group item (merged with the domains list under one section heading). */
export function getDnsCredentialsSettingItem(plugin: FridayPlugin): SettingDefinitionItem {
	const t = uiT(plugin);
	return {
		name: t('domains_credentials_heading'),
		desc: t('domains_credentials_desc'),
		aliases: ['dns', 'credential', 'access key', 'api token', 'aliyun', 'cloudflare', 'dnspod'],
		render: (setting) => renderCredentialRows(plugin, setting),
	};
}

/** @deprecated Prefer Domains group via {@link getDnsCredentialsSettingItem}. */
export function getDnsCredentialsSettingDefinitions(plugin: FridayPlugin): SettingDefinitionItem[] {
	const t = uiT(plugin);
	return [
		{
			type: 'group',
			heading: t('domains_credentials_heading'),
			cls: 'mdfriday-dns-credentials-group',
			items: [getDnsCredentialsSettingItem(plugin)],
		},
	];
}

function renderCredentialRows(plugin: FridayPlugin, setting: Setting): () => void {
	const t = uiT(plugin);
	let disposed = false;
	setting.settingEl.addClass('mdfriday-setting-with-list');
	const listEl = setting.settingEl.createDiv({ cls: 'mdfriday-dns-credentials-list' });

	setting.addButton((btn) => {
		btn.setButtonText(t('domains_credentials_add'));
		btn.onClick(() => {
			new AddCredentialModal(plugin.app, plugin, () => void load()).open();
		});
	});

	async function load(): Promise<void> {
		const service = plugin.foundryCustomDomainService;
		if (!service) return;
		const res = await service.listCredentials();
		if (disposed) return;
		listEl.empty();
		const items = res.success && res.data ? res.data : [];
		if (items.length === 0) {
			listEl.createDiv({
				text: t('domains_credentials_empty'),
				cls: 'setting-item-description mdfriday-settings-list-empty',
			});
			return;
		}
		for (const item of items) renderRow(item);
	}

	function renderRow(item: ObsidianDnsCredentialSummary): void {
		const name = item.label || providerLabel(t, item.provider);
		const date = new Date(item.createdAt).toLocaleDateString();
		const row = new Setting(listEl)
			.setName(name)
			.setDesc(`${providerLabel(t, item.provider)} · ${date}`);
		row.addExtraButton((btn) => {
			btn.setIcon('trash').setTooltip(t('domains_credentials_delete'));
			btn.onClick(async () => {
				const ok = await confirmModal(plugin.app, {
					title: t('domains_credentials_delete_title', { label: name }),
					message: t('domains_credentials_delete_desc'),
					confirmText: t('domains_credentials_delete'),
					cancelText: t('domains_cancel'),
					warning: true,
				});
				if (!ok) return;
				const service = plugin.foundryCustomDomainService;
				if (!service) return;
				const res = await service.removeCredential(item.id);
				if (!res.success) {
					new Notice(t('domains_action_failed', { error: res.error || 'unknown' }), 5000);
					return;
				}
				new Notice(t('domains_credentials_deleted'), 3000);
				await load();
			});
		});
	}

	void load();

	return () => {
		disposed = true;
		listEl.remove();
	};
}
