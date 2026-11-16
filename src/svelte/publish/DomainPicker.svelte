<script lang="ts">
	import { Notice, type EventRef, type Events } from 'obsidian';
	import { onDestroy, onMount } from 'svelte';
	import type {
		ObsidianCustomDomain,
		ObsidianDomainSelection,
		ObsidianProjectDomains,
	} from '@mdfriday/core';
	import type FridayPlugin from '../../main';
	import { confirmMoveDomain } from '../../settings/domains/move-domain-modal';
	import {
		isApexHost,
		notifyDomainsChanged,
		selectionDiffersFromServer,
		uiT,
		type DomainSelectionInfo,
	} from '../../settings/domains/domain-view';

	export let plugin: FridayPlugin;
	export let projectName: string;
	/** Remote project id (p_…) once published; null before the first publish. */
	export let remoteProjectId: string | null = null;
	/** Bump to force a reload (account change, publish finished). */
	export let refreshKey = 0;
	export let onSelectionChanged: ((info: DomainSelectionInfo) => void) | undefined = undefined;

	const uid = Math.random().toString(36).slice(2, 8);
	const t = uiT(plugin);

	let loaded = false;
	let loading = false;
	let busy = false;
	let loadError = '';
	let usable: ObsidianCustomDomain[] = [];
	let selection: ObsidianDomainSelection | null = null;
	let bound: ObsidianProjectDomains | null = null;
	let needsRepublish = false;
	let loadSeq = 0;

	$: pending = selection ? selectionDiffersFromServer(selection, bound) : false;

	let lastKey = '';
	$: {
		const key = `${projectName}|${remoteProjectId ?? ''}|${refreshKey}`;
		if (key !== lastKey) {
			lastKey = key;
			void load();
		}
	}

	let eventRef: EventRef | null = null;
	onMount(() => {
		// Workspace's typed `on` overloads do not list custom event names; Events#on does.
		eventRef = (plugin.app.workspace as Events).on('friday:domains-changed', () => void load());
	});
	onDestroy(() => {
		if (eventRef) (plugin.app.workspace as Events).offref(eventRef);
	});

	function emit(): void {
		if (!selection) return;
		const primary = usable.find((d) => d.id === selection?.primaryDomainId);
		onSelectionChanged?.({
			isShare: selection.isShare,
			primaryHostname: primary?.hostname ?? null,
			pending: selectionDiffersFromServer(selection, bound),
			hasMoves: selection.allowMoveFrom.length > 0,
		});
	}

	async function load(): Promise<void> {
		const service = plugin.foundryCustomDomainService;
		if (!service || !projectName) {
			selection = null;
			usable = [];
			loaded = true;
			return;
		}
		const seq = ++loadSeq;
		loading = true;
		loadError = '';
		plugin.syncCloudflareSession();
		const [list, sel, forProject, remote] = await Promise.all([
			service.list(),
			service.getSelection(projectName, remoteProjectId),
			remoteProjectId ? service.forProject(remoteProjectId) : Promise.resolve(null),
			remoteProjectId && plugin.foundryRemoteProjectService
				? plugin.foundryRemoteProjectService.get(remoteProjectId)
				: Promise.resolve(null),
		]);
		if (seq !== loadSeq) return;
		loading = false;
		loaded = true;
		if (!list.success || !list.data) {
			usable = [];
			selection = sel.success && sel.data ? sel.data : null;
			// Not signed in yet is not an error for the picker — it just has nothing to list.
			loadError = list.code === 'unauthenticated' ? '' : (list.error ?? '');
			return;
		}
		usable = list.data.filter((d) => d.usable);
		selection = sel.success && sel.data ? sel.data : null;
		bound = forProject?.success && forProject.data ? forProject.data : null;
		const project = remote?.success ? remote.data : undefined;
		const offline = project?.status
			? ['unpublished', 'draft', 'deleted'].includes(project.status)
			: false;
		needsRepublish =
			!!project && project.hostingMode === 'custom' && !offline && !!bound && bound.domains.length === 0;
		emit();
	}

	async function toggle(domain: ObsidianCustomDomain, on: boolean, target: HTMLInputElement) {
		const service = plugin.foundryCustomDomainService;
		if (!service || busy) return;
		busy = true;
		const res = await service.toggleDomain(projectName, domain.id, on, remoteProjectId, {
			currentWorkspaceId: plugin.getWorkspaceId(),
			confirmMove: (impact) => confirmMoveDomain(plugin, domain.hostname, impact),
		});
		busy = false;
		if (!res.success || !res.data) {
			new Notice(t('domains_action_failed', { error: res.error || 'unknown' }), 5000);
		} else {
			selection = res.data;
			emit();
		}
		// A cancelled move leaves the selection unchanged — put the checkbox back.
		target.checked = !!selection?.domainIds.includes(domain.id);
	}

	async function makePrimary(domain: ObsidianCustomDomain) {
		const service = plugin.foundryCustomDomainService;
		if (!service || busy) return;
		busy = true;
		const res = await service.setPrimary(projectName, domain.id);
		busy = false;
		if (!res.success || !res.data) {
			new Notice(t('domains_action_failed', { error: res.error || 'unknown' }), 5000);
			return;
		}
		selection = res.data;
		emit();
	}

	// Takes `sel` / `ownId` as arguments so the template re-evaluates when they change.
	function usedByLabel(
		domain: ObsidianCustomDomain,
		sel: ObsidianDomainSelection | null,
		ownId: string | null,
	): string {
		if (!domain.boundProject) return t('domains_unbound');
		if (domain.projectId === ownId) return '';
		if (sel?.allowMoveFrom.includes(domain.id)) {
			return t('domains_moves_on_publish', { title: domain.boundProject.title });
		}
		const base = t('domains_used_by', { title: domain.boundProject.title });
		return domain.isPrimary ? `${base} (${t('domains_primary').toLowerCase()})` : base;
	}

	function openSettings(): void {
		plugin.openSettingsTab();
	}
