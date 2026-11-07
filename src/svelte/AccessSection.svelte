<script lang="ts">
	/**
	 * Advanced → Access (replaces Access password).
	 * Edits vault frontmatter (access / access_scope / teaser); keys live in Dashboard.
	 */
	import type FridayPlugin from '../main';
	import type { TFile } from 'obsidian';
	import { CLOUDFLARE_ENV_PRESETS } from '../cloudflare-env';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;
	export let isGuest: boolean;
	/** Vault-relative path of the publish target (note or folder index). */
	export let sourcePath: string | null = null;
	export let refreshKey = 0;
	export let remoteProjectId: string | null = null;

	type Protection = 'public' | 'protected';
	type ScopeMode = 'inherit' | 'independent';

	let protection: Protection = 'public';
	let scopeMode: ScopeMode = 'inherit';
	let scopeSlug = '';
	let teaser = '';
	let declaredIn = '';
	let loading = false;
	let saving = false;
	let loadSeq = 0;

	$: void load(sourcePath, refreshKey);

	function dashboardAccessUrl(): string {
		const env = (plugin.settings.cloudflareEnv || 'production') as keyof typeof CLOUDFLARE_ENV_PRESETS;
		const preset = CLOUDFLARE_ENV_PRESETS[env] || CLOUDFLARE_ENV_PRESETS.production;
		const site = (preset.siteBaseUrl || 'https://mdfriday.com').replace(/\/$/, '');
		const q = remoteProjectId ? `?id=${encodeURIComponent(remoteProjectId)}` : '';
		return `${site}/dashboard/access/${q}`;
	}

	function resolveTargetFile(path: string | null): TFile | null {
		if (!path) return null;
		const af = plugin.app.vault.getAbstractFileByPath(path);
		if (af && 'extension' in af) return af as TFile;
		// Folder publish → folder/index.md
		const indexPath = path.endsWith('.md') ? path : `${path.replace(/\/$/, '')}/index.md`;
		const idx = plugin.app.vault.getAbstractFileByPath(indexPath);
		if (idx && 'extension' in idx) return idx as TFile;
		return null;
	}

	async function load(path: string | null, _key: number) {
		const seq = ++loadSeq;
		const file = resolveTargetFile(path);
		if (!file) {
			protection = 'public';
			scopeMode = 'inherit';
			scopeSlug = '';
			teaser = '';
			declaredIn = '';
			return;
		}
		loading = true;
		try {
			const cache = plugin.app.metadataCache.getFileCache(file);
			const fm = (cache?.frontmatter || {}) as Record<string, unknown>;
			if (seq !== loadSeq) return;
			declaredIn = file.path;
			protection = fm.access === 'protected' ? 'protected' : 'public';
			const slug = typeof fm.access_scope === 'string' ? fm.access_scope.trim() : '';
			if (slug) {
				scopeMode = 'independent';
				scopeSlug = slug;
			} else {
				scopeMode = 'inherit';
				scopeSlug = '';
			}
			teaser = typeof fm.teaser === 'string' ? fm.teaser : '';
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	async function writeFrontmatter(mutator: (fm: Record<string, unknown>) => void) {
		const file = resolveTargetFile(sourcePath);
		if (!file || saving) return;
		saving = true;
		try {
			await plugin.app.fileManager.processFrontMatter(file, (fm) => {
				mutator(fm as Record<string, unknown>);
			});
		} finally {
			saving = false;
		}
	}

	async function setProtection(next: Protection) {
		protection = next;
		await writeFrontmatter((fm) => {
			if (next === 'protected') fm.access = 'protected';
			else {
				delete fm.access;
				delete fm.access_scope;
				scopeMode = 'inherit';
				scopeSlug = '';
			}
		});
	}

	async function setScopeMode(next: ScopeMode) {
		scopeMode = next;
		await writeFrontmatter((fm) => {
			if (next === 'inherit') {
				delete fm.access_scope;
				scopeSlug = '';
			} else if (scopeSlug) {
				fm.access_scope = scopeSlug;
			}
		});
	}

	async function onScopeSlug(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
		scopeSlug = v;
		if (scopeMode !== 'independent') return;
		await writeFrontmatter((fm) => {
			if (v) fm.access_scope = v;
			else delete fm.access_scope;
		});
	}

	async function onTeaser(e: Event) {
		teaser = (e.currentTarget as HTMLTextAreaElement).value;
		await writeFrontmatter((fm) => {
			if (teaser.trim()) fm.teaser = teaser;
			else delete fm.teaser;
		});
	}

	function openDashboard() {
		window.open(dashboardAccessUrl(), '_blank');
	}
</script>

<section class="adv-block">
	<header class="adv-block-head">
		<span class="adv-block-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12 20 3m0 0h-4M20 3v4"/></svg>
		</span>
		<div class="adv-block-text">
			<div class="adv-block-title">{t('ui.access_title')}</div>
			<div class="adv-block-desc">{t('ui.access_desc')}</div>
		</div>
	</header>
	<div class="adv-block-body">
		{#if !sourcePath}
			<p class="helper">{t('ui.access_no_target')}</p>
		{:else}
			{#if declaredIn}
				<p class="helper">{t('ui.access_target')}: {declaredIn}</p>
			{/if}

			<div class="access-row">
				<span class="access-label">{t('ui.access_protection')}</span>
				<div class="access-radios">
					<label class="access-radio">
						<input
							type="radio"
							name="mdf-access-prot"
							checked={protection === 'public'}
							disabled={loading || saving || isGuest}
							on:change={() => setProtection('public')}
						/>
						{t('ui.access_public')}
					</label>
					<label class="access-radio">
						<input
							type="radio"
							name="mdf-access-prot"
							checked={protection === 'protected'}
							disabled={loading || saving || isGuest}
							on:change={() => setProtection('protected')}
						/>
						{t('ui.access_protected')}
					</label>
				</div>
			</div>

			{#if protection === 'protected'}
				<div class="access-row">
					<span class="access-label">{t('ui.access_scope')}</span>
					<div class="access-radios">
						<label class="access-radio">
							<input
								type="radio"
								name="mdf-access-scope"
								checked={scopeMode === 'inherit'}
								disabled={loading || saving}
								on:change={() => setScopeMode('inherit')}
							/>
							{t('ui.access_scope_inherit')}
						</label>
						<label class="access-radio">
							<input
								type="radio"
								name="mdf-access-scope"
								checked={scopeMode === 'independent'}
								disabled={loading || saving}
								on:change={() => setScopeMode('independent')}
							/>
							{t('ui.access_scope_independent')}
						</label>
					</div>
				</div>
				{#if scopeMode === 'independent'}
					<input
						class="field-input"
						type="text"
						placeholder="skill"
						value={scopeSlug}
						disabled={loading || saving}
						on:change={onScopeSlug}
					/>
					<p class="helper">{t('ui.access_scope_hint')}</p>
				{/if}

				<label class="access-label" for="mdf-access-teaser">{t('ui.access_teaser')}</label>
				<textarea
					id="mdf-access-teaser"
					class="field-input"
					rows="2"
					placeholder={t('ui.access_teaser_placeholder')}
					value={teaser}
					disabled={loading || saving}
					on:change={onTeaser}
				></textarea>
			{/if}

			{#if protection === 'protected'}
				<p class="helper access-preview-hint">{t('ui.access_preview_hint')}</p>
			{/if}

			<button type="button" class="nav-links-add" on:click={openDashboard} disabled={!remoteProjectId && isGuest}>
				{t('ui.access_manage_keys')}
			</button>
			<p class="helper">{t('ui.access_keys_hint')}</p>
		{/if}
	</div>
</section>

<style>
	.access-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}
	.access-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.access-radios {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.access-radio {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	textarea.field-input {
		resize: vertical;
		min-height: 2.5rem;
	}
</style>
