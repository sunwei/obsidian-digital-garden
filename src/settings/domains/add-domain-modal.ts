import { App, Modal, Notice, Setting } from 'obsidian';
import type {
	ObsidianCredentialRef,
	ObsidianCustomDomain,
	ObsidianCustomDomainResult,
	ObsidianDnsChangePlan,
	ObsidianDnsCredentialSummary,
	ObsidianDnsRecord,
	ObsidianSetupProgress,
} from '@mdfriday/core';
import type FridayPlugin from '../../main';
import { dnsShortHost } from '../../services/dns-host';
import { confirmModal } from './confirm-modal';
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
import { notifyDomainsChanged, uiT, type UiT } from './domain-view';

const HOSTNAME_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeHostname(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.replace(/\.$/, '');
}

export interface AddDomainModalOptions {
	/** Resume setup of an existing pending domain instead of registering a new hostname. */
	resume?: ObsidianCustomDomain;
	/** Called when the domain list changed (added / became ready). */
	onChanged?: () => void;
}

const PHASES: ObsidianSetupProgress['phase'][] = ['register', 'records', 'apply', 'verify', 'cert', 'ready'];

/**
 * Add domain. Manual: hostname → DNS record table → verify. Automatic: provider + credential →
 * DNS written through the provider API (credentials stay on this device) → progress view.
 * Also used to continue a pending domain from the settings list.
 */
export class AddDomainModal extends Modal {
	private t: UiT;
	private hostname = '';
	private domainId: string | null = null;
	private records: ObsidianDnsRecord[] = [];
	private busy = false;
	private statusEl: HTMLElement | null = null;

