/**
 * Access contract (no Obsidian runtime):
 * sidebar has no Access settings editor; Dashboard manage-keys link remains;
 * protection is page frontmatter only; no legacy password fields.
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
	it('AccessSection.svelte is removed (no sidebar access editor)', () => {
		assert.equal(
			existsSync(join(root, 'src/svelte/AccessSection.svelte')),
			false,
			'AccessSection.svelte must be deleted',
		);
	});

	it('PublishPanel keeps Dashboard manage-keys link and does not write access frontmatter', () => {
		const panel = read('src/svelte/publish/PublishPanel.svelte');
		assert.doesNotMatch(panel, /AccessSection/);
		assert.doesNotMatch(panel, /mdf-access-prot/);
		assert.doesNotMatch(panel, /mdf-access-teaser/);
		assert.doesNotMatch(panel, /fm\.access/);
		assert.doesNotMatch(panel, /access_scope/);
		assert.doesNotMatch(panel, /Access password/);
		assert.doesNotMatch(panel, /sitePassword/);
		assert.match(panel, /dashboard\/access\//);
		assert.match(panel, /data-mdf-access-dashboard|access_manage_keys/);
		assert.match(panel, /data-mdf-access-keys/);
		assert.match(panel, /resolveSiteBaseUrl/);
	});

	it('legacy encrypt.ts is removed from AS preview path', () => {
		const idx = read('src/obsidian-local-preview/index.ts');
		assert.doesNotMatch(idx, /encryptAESGCM|buildEncryptGateHtml|password\?:/);
		assert.equal(existsSync(join(root, 'src/obsidian-local-preview/encrypt.ts')), false);
	});

	it('i18n keeps manage-keys copy and drops sidebar editor strings', () => {
		const en = read('src/i18n/locales/en.ts');
		assert.match(en, /access_title:/);
		assert.match(en, /access_manage_keys:/);
		assert.match(en, /access_page_hint:/);
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