</script>

<div class="domain-picker">
	{#if !loaded && loading}
		<p class="helper">{t('domains_picker_loading')}</p>
	{:else}
		{#if needsRepublish}
			<p class="helper warn">{t('domains_site_needs_republish')}</p>
		{/if}
		{#if loadError}
			<p class="helper warn">{t('domains_load_failed', { error: loadError })}</p>
		{/if}
		{#if usable.length === 0 && !loadError}
			<p class="helper">{t('domains_picker_empty')}</p>
		{:else}
			<ul class="dp-list">
				{#each usable as domain (domain.id)}
					{@const checked = !!selection?.domainIds.includes(domain.id)}
					{@const isPrimary = selection?.primaryDomainId === domain.id}
					{@const apex = isApexHost(domain.hostname)}
					{@const meta = usedByLabel(domain, selection, remoteProjectId)}
					<li class="dp-row">
						<label class="dp-check">
							<input
								type="checkbox"
								{checked}
								disabled={busy}
								on:change={(e) => toggle(domain, e.currentTarget.checked, e.currentTarget)}
							/>
							<span class="dp-host">{domain.hostname}</span>
						</label>
						<label
							class="dp-primary"
							class:is-disabled={!checked || apex}
							title={apex ? t('domains_apex_no_primary') : t('domains_set_primary')}
						>
							<input
								type="radio"
								name={`dp-primary-${uid}`}
								checked={isPrimary}
								disabled={busy || !checked || apex}
								on:change={() => makePrimary(domain)}
							/>
							{#if isPrimary}<span class="dp-primary-text">{t('domains_primary')}</span>{/if}
						</label>
						{#if meta}
							<span class="dp-meta">{meta}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if pending}
			<p class="helper dp-pending">{t('domains_pending_publish')}</p>
		{/if}
		<button type="button" class="dp-manage" on:click={openSettings}>
			{t('domains_manage')}
		</button>
	{/if}
</div>

<style>
	.dp-list {
		list-style: none;
		margin: 0 0 6px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.dp-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: 12px;
	}

	.dp-check {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1 1 auto;
	}

	.dp-host {
		overflow-wrap: anywhere;
	}

	.dp-primary {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-muted);
	}

	.dp-primary.is-disabled {
		opacity: 0.5;
	}

	.dp-primary-text {
		font-size: 11px;
		color: var(--text-accent);
	}

	.dp-meta {
		flex-basis: 100%;
		padding-left: 22px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.dp-pending {
		color: var(--text-accent);
	}

	.dp-manage {
		display: block;
		margin: 4px 0 0;
		padding: 0;
		border: none;
		background: none;
		box-shadow: none;
		color: var(--interactive-accent);
		font-size: 12px;
		cursor: pointer;
	}
</style>
