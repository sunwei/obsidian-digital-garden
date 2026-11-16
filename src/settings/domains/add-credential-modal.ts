import { App, Modal, Notice, Setting } from 'obsidian';
import type FridayPlugin from '../../main';
import {
	AUTO_DNS_PROVIDERS,
	draftToInput,
	emptyDraft,
	isAutoDnsProvider,
	providerLabel,
	renderCredentialFields,
	type AutoDnsProvider,
	type CredentialDraft,
} from './credential-form';
import { uiT, type UiT } from './domain-view';

/** Settings ▸ DNS credentials ▸ Add: same fields as the Add domain form, without a hostname. */
export class AddCredentialModal extends Modal {
	private t: UiT;
	private provider: AutoDnsProvider = 'aliyun';
	private draft: CredentialDraft = emptyDraft();
	private fieldsEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private busy = false;

	constructor(
		app: App,
		private plugin: FridayPlugin,
		private onSaved: () => void,
	) {
		super(app);
		this.t = uiT(plugin);
	}

	onOpen(): void {
		const { contentEl, t } = this;
		contentEl.empty();
		this.setTitle(t('domains_credential_add_title'));

		new Setting(contentEl).setName(t('domains_provider')).addDropdown((dropdown) => {
			for (const p of AUTO_DNS_PROVIDERS) dropdown.addOption(p, providerLabel(t, p));
			dropdown.setValue(this.provider);
			dropdown.onChange((value) => {
				if (!isAutoDnsProvider(value)) return;
				this.provider = value;
				this.draft = emptyDraft();
				this.renderFields();
			});
		});

		this.fieldsEl = contentEl.createDiv();
		this.renderFields();

		contentEl.createEl('p', { text: t('domains_remember_desc'), cls: 'setting-item-description' });
		this.statusEl = contentEl.createDiv({ cls: 'setting-item-description mod-warning' });
		this.statusEl.hide();

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(t('domains_cancel')).onClick(() => this.close()))
			.addButton((btn) => {
				btn.setButtonText(t('domains_credential_save')).setCta();
				btn.onClick(() => void this.save());
			});
	}

	onClose(): void {
		this.contentEl.empty();
		// Drop typed secrets.
		this.draft = emptyDraft();
	}

	private renderFields(): void {
		if (!this.fieldsEl) return;
		this.fieldsEl.empty();
		renderCredentialFields(this.fieldsEl, this.t, this.provider, this.draft);
	}

	private async save(): Promise<void> {
		if (this.busy) return;
		const input = draftToInput(this.provider, this.draft);
		if (!input) {
			this.showError(this.t('domains_cred_missing'));
			return;
		}
		const service = this.plugin.foundryCustomDomainService;
		if (!service) return;
		this.busy = true;
		const res = await service.saveCredential(input);
		this.busy = false;
		if (!res.success) {
			this.showError(this.t('domains_action_failed', { error: res.error || 'unknown' }));
			return;
		}
		new Notice(this.t('domains_credential_saved'), 3000);
		this.onSaved();
		this.close();
	}

	private showError(message: string): void {
		if (!this.statusEl) return;
		this.statusEl.setText(message);
		this.statusEl.show();
	}
}
