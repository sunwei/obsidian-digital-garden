<script lang="ts">
	/**
	 * Advanced ▸ Access keys — local enable toggle + active-key summary (details in Dashboard).
	 * Remote project id via RemoteProjectContext; local enable = intent, API count = readiness.
	 */
	import type FridayPlugin from '../main';
	import { dashboardAccessUrl, getAccessKeyStatus, type AccessKeyStatus } from '../access/access-service';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;
	export let projectName: string;
	export let isGuest: boolean;
	export let enabled = false;
	/** Last published/hydrated intent — differs from enabled ⇒ pending publish. */
	export let syncedEnabled = false;
	export let refreshKey = 0;
	export let onChange: (fields: { enabled: boolean }) => void = () => {};

	let status: AccessKeyStatus | null = null;
	let loading = false;
	let seq = 0;

	$: pendingPublish = !isGuest && enabled !== syncedEnabled;
	$: displayCount = !isGuest && enabled ? (status?.activeKeyCount ?? 0) : 0;
	$: boundId = status?.projectId ?? null;
	$: void load(projectName, isGuest, enabled, refreshKey);

	async function load(name: string, guest: boolean, on: boolean, _key: number) {
		const n = ++seq;
		if (guest || !name || !on) {
			status = null;
			return;
		}
		loading = true;
		try {
			const s = await getAccessKeyStatus(plugin, name);
			if (n === seq) status = s;
		} finally {
			if (n === seq) loading = false;
		}
	}

	function toggle() {
		if (isGuest) return;
		onChange({ enabled: !enabled });
	}

	function openDashboard() {
		window.open(dashboardAccessUrl(plugin, boundId), '_blank');
	}
</script>

<section class="adv-block mdf-access-settings">
	<header class="adv-block-head">
		<span class="adv-block-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="8" cy="15" r="4" />
				<path d="M11 12 20 3m0 0h-4M20 3v4" />
			</svg>
		</span>
		<div class="adv-block-text">
			<div class="adv-block-title">{t('ui.access_title')}</div>
			<div class="adv-block-desc">{t('ui.access_desc')}</div>
		</div>
		<div
			class="toggle"
			class:on={enabled && !isGuest}
			class:is-disabled={isGuest}
			role="switch"
			aria-checked={enabled && !isGuest}
			aria-disabled={isGuest}
			tabindex={isGuest ? -1 : 0}
			aria-label={t('ui.access_toggle')}
			on:click={toggle}
			on:keydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					toggle();
				}
			}}
		></div>
	</header>
	<div class="adv-block-body">
		{#if isGuest}
			<p class="helper lock">{t('ui.access_guest_hint')}</p>
		{:else}
			<p class="helper">{enabled ? t('ui.access_helper_on') : t('ui.access_helper')}</p>
			<div class="mdf-cap-stats">
				<div class="mdf-cap-stats-count">
					<div class="mdf-cap-stats-num">{loading && enabled ? '…' : displayCount}</div>
					<div class="mdf-cap-stats-label">{t('ui.access_total')}</div>
				</div>
				<div class="mdf-cap-stats-actions">
					<button
						type="button"
						class="adv-secondary-btn"
						on:click={openDashboard}
						disabled={!boundId}
						title={!boundId ? t('ui.access_count_unpublished') : undefined}
					>
						{t('ui.access_view_dashboard')}
					</button>
				</div>
			</div>
			{#if pendingPublish}
				<p class="helper mdf-cap-pending">{t('ui.access_pending_publish')}</p>
			{:else if enabled && !boundId && !loading}
				<p class="helper">{t('ui.access_count_unpublished')}</p>
			{/if}
		{/if}
	</div>
</section>

<style>
	.mdf-cap-stats {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
		padding: 12px 14px;
		border-radius: 10px;
		background: #f5f8ff;
		border: 1px solid #e3ebff;
		flex-wrap: wrap;
	}
	.mdf-cap-stats-num {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.1;
		color: var(--apple-text, #1d1d1f);
	}
	.mdf-cap-stats-label {
		margin-top: 2px;
		font-size: 11px;
		font-weight: 500;
		color: var(--apple-secondary, #86868b);
	}
	.mdf-cap-stats-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
