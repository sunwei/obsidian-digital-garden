import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyCommerceParams,
	applyHostingParams,
	commerceShell,
	formatSalesStatus,
	planCommerceStubs,
	planContentOverlay,
	salesStatusFromOverview,
	stubMarkdown,
	vaultHasCommerceNote,
} from '../src/commerce/commerce-core.ts';

describe('commerce shell params', () => {
	it('writes project, endpoint, and fixed page paths', () => {
		const shell = commerceShell('p_abc', 'https://api.fsky.top/');
		assert.equal(shell.project, 'p_abc');
		assert.equal(shell.endpoint, 'https://api.fsky.top');
		assert.deepEqual(shell.pages, {
			purchase: '/purchase.html',
			pricing: '/pricing.html',
			privacy: '/privacy.html',
		});
	});

	it('keeps the last successful shell when the request fails', () => {
		const prev = commerceShell('p_old', 'https://api.example');
		const params = { commerce: prev, title: 'x' };
		const failed = applyCommerceParams(params, null, true);
		assert.equal(failed.commerce, prev);
		const fresh = applyCommerceParams(params, commerceShell('p_new', 'https://api.example'), false);
		assert.equal((fresh.commerce as { project: string }).project, 'p_new');
	});

	it('sets params.mdf.hosting without dropping other mdf keys', () => {
		const next = applyHostingParams({ mdf: { foo: 1 } }, 'share');
		assert.deepEqual(next.mdf, { foo: 1, hosting: 'share' });
	});
});

describe('vault no-overwrite stubs', () => {
	it('skips slugs that already exist in the published folder', () => {
		const files = ['Garden/privacy.md', 'Garden/Notes/x.md'];
		const plan = planCommerceStubs(files, 'Garden');
		assert.deepEqual(plan.skip, ['privacy']);
		assert.deepEqual(plan.write, ['purchase', 'pricing']);
		assert.equal(vaultHasCommerceNote(files, 'Garden', 'purchase'), false);
	});

	it('does not treat a same-named note in a subfolder as the site page', () => {
		const plan = planCommerceStubs(['Garden/notes/privacy.md'], 'Garden');
		assert.ok(plan.write.includes('privacy'));
	});

	it('writes front matter stubs with layout and the stub flag', () => {
		const md = stubMarkdown('privacy', 'zh-CN');
		assert.match(md, /^---\n/);
		assert.match(md, /title: 数据与隐私/);
		assert.match(md, /layout: privacy/);
		assert.match(md, /mdf_commerce_stub: true/);
	});
});

describe('content overlay plan', () => {
	it('materializes an overlay when content is a vault symlink', () => {
		const plan = planContentOverlay({
			contentIsSymlink: true,
			contentTarget: '/vault/Garden',
			overlayActive: false,
			write: ['purchase', 'pricing', 'privacy'],
			skip: [],
		});
		assert.equal(plan.kind, 'materialize-overlay');
		assert.equal(plan.originalTarget, '/vault/Garden');
	});

	it('does nothing when every page already exists in the vault and no overlay is active', () => {
		const plan = planContentOverlay({
			contentIsSymlink: true,
			contentTarget: '/vault/Garden',
			overlayActive: false,
			write: [],
			skip: ['purchase', 'pricing', 'privacy'],
		});
		assert.equal(plan.kind, 'none');
	});
});

describe('sales status line', () => {
	it('formats selling vs disabled', () => {
		const labels = { selling: 'Selling', offers: '{n} offers', disabled: 'Not enabled (manage in Dashboard)' };
		assert.equal(formatSalesStatus(null, labels), labels.disabled);
		assert.equal(
			formatSalesStatus({ selling: true, offerCount: 3, mode: 'live' }, labels),
			'Selling · 3 offers · live',
		);
	});

	it('reads canSell and counts from the overview payload', () => {
		const status = salesStatusFromOverview({
			canSell: true,
			counts: { offers: 2 },
			activeConnection: { mode: 'test', status: 'active' },
		});
		assert.deepEqual(status, { selling: true, offerCount: 2, mode: 'test' });
	});
});
