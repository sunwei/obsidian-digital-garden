import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ensureCommerceStubPages } from '../src/commerce/commerce-pages.ts';

describe('ensureCommerceStubPages (vault no-overwrite)', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'mdf-commerce-overlay-'));
	after(() => rmSync(root, { recursive: true, force: true }));

	it('does not write stubs into the vault when content is a symlink; keeps an existing privacy.md', async () => {
		const vault = path.join(root, 'vault');
		const project = path.join(root, 'project');
		mkdirSync(vault, { recursive: true });
		mkdirSync(path.join(project, 'content'), { recursive: true });
		writeFileSync(path.join(vault, 'index.md'), '# Garden\n');
		const privacy = '---\ntitle: Ours\n---\nAuthor privacy page.\n';
		writeFileSync(path.join(vault, 'privacy.md'), privacy);
		rmSync(path.join(project, 'content'), { recursive: true, force: true });
		symlinkSync(vault, path.join(project, 'content'));

		const result = await ensureCommerceStubPages({ projectPath: project, locale: 'en' });
		assert.deepEqual(result.skip, ['privacy']);
		assert.ok(result.write.includes('purchase'));
		assert.ok(result.write.includes('pricing'));
		assert.equal(existsSync(path.join(vault, 'purchase.md')), false);
		assert.equal(existsSync(path.join(vault, 'pricing.md')), false);
		assert.equal(readFileSync(path.join(vault, 'privacy.md'), 'utf8'), privacy);

		const content = path.join(project, 'content');
		assert.equal(lstatSync(content).isSymbolicLink(), false);
		assert.equal(existsSync(path.join(content, 'purchase.md')), true);
		assert.match(readFileSync(path.join(content, 'purchase.md'), 'utf8'), /layout: purchase/);
		assert.equal(lstatSync(path.join(content, 'privacy.md')).isSymbolicLink(), true);
		assert.equal(lstatSync(path.join(content, 'index.md')).isSymbolicLink(), true);
	});
});
