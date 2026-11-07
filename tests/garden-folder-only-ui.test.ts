/**
 * Digital Garden UI: no publish-method / as-is picker; folder-only actions.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
	return readFileSync(join(root, rel), 'utf8');
}

describe('Garden folder-only publish UI', () => {
	it('PublishPanel has no Publish Method / as-is mode section', () => {
		const panel = read('src/svelte/publish/PublishPanel.svelte');
		assert.equal(panel.includes('ui.publish_method'), false);
		assert.equal(panel.includes('ui.mode_faithful'), false);
		assert.equal(panel.includes('showModeSwitch'), false);
		assert.equal(panel.includes('onSetMode'), false);
		assert.equal(panel.includes('card-modes'), false);
		assert.match(panel, /hasFolderTarget = selectionKind === 'folder' && hasContent/);
		assert.match(panel, /actionsDisabled = !hasFolderTarget \|\| building/);
		assert.match(panel, /theme_section_wiki/);
	});

	it('Site forces themed/wiki and rejects note publish paths', () => {
		const site = read('src/svelte/Site.svelte');
		assert.equal(site.includes('showModeSwitch'), false);
		assert.equal(site.includes('buildFaithfulToProject'), false);
		assert.match(site, /publishMode: PublishMode = 'themed'/);
		assert.match(site, /messages\.garden_folder_only/);
		assert.match(site, /hasFolderTarget = selectionKind === 'folder'/);
	});

	it('context menu registers folders only', () => {
		const main = read('src/main.ts');
		assert.match(main, /file instanceof TFolder/);
		assert.equal(/else if \(file instanceof TFile && file\.extension === 'md'\)\s*\{\s*this\.addPublishMenuItems/.test(main), false);
	});

	it('i18n drops publish_method / as-is mode strings; keeps garden_folder_only', () => {
		const en = read('src/i18n/locales/en.ts');
		const zh = read('src/i18n/locales/zh-cn.ts');
		assert.equal(en.includes('publish_method:'), false);
		assert.equal(zh.includes('publish_method:'), false);
		assert.equal(en.includes('mode_faithful:'), false);
		assert.equal(zh.includes('mode_faithful:'), false);
		assert.match(en, /garden_folder_only:/);
		assert.match(zh, /garden_folder_only:/);
	});
});
