import { Menu, Notice, Setting, type SettingDefinitionItem } from 'obsidian';
import type { ObsidianRemoteProjectInfo } from '@mdfriday/core';
import type FridayPlugin from '../../main';
import { confirmModal } from '../domains/confirm-modal';
import { canUseCustomDomains, notifyDomainsChanged, uiT } from '../domains/domain-view';

/** Settings ▸ Projects group (arch 05 §2.3). No Delete: the control plane has no delete-project endpoint yet. */
export function getProjectsSettingDefinitions(plugin: FridayPlugin): SettingDefinitionItem[] {
	const t = uiT(plugin);
	return [
		{
			type: 'group',
			heading: t('projects_heading'),
			cls: 'mdfriday-projects-group',
			items: [
				{
					name: t('projects_heading'),
					desc: t('projects_empty'),
					aliases: ['projects', 'sites', 'published', 'unpublish'],
					render: (setting) => renderProjectRows(plugin, setting),
				},
			],
		},
	];
}

const HIDDEN_STATUSES = new Set(['deleted']);
const OFFLINE_STATUSES = new Set(['unpublished', 'draft', 'deleted']);

function renderProjectRows(plugin: FridayPlugin, setting: Setting): () => void {
	const t = uiT(plugin);
	let disposed = false;
	setting.settingEl.addClass('mdfriday-setting-with-list');
	const listEl = setting.settingEl.createDiv({ cls: 'mdfriday-projects-list' });
	setting.setName(t('domains_loading'));
	setting.setDesc('');
	setting.addExtraButton((btn) => {
		btn.setIcon('refresh-cw').setTooltip(t('projects_refresh'));
		btn.onClick(() => void load({ showLoading: true }));
	});

	async function load(opts: { showLoading?: boolean } = {}): Promise<void> {
		const projects = plugin.foundryRemoteProjectService;
		if (!projects) return;
		if (opts.showLoading) {
			setting.setName(t('domains_loading'));
			setting.setDesc('');
			listEl.empty();
		}
		plugin.syncCloudflareSession();
		const res = await projects.list();
		if (disposed) return;
		if (!res.success || !res.data) {
			setting.setName(t('projects_heading'));
			setting.setDesc(
				res.code === 'unauthenticated'
					? t('projects_empty')
					: t('projects_load_failed', { error: res.error || 'unknown' }),
			);
			return;
		}
		const rows = res.data.filter((p) => !p.status || !HIDDEN_STATUSES.has(p.status));

		// Domain counts / "needs republish" need the account domain list (Personal+ only).
		const domainCount = new Map<string, number>();
		let domainsKnown = false;
		if (canUseCustomDomains(plugin) && plugin.foundryCustomDomainService) {
			const domains = await plugin.foundryCustomDomainService.list();
			if (disposed) return;
			if (domains.success && domains.data) {
				domainsKnown = true;
				for (const d of domains.data) {
					if (d.status === 'removed' || !d.projectId) continue;
					domainCount.set(d.projectId, (domainCount.get(d.projectId) ?? 0) + 1);
				}
			}
		}

		setting.setName(t('projects_heading'));
		setting.setDesc(rows.length === 0 ? t('projects_empty') : '');
		for (const project of rows) {
			renderProjectRow(project, domainsKnown ? (domainCount.get(project.id) ?? 0) : null);
		}
	}

	function renderProjectRow(project: ObsidianRemoteProjectInfo, domains: number | null): void {
		const title = project.title || project.siteId || project.id;
		const row = new Setting(listEl).setName(title);
		const workspaceId = (project.workspaceId ?? '').trim();
		if (workspaceId && workspaceId !== plugin.getWorkspaceId()) {
			row.nameEl.createSpan({ text: t('projects_other_vault'), cls: 'flair mdfriday-flair' });
		}

		const parts: string[] = [];
		const custom = project.hostingMode === 'custom';
		parts.push(custom ? t('projects_mode_custom') : t('projects_mode_share'));
		if (project.publicUrl) parts.push(project.publicUrl);
		if (domains !== null && domains > 0) parts.push(t('projects_domain_count', { count: domains }));
		if (domains === 0 && custom) parts.push(t('projects_needs_republish'));
		row.setDesc(parts.join(' · '));

		const online = !project.status || !OFFLINE_STATUSES.has(project.status);
		row.addExtraButton((btn) => {
			btn.setIcon('more-vertical').setTooltip(t('domains_more'));
			btn.onClick(() => {
				const menu = new Menu();
				const url = project.publicUrl;
				menu.addItem((item) =>
					item
						.setTitle(t('projects_open'))
						.setIcon('external-link')
						.setDisabled(!url)
						.onClick(() => {
							if (url) window.open(url, '_blank');
						}),
				);
				menu.addItem((item) =>
					item
						.setTitle(t('projects_copy_url'))
						.setIcon('copy')
						.setDisabled(!url)
						.onClick(async () => {
							if (!url) return;
							await navigator.clipboard.writeText(url);
							new Notice(t('projects_url_copied'), 2000);
						}),
				);
				if (online) {
					menu.addItem((item) =>
						item
							.setTitle(t('projects_unpublish'))
							.setIcon('cloud-off')
							.onClick(() => void unpublish(project, title)),
					);
				}
				const rect = btn.extraSettingsEl.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom });
			});
		});
	}

	async function unpublish(project: ObsidianRemoteProjectInfo, title: string): Promise<void> {
		const ok = await confirmModal(plugin.app, {
			title: t('projects_unpublish_title', { title }),
			message: t('projects_unpublish_confirm'),
			confirmText: t('projects_unpublish'),
			cancelText: t('domains_cancel'),
			warning: true,
		});
		if (!ok) return;
		const projects = plugin.foundryRemoteProjectService;
		if (!projects) return;
		plugin.syncCloudflareSession();
		const res = await projects.unpublish(project.id);
		if (!res.success) {
			new Notice(t('projects_action_failed', { error: res.error || 'unknown' }), 5000);
			return;
		}
		new Notice(t('projects_unpublish_done', { title }), 4000);
		await load();
		notifyDomainsChanged(plugin);
	}

	void load();

	return () => {
		disposed = true;
		listEl.remove();
	};
}
