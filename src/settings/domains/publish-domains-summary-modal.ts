import { App, Modal, Setting } from 'obsidian';
import type { ObsidianCustomDomain, ObsidianDomainSelection } from '@mdfriday/core';
import type FridayPlugin from '../../main';
import { uiT, type PendingMove } from './domain-view';

class PublishDomainsSummaryModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private plugin: FridayPlugin,
		private selection: ObsidianDomainSelection,
		private domains: ObsidianCustomDomain[],
		private moves: PendingMove[],
		private done: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const t = uiT(this.plugin);
		const { contentEl, selection, domains, moves } = this;
		contentEl.empty();
		this.setTitle(t('domains_summary_title'));

		const list = contentEl.createEl('ul');
		const movedIds = new Set(moves.map((m) => m.domainId));
		for (const move of moves) {
			const text = [
				t('domains_summary_moves', { host: move.hostname, title: move.fromTitle }),
				move.siteGoesOffline ? ` (${t('domains_summary_offline', { title: move.fromTitle })})` : '',
			].join('');
			list.createEl('li', { text });
		}
		for (const id of selection.domainIds) {
			if (movedIds.has(id)) continue;
			const host = domains.find((d) => d.id === id)?.hostname ?? id;
			list.createEl('li', {
				text:
					id === selection.primaryDomainId
						? t('domains_summary_primary', { host })
						: t('domains_summary_secondary', { host }),
			});
		}

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(t('domains_cancel')).onClick(() => this.close()))
			.addButton((btn) => {
				btn.setButtonText(t('domains_summary_publish_btn')).setCta();
				if (moves.some((m) => m.siteGoesOffline)) btn.setDestructive();
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

/** Pre-publish summary (arch 05 §4.2). Only call when `moves` is non-empty. */
export function confirmPublishWithDomains(
	plugin: FridayPlugin,
	selection: ObsidianDomainSelection,
	domains: ObsidianCustomDomain[],
	moves: PendingMove[],
): Promise<boolean> {
	return new Promise((resolve) => {
		new PublishDomainsSummaryModal(plugin.app, plugin, selection, domains, moves, resolve).open();
	});
}
