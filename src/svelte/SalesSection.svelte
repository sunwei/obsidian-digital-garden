<script lang="ts">
	/**
	 * Advanced ▸ Selling — local enable toggle + offer summary (details in Dashboard).
	 * Remote project id via RemoteProjectContext; local enable = intent, overview = readiness.
	 */
	import type FridayPlugin from '../main';
	import { dashboardSalesUrl, getSalesStatus } from '../commerce/commerce-service';
	import type { SalesStatusLine } from '../commerce/commerce-core';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;
	export let projectName: string;
	export let isGuest: boolean;
	/** From account `quota.features` (commerce) — Personal/Pro. */
	export let planAllows = false;
	export let enabled = false;
	/** Last published/hydrated commerce.enable. */
	export let syncedEnabled = false;
	export let refreshKey = 0;
	export let onChange: (fields: { enabled: boolean }) => void = () => {};

	let status: (SalesStatusLine & { projectId: string }) | null = null;
	let loading = false;
	let seq = 0;

	$: locked = isGuest || !planAllows;
	$: pendingPublish = !locked && enabled !== syncedEnabled;
	$: displayCount = !locked && enabled ? (status?.offerCount ?? 0) : 0;
	$: boundId = status?.projectId ?? null;
	$: void load(projectName, locked, enabled, refreshKey);

	async function load(name: string, lock: boolean, on: boolean, _key: number) {
		const n = ++seq;
		if (lock || !name || !on) {
			status = null;
			return;
		}
		loading = true;
		try {
			const s = await getSalesStatus(plugin, name);
			if (n === seq) status = s;
		} finally {
			if (n === seq) loading = false;
		}
	}

	function toggle() {
		if (locked) return;
		onChange({ enabled: !enabled });
	}

	function openDashboard() {
		if (!boundId) return;
		window.open(dashboardSalesUrl(plugin, boundId), '_blank');
	}
</script>

<section class="adv-block mdf-sales-settings">
	<header class="adv-block-head">
		<span class="adv-block-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="9" cy="20" r="1.5" />
				<circle cx="18" cy="20" r="1.5" />
				<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.5L22 8H7" />
			</svg>
		</span>
		<div class="adv-block-text">
			<div class="adv-block-title">{t('ui.adv_sales_title')}</div>
			<div class="adv-block-desc">{t('ui.adv_sales_desc')}</div>
		</div>
		<div
			class="toggle"
			class:on={enabled && !locked}
			class:is-disabled={locked}
			role="switch"
			aria-checked={enabled && !locked}
			aria-disabled={locked}
			tabindex={locked ? -1 : 0}
			aria-label={t('ui.adv_sales_toggle')}
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
			<p class="helper lock">{t('ui.adv_sales_guest_hint')}</p>
		{:else if !planAllows}
			<p class="helper lock">{t('ui.adv_sales_plan_hint')}</p>
		{:else}
			<p class="helper">{enabled ? t('ui.adv_sales_helper_on') : t('ui.adv_sales_helper')}</p>
			<div class="mdf-cap-stats">
				<div class="mdf-cap-stats-count">
					<div class="mdf-cap-stats-num">{loading && enabled ? '…' : displayCount}</div>
					<div class="mdf-cap-stats-label">{t('ui.adv_sales_total')}</div>
				</div>
				<div class="mdf-cap-stats-actions">
					<button
						type="button"
						class="adv-secondary-btn"
						data-mdf-sales-dashboard
						on:click={openDashboard}
						disabled={!boundId}
						title={!boundId ? t('ui.adv_sales_count_unpublished') : undefined}
					>
						{t('ui.adv_sales_view_dashboard')}
					</button>
				</div>
			</div>
			{#if pendingPublish}
				<p class="helper mdf-cap-pending">{t('ui.adv_sales_pending_publish')}</p>
			{:else if enabled && !boundId && !loading}
				<p class="helper">{t('ui.adv_sales_count_unpublished')}</p>
			{:else if enabled && status && !status.canSell}
				<p class="helper">{t('ui.adv_sales_setup_hint')}</p>
			{:else if enabled && status?.ordersLast30d != null && status.ordersLast30d > 0}
				<p class="helper">{t('ui.adv_sales_orders', { n: status.ordersLast30d })}</p>
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
