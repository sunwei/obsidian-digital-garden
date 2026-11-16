import { App, Modal, Setting } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	/** Paragraphs shown under the title. */
	message: string | string[];
	confirmText: string;
	cancelText: string;
	/** Styles the confirm button as destructive (`mod-warning`). */
	warning?: boolean;
	/** User must type this text before the confirm button enables (e.g. project title). */
	requireText?: string;
	requireTextLabel?: string;
}

class ConfirmModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private options: ConfirmOptions,
		private done: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		contentEl.empty();
		this.setTitle(options.title);
		const paragraphs = Array.isArray(options.message) ? options.message : [options.message];
		for (const text of paragraphs) {
			contentEl.createEl('p', { text });
		}

		let confirmBtn: HTMLButtonElement | null = null;
		if (options.requireText) {
			const required = options.requireText;
			new Setting(contentEl)
				.setName(options.requireTextLabel ?? required)
				.addText((text) => {
					text.setPlaceholder(required);
					text.onChange((value) => {
						if (confirmBtn) confirmBtn.disabled = value.trim() !== required;
					});
				});
		}

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(options.cancelText).onClick(() => this.close()))
			.addButton((btn) => {
				btn.setButtonText(options.confirmText);
				if (options.warning) btn.setDestructive().setCta();
				else btn.setCta();
				if (options.requireText) btn.setDisabled(true);
				confirmBtn = btn.buttonEl;
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

/** Obsidian-native confirm dialog. Resolves false on cancel / dismiss. */
export function confirmModal(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}
