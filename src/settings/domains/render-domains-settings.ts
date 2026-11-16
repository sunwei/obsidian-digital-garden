import { Menu, Notice, Setting, type ButtonComponent, type SettingDefinitionItem } from 'obsidian';
import type { ObsidianCustomDomain } from '@mdfriday/core';
import type FridayPlugin from '../../main';
import { getDnsCredentialsSettingItem } from './render-credentials-settings';
import { AddDomainModal } from './add-domain-modal';
import { confirmModal } from './confirm-modal';
import {
	canUseCustomDomains,
	domainStatusLine,
	notifyDomainsChanged,
	uiT,
	type UiT,
} from './domain-view';

/**
 * Settings ▸ Domains group: account domains + DNS credentials (one section).
 * Lists render inside each setting-item so Obsidian's declarative settings UI keeps them.
 */
export function getDomainsSettingDefinitions(plugin: FridayPlugin): SettingDefinitionItem[] {
	const t = uiT(plugin);
	return [
		{
			type: 'group',
			heading: t('domains_heading'),
			cls: 'mdfriday-domains-group',
			items: [
				{
					name: t('domains_heading'),
					desc: t('domains_empty'),
					aliases: ['domain', 'custom domain', 'dns', 'hostname', 'cname'],
					render: (setting) => renderDomainsRows(plugin, setting),
				},
				getDnsCredentialsSettingItem(plugin),
			],
		},
	];
}

function openMenuBelow(menu: Menu, anchor: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom });
}

/** Host for nested Setting rows under a definition item (survives Obsidian group layout). */
function attachListHost(setting: Setting, cls: string): HTMLElement {
	setting.settingEl.addClass('mdfriday-setting-with-list');
	return setting.settingEl.createDiv({ cls });
}

