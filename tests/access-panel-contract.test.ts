/**
 * Obsidian Access panel contract (no Obsidian runtime):
 * frontmatter shape the panel writes, Dashboard deep-link, no legacy password fields.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Access panel contract', () => {
  it('AccessSection writes access / access_scope / teaser and links Dashboard', () => {
    const src = read('src/svelte/AccessSection.svelte');
    assert.match(src, /fm\.access = 'protected'/);
    assert.match(src, /fm\.access_scope/);
    assert.match(src, /fm\.teaser/);
    assert.match(src, /dashboard\/access\//);
    assert.doesNotMatch(src, /params\.password/);
    assert.doesNotMatch(src, /sitePassword/);
  });

  it('PublishPanel mounts AccessSection instead of password UI', () => {
    const panel = read('src/svelte/publish/PublishPanel.svelte');
    assert.match(panel, /AccessSection/);
    assert.doesNotMatch(panel, /Access password/);
    assert.doesNotMatch(panel, /sitePassword/);
  });

  it('legacy encrypt.ts is removed from AS preview path', () => {
    const idx = read('src/obsidian-local-preview/index.ts');
    assert.doesNotMatch(idx, /encryptAESGCM|buildEncryptGateHtml|password\?:/);
    let missing = false;
    try {
      read('src/obsidian-local-preview/encrypt.ts');
    } catch {
      missing = true;
    }
    assert.equal(missing, true);
  });

  it('i18n exposes access_* strings and drops site_password_placeholder', () => {
    const en = read('src/i18n/locales/en.ts');
    assert.match(en, /access_title:/);
    assert.match(en, /access_protected:/);
    assert.match(en, /access_manage_keys:/);
    assert.doesNotMatch(en, /site_password_placeholder/);
  });

  it('scope slug normalization matches panel rules', () => {
    const normalize = (v: string) =>
      v.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    assert.equal(normalize('Skill Pack'), 'skill-pack');
    assert.equal(normalize('book_new'), 'book-new');
  });
});
