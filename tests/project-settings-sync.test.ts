// Run: npm test   (node --test, native TypeScript type stripping; Node >= 22.6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyProjectSettingsToConfig,
	extractProjectSettings,
	shouldReplaceCachedSettings,
	settingsFromProjectRow,
} from '../src/services/project-settings-payload.ts';

test('extract keeps sidebar fields and drops secrets and subscribe endpoint', () => {
	const settings = extractProjectSettings(
		{
			title: 'Garden',
			params: {
				logo: 'images/logo.png',
				favicon: 'images/icon.ico',
				navLinks: [{ title: 'About', url: '/about' }],
				subscribe: { enabled: true, title: 'Sub', description: 'Hi', endpoint: 'https://x', project: 'p1' },
				mdfriday: { family: 'quartz', variant: 'default' },
				search: true,
				password: 'nope',
				lastPublishUrl: 'https://share.example/s/abc/',
			},
		},
		'quartz',
	);
	assert.equal(settings.title, 'Garden');
	assert.deepEqual(settings.theme, {
		slug: 'quartz',
		family: 'quartz',
		variant: 'default',
		versionPolicy: 'follow-catalog',
	});
	assert.deepEqual(settings.branding, { logo: 'images/logo.png', favicon: 'images/icon.ico' });
	assert.deepEqual(settings.navLinks, [{ title: 'About', url: '/about' }]);
	assert.deepEqual(settings.subscribe, { enabled: true, title: 'Sub', description: 'Hi' });
	assert.deepEqual(settings.paramOverrides, { search: true });
});

test('apply writes title, brand paths, nav, and subscribe without endpoint', () => {
	const next = applyProjectSettingsToConfig(
		{ title: 'Old', params: { lastPublishUrl: 'https://keep.example/' } },
		{
			title: 'New',
			branding: { logo: 'img/logo.png' },
			navLinks: [{ title: 'A', url: '/a' }],
			subscribe: { enabled: true, title: 'S' },
			theme: { slug: 'flint', family: 'flint', variant: 'default', versionPolicy: 'follow-catalog' },
		},
	);
	assert.equal(next.title, 'New');
	const params = next.params as Record<string, unknown>;
	assert.equal(params.logo, 'img/logo.png');
	assert.deepEqual(params.navLinks, [{ title: 'A', url: '/a' }]);
	assert.equal(params.lastPublishUrl, 'https://keep.example/');
	assert.deepEqual(params.subscribe, { enabled: true, title: 'S' });
	assert.equal((params.mdfriday as { family: string }).family, 'flint');
});

test('cache is replaced only when remote revision is newer or local is missing', () => {
	assert.equal(shouldReplaceCachedSettings(null, 1), true);
	assert.equal(shouldReplaceCachedSettings(1, 1), false);
	assert.equal(shouldReplaceCachedSettings(1, 2), true);
	assert.equal(shouldReplaceCachedSettings(3, 2), false);
	assert.equal(shouldReplaceCachedSettings(1, null), false);
});

test('settingsFromProjectRow reads list payload fields', () => {
	assert.deepEqual(settingsFromProjectRow({ settingsRevision: 2, settings: { title: 'A' } }), {
		revision: 2,
		settings: { title: 'A' },
	});
	assert.equal(settingsFromProjectRow({ id: 'p1' }), null);
});