function renderDomainsRows(plugin: FridayPlugin, setting: Setting): () => void {
	const t = uiT(plugin);
	let disposed = false;

	if (!canUseCustomDomains(plugin)) {
		setting.setName(t('domains_upgrade_desc'));
		setting.setDesc('');
		setting.addButton((btn) => {
			btn.setButtonText(t('domains_upgrade_btn')).setCta();
			btn.onClick(() => void plugin.openAccountInBrowser({ intent: 'upgrade' }));
		});
		return () => {
			disposed = true;
		};
	}

	const listEl = attachListHost(setting, 'mdfriday-domains-list');

	let addBtn: ButtonComponent | null = null;
	setting.setName(t('domains_loading'));
	setting.setDesc('');
	setting.addButton((btn) => {
		addBtn = btn;
		btn.setButtonText(t('domains_add')).setCta().setDisabled(true);
		btn.onClick(() => {
			new AddDomainModal(plugin.app, plugin, { onChanged: () => void load() }).open();
		});
	});

	let domains: ObsidianCustomDomain[] = [];

	async function load(): Promise<void> {
		const service = plugin.foundryCustomDomainService;
		if (!service) return;
		plugin.syncCloudflareSession();
		const res = await service.list();
		if (disposed) return;
		listEl.empty();
		if (!res.success || !res.data) {
			if (res.code === 'unauthenticated') {
				setting.setName(t('domains_quota_unlimited', { used: 0 }));
				setting.setDesc(t('domains_empty'));
				addBtn?.setDisabled(false);
				return;
			}
			setting.setName(t('domains_heading'));
			setting.setDesc(t('domains_load_failed', { error: res.error || 'unknown' }));
			return;
		}
		domains = res.data.filter((d) => d.status !== 'removed');
		const max = plugin.settings.mdfQuotaMaxCustomDomains;
		const used = domains.length;
		const full = typeof max === 'number' && used >= max;
		setting.setName(
			typeof max === 'number'
				? t('domains_quota', { used, max })
				: t('domains_quota_unlimited', { used }),
		);
		setting.setDesc(
			full && typeof max === 'number'
				? t('domains_quota_full', { used, max })
				: domains.length === 0
					? t('domains_empty')
					: '',
		);
		addBtn?.setDisabled(full);
		for (const domain of domains) renderDomainRow(domain);
	}

	function renderDomainRow(domain: ObsidianCustomDomain): void {
		const row = new Setting(listEl).setName(domain.hostname).setDesc(domainStatusLine(t, domain));
		if (!domain.usable && domain.status !== 'paused') {
			row.addButton((btn) => {
				btn.setButtonText(t('domains_continue')).setCta();
				btn.onClick(() => {
					new AddDomainModal(plugin.app, plugin, {
						resume: domain,
						onChanged: () => void load(),
					}).open();
				});
			});
		}
		row.addExtraButton((btn) => {
			btn.setIcon('refresh-cw').setTooltip(t('domains_refresh_tip'));
			btn.onClick(async () => {
				const service = plugin.foundryCustomDomainService;
				if (!service) return;
				const before = domainStatusLine(t, domain);
				row.setDesc(t('domains_loading'));
				btn.setDisabled(true);
				plugin.syncCloudflareSession();
				// Pending setup: verify / sync-cert. Already ready: re-fetch binding info only.
				const res = await service.refresh(domain.id);
				btn.setDisabled(false);
				if (!res.success) {
					row.setDesc(before);
					new Notice(t('domains_action_failed', { error: res.error || 'unknown' }), 5000);
					return;
				}
				await load();
				notifyDomainsChanged(plugin);
				new Notice(t('domains_refresh_done', { host: domain.hostname }), 2500);
			});
		});
		row.addExtraButton((btn) => {
			btn.setIcon('more-vertical').setTooltip(t('domains_more'));
			btn.onClick(() => {
				const menu = new Menu();
				if (domain.boundProject) {
					menu.addItem((item) =>
						item
							.setTitle(t('domains_detach'))
							.setIcon('unlink')
							.onClick(() => void detach(domain)),
					);
				}
				menu.addItem((item) =>
					item
						.setTitle(t('domains_delete'))
						.setIcon('trash')
						.onClick(() => void remove(domain)),
				);
				openMenuBelow(menu, btn.extraSettingsEl);
			});
		});
	}

	/** Consequence text for taking a bound domain off its site (arch 05 §2.2). */
	function consequence(t: UiT, domain: ObsidianCustomDomain): string {
		const title = domain.boundProject?.title ?? '';
		const siblings = domains.filter((d) => d.projectId === domain.projectId && d.id !== domain.id);
		if (siblings.length === 0) return t('domains_detach_last', { host: domain.hostname, title });
		if (domain.isPrimary) return t('domains_detach_primary', { host: domain.hostname, title });
		return t('domains_detach_other', { host: domain.hostname, title });
	}

	async function detach(domain: ObsidianCustomDomain): Promise<void> {
		const ok = await confirmModal(plugin.app, {
			title: t('domains_detach_title', { host: domain.hostname }),
			message: consequence(t, domain),
			confirmText: t('domains_detach'),
			cancelText: t('domains_cancel'),
			warning: true,
		});
		if (!ok) return;
		const service = plugin.foundryCustomDomainService;
		if (!service) return;
		plugin.syncCloudflareSession();
		const res = await service.detach(domain.id);
		if (!res.success) {
			new Notice(t('domains_action_failed', { error: res.error || 'unknown' }), 5000);
			return;
		}
		new Notice(t('domains_detach_done', { host: domain.hostname }), 4000);
		await load();
		notifyDomainsChanged(plugin);
	}

	async function remove(domain: ObsidianCustomDomain): Promise<void> {
		const ok = await confirmModal(plugin.app, {
			title: t('domains_delete_title', { host: domain.hostname }),
			message: domain.boundProject
				? consequence(t, domain)
				: t('domains_delete_unbound', { host: domain.hostname }),
			confirmText: t('domains_delete'),
			cancelText: t('domains_cancel'),
			warning: true,
		});
		if (!ok) return;
		const service = plugin.foundryCustomDomainService;
		if (!service) return;
		plugin.syncCloudflareSession();
		const res = await service.remove(domain.id);
		if (!res.success) {
			new Notice(t('domains_action_failed', { error: res.error || 'unknown' }), 5000);
			return;
		}
		new Notice(t('domains_delete_done', { host: domain.hostname }), 4000);
		await load();
		notifyDomainsChanged(plugin);
	}

	void load();

	return () => {
		disposed = true;
		listEl.remove();
	};
}