	// Automatic
	private method: 'manual' | 'automatic' = 'manual';
	private provider: AutoDnsProvider = 'aliyun';
	private providerTouched = false;
	private detectedProvider: AutoDnsProvider | null = null;
	private detectedHost = '';
	private savedCredentials: ObsidianDnsCredentialSummary[] = [];
	/** `new` or the id of a saved credential. */
	private credentialChoice = 'new';
	private draft: CredentialDraft = emptyDraft();
	private remember = false;
	private autoEl: HTMLElement | null = null;
	private submitBtn: HTMLButtonElement | null = null;
	private running = false;
	private closed = false;
	private progress: ObsidianSetupProgress | null = null;
	private progressEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: FridayPlugin,
		private options: AddDomainModalOptions = {},
	) {
		super(app);
		this.t = uiT(plugin);
		if (options.resume) {
			this.hostname = options.resume.hostname;
			this.domainId = options.resume.id;
		}
	}

	onOpen(): void {
		if (this.options.resume) {
			void this.openRecordsView(true);
		} else {
			this.renderForm();
		}
	}

	onClose(): void {
		this.closed = true;
		this.contentEl.empty();
		// Drop typed secrets; a running setup keeps its own reference to the credential.
		this.draft = emptyDraft();
	}

	// ---------------------------------------------------------------- form

	private renderForm(): void {
		const { contentEl, t } = this;
		contentEl.empty();
		this.setTitle(t('domains_add'));

		new Setting(contentEl).setName(t('domains_add_hostname')).addText((text) => {
			text.setPlaceholder(t('domains_add_hostname_placeholder'));
			text.setValue(this.hostname);
			text.onChange((value) => {
				if (normalizeHostname(value) !== normalizeHostname(this.hostname)) this.providerTouched = false;
				this.hostname = value;
			});
			text.inputEl.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter') void this.submit();
			});
			text.inputEl.addEventListener('blur', () => void this.detectProvider());
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl).setName(t('domains_add_method')).addDropdown((dropdown) => {
			dropdown.addOption('manual', t('domains_method_manual'));
			dropdown.addOption('automatic', t('domains_method_auto'));
			dropdown.setValue(this.method);
			dropdown.onChange((value) => {
				this.method = value === 'automatic' ? 'automatic' : 'manual';
				this.submitBtn?.setText(this.submitLabel());
				void this.enterMethod();
			});
		});

		this.autoEl = contentEl.createDiv({ cls: 'mdfriday-dns-auto' });
		this.renderAutomatic();

		this.statusEl = contentEl.createDiv({ cls: 'setting-item-description mod-warning' });
		this.statusEl.hide();

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(t('domains_cancel')).onClick(() => this.close()))
			.addButton((btn) => {
				btn.setButtonText(this.submitLabel()).setCta();
				this.submitBtn = btn.buttonEl;
				btn.onClick(() => void this.submit());
			});
		if (this.method === 'automatic') void this.enterMethod();
	}

	private submitLabel(): string {
		return this.method === 'automatic' ? this.t('domains_auto_start') : this.t('domains_add_btn');
	}

	private submit(): Promise<void> {
		return this.method === 'automatic' ? this.submitAutomatic() : this.submitHostname();
	}

	// ----------------------------------------------------------- automatic

	private async enterMethod(): Promise<void> {
		if (this.method === 'automatic') {
			const service = this.plugin.foundryCustomDomainService;
			const res = service ? await service.listCredentials() : null;
			this.savedCredentials = res?.success && res.data ? res.data : [];
			if (this.closed) return;
			this.selectDefaultCredential();
			void this.detectProvider();
		}
		this.setStatus('');
		this.renderAutomatic();
	}

	/** Preselect the provider from the domain's nameservers (best effort, never blocks). */
	private async detectProvider(): Promise<void> {
		if (this.method !== 'automatic') return;
		const host = normalizeHostname(this.hostname);
		if (!HOSTNAME_RE.test(host) || this.detectedHost === host) return;
		const service = this.plugin.foundryCustomDomainService;
		if (!service) return;
		this.detectedHost = host;
		const res = await service.detectProvider(host);
		if (this.closed || normalizeHostname(this.hostname) !== host) return;
		const detected = res.success && res.data ? res.data.provider : 'unknown';
		this.detectedProvider = isAutoDnsProvider(detected) ? detected : null;
		if (this.detectedProvider && !this.providerTouched && this.detectedProvider !== this.provider) {
			this.setProvider(this.detectedProvider);
		}
		this.renderAutomatic();
	}

	private setProvider(provider: AutoDnsProvider): void {
		this.provider = provider;
		this.draft = emptyDraft();
		this.selectDefaultCredential();
	}

	private savedForProvider(): ObsidianDnsCredentialSummary[] {
		return this.savedCredentials.filter((c) => c.provider === this.provider);
	}

	private selectDefaultCredential(): void {
		this.credentialChoice = this.savedForProvider()[0]?.id ?? 'new';
	}

	private renderAutomatic(): void {
		const el = this.autoEl;
		if (!el) return;
		el.empty();
		if (this.method !== 'automatic') return;
		const { t } = this;

		const providerSetting = new Setting(el).setName(t('domains_provider'));
		providerSetting.addDropdown((dropdown) => {
			for (const p of AUTO_DNS_PROVIDERS) dropdown.addOption(p, providerLabel(t, p));
			dropdown.setValue(this.provider);
			dropdown.onChange((value) => {
				if (!isAutoDnsProvider(value)) return;
				this.providerTouched = true;
				this.setProvider(value);
				this.renderAutomatic();
			});
		});
		if (this.detectedProvider) {
			providerSetting.setDesc(
				this.detectedProvider === this.provider
					? `${t('domains_provider_detected')}: ${providerLabel(t, this.detectedProvider)}`
					: t('domains_provider_mismatch', {
							detected: providerLabel(t, this.detectedProvider),
							chosen: providerLabel(t, this.provider),
						}),
			);
		}

		const saved = this.savedForProvider();
		if (saved.length > 0) {
			new Setting(el).setName(t('domains_credential')).addDropdown((dropdown) => {
				for (const c of saved) {
					dropdown.addOption(c.id, c.label || providerLabel(t, c.provider));
				}
				dropdown.addOption('new', t('domains_credential_new'));
				dropdown.setValue(this.credentialChoice);
				dropdown.onChange((value) => {
					this.credentialChoice = value;
					this.renderAutomatic();
				});
			});
		} else {
			this.credentialChoice = 'new';
		}

		if (this.credentialChoice === 'new') {
			renderCredentialFields(el.createDiv(), t, this.provider, this.draft);
			new Setting(el)
				.setName(t('domains_remember'))
				.setDesc(t('domains_remember_desc'))
				.addToggle((toggle) => {
					toggle.setValue(this.remember);
					toggle.onChange((value) => {
						this.remember = value;
					});
				});
		}
	}

	private async submitAutomatic(): Promise<void> {
		if (this.busy || this.running) return;
		const host = normalizeHostname(this.hostname);
		if (!HOSTNAME_RE.test(host)) {
			this.setStatus(this.t('domains_add_invalid'));
			return;
		}
		let ref: ObsidianCredentialRef;
		if (this.credentialChoice === 'new') {
			const input = draftToInput(this.provider, this.draft);
			if (!input) {
				this.setStatus(this.t('domains_cred_missing'));
				return;
			}
			ref = { inline: input, remember: this.remember };
		} else {
			ref = { savedId: this.credentialChoice };
		}
		const service = this.plugin.foundryCustomDomainService;
		if (!service) return;

		this.hostname = host;
		this.running = true;
		this.progress = { phase: 'register', message: '', percentage: 0 };
		this.renderProgress();
		this.plugin.syncCloudflareSession();
		const res = await service.addAutomatic(host, ref, {
			onProgress: (p) => {
				this.progress = p;
				this.updateProgress();
			},
			confirm: (plan) => this.confirmPlan(plan),
		});
		this.running = false;
		this.finishAutomatic(host, res);
	}

	private confirmPlan(plan: ObsidianDnsChangePlan): Promise<boolean> {
		const { t } = this;
		const lines: string[] = [t('domains_conflict_intro')];
		for (const c of plan.conflicts) {
			lines.push(
				t('domains_conflict_replace', {
					name: c.record.name,
					existing: c.existing.map((e) => `${e.type} ${e.value}`).join(', '),
					type: c.record.type,
					value: c.record.value,
				}),
			);
		}
		for (const r of plan.updates) {
			lines.push(t('domains_conflict_update', { type: r.record.type, name: r.record.name, value: r.record.value }));
		}
		for (const r of plan.creates) {
			lines.push(t('domains_conflict_add', { type: r.type, name: r.name, value: r.value }));
		}
		return confirmModal(this.plugin.app, {
			title: t('domains_conflict_title'),
			message: lines,
			confirmText: t('domains_conflict_overwrite'),
			cancelText: t('domains_cancel'),
			warning: true,
		});
	}

	private finishAutomatic(host: string, res: ObsidianCustomDomainResult<ObsidianCustomDomain>): void {
		// The domain may exist on the server (pending) even when DNS setup failed.
		this.options.onChanged?.();
		notifyDomainsChanged(this.plugin);
		if (res.success) {
			new Notice(this.t('domains_ready', { host }), 5000);
			if (!this.closed) this.close();
			return;
		}
		const message = this.automaticError(res);
		if (this.closed) {
			new Notice(this.t('domains_auto_failed', { host, error: message }), 10000);
			return;
		}
		this.renderForm();
		this.setStatus(message);
	}

	private automaticError(res: ObsidianCustomDomainResult<unknown>): string {
		const { t } = this;
		switch (res.code) {
			case 'provider_auth_failed':
			case 'zone_not_found':
			case 'dns_conflict':
			case 'verify_timeout':
			case 'cert_timeout':
				return t(`domains_err_${res.code}`);
			case 'apex_not_supported':
				return t('domains_err_apex_not_supported', { provider: providerLabel(t, this.provider) });
			default:
				return res.error || 'unknown';
		}
	}

	private renderProgress(): void {
		const { contentEl, t } = this;
		contentEl.empty();
		this.setTitle(t('domains_auto_progress_title', { host: this.hostname }));
		this.progressEl = contentEl.createDiv({ cls: 'mdfriday-dns-progress' });
		this.updateProgress();
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText(t('domains_run_background')).setCta();
			btn.onClick(() => this.close());
		});
		contentEl.createEl('p', { text: t('domains_run_background_desc'), cls: 'setting-item-description' });
	}

	private updateProgress(): void {
		const el = this.progressEl;
		const progress = this.progress;
		if (this.closed || !el || !progress) return;
		el.empty();
		const current = PHASES.indexOf(progress.phase);
		const list = el.createEl('ul', { cls: 'mdfriday-dns-phases' });
		PHASES.forEach((phase, i) => {
			const state = i < current || progress.phase === 'ready' ? 'done' : i === current ? 'active' : 'pending';
			const mark = state === 'done' ? '✓' : state === 'active' ? '…' : '○';
			list.createEl('li', {
				text: `${mark} ${this.t(`domains_phase_${phase}`)}`,
				cls: `mdfriday-dns-phase is-${state}`,
			});
		});
		if (progress.message) el.createEl('p', { text: progress.message, cls: 'setting-item-description' });
		const bar = el.createEl('progress');
		bar.max = 100;
		bar.value = Math.max(0, Math.min(100, progress.percentage));
	}

	private async submitHostname(): Promise<void> {
		if (this.busy) return;
		const host = normalizeHostname(this.hostname);
		if (!HOSTNAME_RE.test(host)) {
			this.setStatus(this.t('domains_add_invalid'));
			return;
		}
		const service = this.plugin.foundryCustomDomainService;
		if (!service) return;
		this.busy = true;
		this.setStatus('');
		this.plugin.syncCloudflareSession();
		const res = await service.addManual(host);
		this.busy = false;
		if (!res.success || !res.data) {
			this.setStatus(this.t('domains_action_failed', { error: res.error || 'unknown' }));
			return;
		}
		this.hostname = host;
		this.domainId = res.data.domainId;
		this.options.onChanged?.();
		if (res.data.ready) {
			this.finishReady();
			return;
		}
		this.records = res.data.records;
		this.renderRecords();
	}

	// ------------------------------------------------------- record table

	private async openRecordsView(resume: boolean): Promise<void> {
		const { contentEl, t } = this;
		contentEl.empty();
		this.setTitle(t('domains_resume_title', { host: this.hostname }));
		contentEl.createEl('p', { text: t('domains_records_loading'), cls: 'setting-item-description' });
		if (!resume || !this.domainId) return;
		const service = this.plugin.foundryCustomDomainService;
		if (!service) return;
		this.plugin.syncCloudflareSession();
		const res = await service.getSetupRecords(this.domainId);
		if (!res.success) {
			this.renderRecords();
			this.setStatus(res.error || '');
			return;
		}
		this.records = res.data ?? [];
		this.renderRecords();
	}

	private renderRecords(): void {
		const { contentEl, t } = this;
		contentEl.empty();
		this.setTitle(
			this.options.resume
				? t('domains_resume_title', { host: this.hostname })
				: t('domains_records_title'),
		);
		if (!this.options.resume) {
			contentEl.createEl('p', { text: this.hostname, cls: 'setting-item-name' });
		}

		if (this.records.length === 0) {
			contentEl.createEl('p', { text: t('domains_records_none'), cls: 'setting-item-description' });
		} else {
			contentEl.createEl('p', { text: t('domain_host_hint'), cls: 'setting-item-description' });
			this.renderTable(contentEl.createDiv({ cls: 'mdfriday-dns-table-wrap' }));
		}

		this.statusEl = contentEl.createDiv({ cls: 'setting-item-description' });
		this.statusEl.hide();

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(t('domains_cancel')).onClick(() => this.close()))
			.addButton((btn) => {
				btn.setButtonText(t('domain_verify_cta')).setCta();
				btn.onClick(() => void this.verify(btn.buttonEl));
			});
	}

	private renderTable(host: HTMLElement): void {
		const { t } = this;
		const table = host.createEl('table', { cls: 'mdfriday-dns-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const key of ['domain_host_col', 'domain_type_col', 'domain_value_col', 'domain_note_col']) {
			head.createEl('th', { text: t(key) });
		}
		const body = table.createEl('tbody');
		for (const record of this.records) {
			const row = body.createEl('tr');
			this.copyCell(row.createEl('td'), dnsShortHost(record.name));
			row.createEl('td', { text: record.type });
			this.copyCell(row.createEl('td'), record.value);
			row.createEl('td', { text: this.purposeLabel(record) });
		}
	}

	private purposeLabel(record: ObsidianDnsRecord): string {
		switch (record.purpose) {
			case 'routing':
				return this.t('domain_note_point');
			case 'ownership':
				return this.t('domain_note_verify');
			default:
				return this.t('domain_note_https');
		}
	}

	private copyCell(cell: HTMLElement, text: string): void {
		cell.createEl('code', { text });
		const btn = cell.createEl('button', { text: this.t('domains_copy'), cls: 'mdfriday-dns-copy' });
		btn.type = 'button';
		btn.addEventListener('click', () => {
			void navigator.clipboard.writeText(text).then(() => {
				new Notice(this.t('domain_copied'), 1500);
			});
		});
	}

	// -------------------------------------------------------------- verify

	private async verify(button: HTMLButtonElement): Promise<void> {
		if (this.busy || !this.domainId) return;
		const service = this.plugin.foundryCustomDomainService;
		if (!service) return;
		this.busy = true;
		button.disabled = true;
		this.setStatus(this.t('domains_verifying'), false);
		this.plugin.syncCloudflareSession();
		const res = await service.continueManual(this.domainId, (progress) => {
			if (progress.records) this.records = progress.records;
			this.setStatus(progress.message, false);
		});
		this.busy = false;
		button.disabled = false;
		if (!res.success || !res.data) {
			this.setStatus(res.error || this.t('domains_verify_pending'));
			return;
		}
		this.options.onChanged?.();
		if (res.data.ready) {
			this.finishReady();
			return;
		}
		this.records = res.data.records;
		this.renderRecords();
		this.setStatus(this.t('domains_verify_pending'));
	}

	private finishReady(): void {
		new Notice(this.t('domains_ready', { host: this.hostname }), 5000);
		this.options.onChanged?.();
		this.close();
	}

	private setStatus(message: string, isError = true): void {
		if (!this.statusEl) return;
		this.statusEl.setText(message);
		this.statusEl.toggleClass('mod-warning', isError);
		if (message) this.statusEl.show();
		else this.statusEl.hide();
	}
}
