/**
 * Access contract (no Obsidian runtime):
 * Advanced panel has Access keys capability (toggle + stats → Dashboard);
 * protection is page frontmatter only; no legacy password / teaser editors in the sidebar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
	return readFileSync(join(root, rel), 'utf8');
}

describe('Access panel contract', () => {
	it('AccessSection.svelte is the Advanced capability card (toggle + stats)', () => {
		assert.equal(existsSync(join(root, 'src/svelte/AccessSection.svelte')), true);
		const section = read('src/svelte/AccessSection.svelte');
		assert.match(section, /getAccessKeyStatus/);
		assert.match(section, /dashboardAccessUrl|access_view_dashboard/);
		assert.match(section, /pendingPublish|access_pending_publish/);
		assert.doesNotMatch(section, /mdf-access-prot/);
		assert.doesNotMatch(section, /fm\.access/);
		assert.doesNotMatch(section, /sitePassword/);
	});

	it('PublishPanel wires AccessSection and does not write access frontmatter', () => {
		const panel = read('src/svelte/publish/PublishPanel.svelte');
		assert.match(panel, /AccessSection/);
		assert.doesNotMatch(panel, /mdf-access-prot/);
		assert.doesNotMatch(panel, /mdf-access-teaser/);
		assert.doesNotMatch(panel, /fm\.access/);
		assert.doesNotMatch(panel, /access_scope/);
		assert.doesNotMatch(panel, /Access password/);
		assert.doesNotMatch(panel, /sitePassword/);
	});

	it('access-service resolves remote id via RemoteProjectContext', () => {
		const svc = read('src/access/access-service.ts');
		assert.match(svc, /resolveRemoteProjectId/);
		assert.match(svc, /dashboard\/access\//);
	});

	it('legacy encrypt.ts is removed from AS preview path', () => {
		const idx = read('src/obsidian-local-preview/index.ts');
		assert.doesNotMatch(idx, /encryptAESGCM|buildEncryptGateHtml|password\?:/);
		assert.equal(existsSync(join(root, 'src/obsidian-local-preview/encrypt.ts')), false);
	});

	it('i18n keeps manage-keys / pending-publish copy and drops sidebar editor strings', () => {
		const en = read('src/i18n/locales/en.ts');
		assert.match(en, /access_title:/);
		assert.match(en, /access_manage_keys:/);
		assert.match(en, /access_page_hint:/);
		assert.match(en, /access_pending_publish:/);
		assert.doesNotMatch(en, /access_protected:/);
		assert.doesNotMatch(en, /access_scope_inherit:/);
		assert.doesNotMatch(en, /access_teaser_placeholder:/);
		assert.doesNotMatch(en, /site_password_placeholder/);
	});

	it('scope slug normalization (page frontmatter convention)', () => {
		const normalize = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
		assert.equal(normalize('Skill Pack'), 'skill-pack');
		assert.equal(normalize('book_new'), 'book-new');
	});
});
