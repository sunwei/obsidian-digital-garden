import { App, Modal, Setting } from 'obsidian';
import type { ObsidianMoveImpact } from '@mdfriday/core';
import type FridayPlugin from '../../main';
import { siteUrlOrHost, uiT, type UiT } from './domain-view';

/** Impact lines for a move (arch 05 §4.1 cases A / B / C). Shared by the move confirm modal. */
export function moveImpactLines(
	t: UiT,
	host: string,
	impact: ObsidianMoveImpact,
): { lines: string[]; warning: boolean } {
	const title = impact.fromProject.title;
	const lines: string[] = [];
	if (impact.case === 'A') {
		lines.push(t('domains_move_offline', { title }));
	} else if (impact.case === 'B' && impact.nextPrimary) {
		lines.push(t('domains_move_primary_switch', { title, next: impact.nextPrimary.hostname }));
	} else {
		lines.push(
			t('domains_move_secondary', {
				title,
				host,
				url: siteUrlOrHost(impact.fromProject.url, host),
			}),
		);
	}
	lines.push(t('domains_move_visitors', { host }));
	if (impact.sellsOrProtects) lines.push(t('domains_move_commerce', { title }));
	if (impact.fromProject.otherVault) lines.push(t('domains_move_other_vault', { title }));
	return { lines, warning: impact.case === 'A' };
}

class MoveDomainModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private plugin: FridayPlugin,
		private host: string,
		private impact: ObsidianMoveImpact,
		private done: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const t = uiT(this.plugin);
		const { contentEl, host, impact } = this;
		contentEl.empty();
		this.setTitle(t('domains_move_title', { host }));

		contentEl.createEl('p', {
			text: t('domains_move_current', {
				host,
				title: impact.fromProject.title,
				url: siteUrlOrHost(impact.fromProject.url, host),
			}),
		});
		contentEl.createEl('p', { text: t('domains_move_nothing_yet') });
		contentEl.createEl('p', { text: t('domains_move_after'), cls: 'setting-item-name' });

		const { lines, warning } = moveImpactLines(t, host, impact);
		const list = contentEl.createEl('ul');
		for (const line of lines) {
			list.createEl('li', { text: line });
		}

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(t('domains_cancel')).onClick(() => this.close()))
			.addButton((btn) => {
				btn.setButtonText(t('domains_move_confirm_btn'));
				if (warning) btn.setDestructive().setCta();
				else btn.setCta();
				btn.onClick(() => {
					this.finish(true);
					this.close();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(false);
	}

	private finish(ok: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.done(ok);
	}
}

/** "Use {host} for this site?" — resolves true when the user agrees to move the domain on publish. */
export function confirmMoveDomain(
	plugin: FridayPlugin,
	host: string,
	impact: ObsidianMoveImpact,
): Promise<boolean> {
	return new Promise((resolve) => {
		new MoveDomainModal(plugin.app, plugin, host, impact, resolve).open();
	});
}
