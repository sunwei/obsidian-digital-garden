import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyCommerceConfig,
	applyHostingParams,
	ensurePricingNavLink,
	formatSalesStatus,
	isPricingNavUrl,
	mdfridayService,
	planCommerceStubs,
	planContentOverlay,
	salesStatusFromOverview,
	stubMarkdown,
	vaultHasCommerceNote,
} from '../src/commerce/commerce-core.ts';

describe('commerce config (enable + services.mdfriday)', () => {
	it('writes project and endpoint under services.mdfriday', () => {
		const shell = mdfridayService('p_abc', 'https://api.fsky.top/');
		assert.equal(shell.project, 'p_abc');
		assert.equal(shell.endpoint, 'https://api.fsky.top');
	});

	it('applies enable + mdfriday and strips params.commerce', () => {
		const prev = mdfridayService('p_old', 'https://api.example');
		const config = {
			commerce: { enable: true },
			params: { commerce: { leftover: true }, title: 'x' },
			services: { mdfriday: prev },
		};
		const failed = applyCommerceConfig(config, null, true);
		assert.equal(failed.commerce.enable, true);
		assert.deepEqual(failed.services.mdfriday, prev);
		assert.equal('commerce' in failed.params, false);
		assert.equal(failed.params.title, 'x');

		const fresh = applyCommerceConfig(config, mdfridayService('p_new', 'https://api.example'), false);
		assert.equal(fresh.commerce.enable, true);
		assert.equal((fresh.services.mdfriday as { project: string }).project, 'p_new');
		assert.equal('commerce' in fresh.params, false);
	});

	it('does not auto-enable from site-params when commerce.enable is off', () => {
		const next = applyCommerceConfig(
			{ params: { navLinks: [] } },
			mdfridayService('p_1', 'https://api.example'),
			false,
		);
		assert.equal(next.commerce.enable, false);
		assert.equal(next.services.mdfriday, undefined);
	});

	it('keeps enable intent when site-params fails with no prior mdfriday', () => {
		const next = applyCommerceConfig(
			{ commerce: { enable: true }, params: { commerce: { leftover: true } } },
			null,
			true,
		);
		assert.equal(next.commerce.enable, true);
		assert.equal(next.services.mdfriday, undefined);
		assert.equal('commerce' in next.params, false);
	});

	it('clears connection when user disables selling', () => {
		const next = applyCommerceConfig(
			{
				commerce: { enable: true },
				services: { mdfriday: mdfridayService('p_old', 'https://api.example') },
			},
			mdfridayService('p_new', 'https://api.example'),
			false,
			{ enable: false },
		);
		assert.equal(next.commerce.enable, false);
		assert.equal(next.services.mdfriday, undefined);
	});

	it('sets params.mdf.hosting without dropping other mdf keys and strips commerce', () => {
		const next = applyHostingParams({ mdf: { foo: 1 }, commerce: { v: 1 } }, 'share');
		assert.deepEqual(next.mdf, { foo: 1, hosting: 'share' });
		assert.equal('commerce' in next, false);
	});

	it('upserts Pricing into navLinks when commerce enables', () => {
		const next = applyCommerceConfig(
			{ commerce: { enable: true }, params: { navLinks: [{ title: 'Docs', url: '/docs/' }] } },
			mdfridayService('p_1', 'https://api.example'),
			false,
			{ pricingNavTitle: '价格' },
		);
		assert.deepEqual(next.params.navLinks, [
			{ title: 'Docs', url: '/docs/' },
			{ title: '价格', url: '/pricing.html' },
		]);
	});

	it('does not overwrite an existing pricing navLink title', () => {
		const next = applyCommerceConfig(
			{
				commerce: { enable: true },
				params: {
					navLinks: [{ title: 'Plans', url: '/pricing.html' }],
				},
			},
			mdfridayService('p_1', 'https://api.example'),
			false,
			{ pricingNavTitle: 'Pricing' },
		);
		assert.deepEqual(next.params.navLinks, [{ title: 'Plans', url: '/pricing.html' }]);
	});
});

describe('pricing navLink helpers', () => {
	it('matches pricing urls', () => {
		assert.equal(isPricingNavUrl('/pricing.html'), true);
		assert.equal(isPricingNavUrl('/pricing/'), true);
		assert.equal(isPricingNavUrl('pricing'), true);
		assert.equal(isPricingNavUrl('/docs/'), false);
	});

	it('ensurePricingNavLink appends when missing', () => {
		assert.deepEqual(ensurePricingNavLink([], 'Pricing'), [
			{ title: 'Pricing', url: '/pricing.html' },
		]);
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
		assert.doesNotMatch(md, /unlisted:/);
	});

	it('marks purchase and pricing stubs unlisted for explorer/search', () => {
		assert.match(stubMarkdown('purchase'), /unlisted: true/);
		assert.match(stubMarkdown('pricing'), /unlisted: true/);
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
			formatSalesStatus({ canSell: true, offerCount: 3, ordersLast30d: 0, mode: 'live' }, labels),
			'Selling · 3 offers · live',
		);
	});

	it('reads canSell and counts from the overview payload', () => {
		const status = salesStatusFromOverview({
			canSell: true,
			counts: { offers: 2, ordersLast30d: 5 },
			activeConnection: { mode: 'test', status: 'active' },
		});
		assert.deepEqual(status, {
			canSell: true,
			offerCount: 2,
			ordersLast30d: 5,
			mode: 'test',
		});
	});

	it('treats canSell with zero offers as ready (not disabled)', () => {
		const status = salesStatusFromOverview({
			canSell: true,
			counts: { offers: 0 },
			activeConnection: { mode: 'live', status: 'active' },
		});
		assert.equal(status?.canSell, true);
		assert.equal(status?.offerCount, 0);
	});
});
