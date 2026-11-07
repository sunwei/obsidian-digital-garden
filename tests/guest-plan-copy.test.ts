/**
 * Lock Guest plan marketing + first-paint fallbacks to current product:
 * 100 MB · unlimited sites · 7-day rolling expiry (no UTC midnight).
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

describe('Guest plan copy and fallbacks', () => {
	it('EN/ZH plan_guest_note: 7 days, no UTC', () => {
		const en = read('src/i18n/locales/en.ts');
		const zh = read('src/i18n/locales/zh-cn.ts');
		assert.match(en, /plan_guest_note:\s*"Guest links expire in 7 days \(claim Free to keep\)"/);
		assert.match(zh, /plan_guest_note:\s*"Guest 链接 7 天后失效（认领到 Free 可保留）"/);
		assert.equal(en.includes('UTC'), false);
		assert.equal(zh.includes('UTC'), false);
		assert.equal(en.includes('00:00'), false);
		assert.equal(zh.includes('00:00'), false);
	});

	it('plan sheet storage bullet stays 100 MB; sites unlimited', () => {
		const en = read('src/i18n/locales/en.ts');
		const zh = read('src/i18n/locales/zh-cn.ts');
		assert.match(en, /plan_guest_b3:\s*"100 MB storage"/);
		assert.match(zh, /plan_guest_b3:\s*"100 MB 存储"/);
		assert.match(en, /plan_guest_b_projects:\s*"Unlimited sites"/);
		assert.match(zh, /plan_guest_b_projects:\s*"站点不限"/);
	});

	it('PublishPanel first-paint fallbacks: 100MB guest / 200MB free / unlimited sites', () => {
		const panel = read('src/svelte/publish/PublishPanel.svelte');
		assert.match(panel, /planTier === 'guest'\s*\n\s*\? 100 \* 1024 \* 1024/);
		assert.match(panel, /planTier === 'free'\s*\n\s*\? 200 \* 1024 \* 1024/);
		assert.equal(panel.includes('5 * 1024 * 1024'), false);
		assert.equal(panel.includes('50 * 1024 * 1024'), false);
		// projectMax fallback is null (unlimited), not guest ? 1
		assert.equal(/planTier === 'guest' \? 1/.test(panel), false);
	});

	it('guest mint does not hardcode maxProjects to 1', () => {
		const src = read('src/services/project.ts');
		assert.equal(src.includes('mdfQuotaMaxProjects ?? 1'), false);
		assert.match(src, /mdfQuotaMaxProjects \?\? null/);
		assert.match(src, /mdfQuotaStorageBytes \?\?\s*100 \* 1024 \* 1024/);
	});
});
