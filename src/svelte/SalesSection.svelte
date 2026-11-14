<script lang="ts">
	/**
	 * Advanced options ▸ Selling (read-only). Offers are managed in the Dashboard.
	 */
	import type FridayPlugin from '../main';
	import { dashboardSalesUrl, getSalesStatus } from '../commerce/commerce-service';
	import { formatSalesStatus, type SalesStatusLine } from '../commerce/commerce-core';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;
	export let remoteProjectId: string | null = null;
	export let isGuest: boolean;
	export let refreshKey = 0;

	let status: SalesStatusLine | null = null;
	let loading = false;
	let seq = 0;

	$: void load(remoteProjectId, isGuest, refreshKey);

	async function load(id: string | null, guest: boolean, _key: number) {
		const n = ++seq;
		if (guest || !id) {
			status = null;
			return;
		}
		loading = true;
		try {
			const s = await getSalesStatus(plugin, id);
			if (n === seq) status = s;
		} finally {
			if (n === seq) loading = false;
		}
	}

	$: line = formatSalesStatus(status, {
		selling: t('ui.adv_sales_selling'),
		offers: t('ui.adv_sales_offers'),
		disabled: t('ui.adv_sales_disabled'),
	});

	function openDashboard() {
		if (!remoteProjectId) return;
		window.open(dashboardSalesUrl(plugin, remoteProjectId), '_blank');
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
	</header>
	<div class="adv-block-body">
		{#if isGuest}
			<p class="helper">{t('ui.adv_sales_disabled')}</p>
		{:else}
			<p class="helper mdf-sales-line">{line}</p>
			<button
				type="button"
				class="nav-links-add"
				data-mdf-sales-dashboard
				on:click={openDashboard}
				disabled={!remoteProjectId}
			>
				{t('ui.adv_sales_manage')}
			</button>
			<p class="helper">{t('ui.adv_sales_hint')}</p>
		{/if}
	</div>
</section>
