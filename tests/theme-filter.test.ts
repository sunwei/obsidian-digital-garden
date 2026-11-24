// Run: npm test   (node --test, native TypeScript type stripping; Node >= 22.6)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	filterThemesForSelection,
	isFolderWikiTheme,
} from '../src/utils/theme-selection.ts';
import type { CatalogEntry } from '../src/theme/types.ts';

function entry(
	partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'slug' | 'family'>,
): CatalogEntry {
	return {
		variant: partial.slug,
		version: '1.0.0',
		name: partial.slug,
		packUrl: `https://example.com/${partial.slug}.zip`,
		kinds: ['wiki'],
		tags: [],
		tier: 'professional',
		access: 'free',
		entitled: true,
		lockReason: null,
		...partial,
	} as CatalogEntry;
}

describe('filterThemesForSelection (folder)', () => {
	it('keeps digital-garden kinds; excludes wiki-only book/notebook', () => {
		const themes = [
			entry({ slug: 'quartz', family: 'quartz', kinds: ['wiki', 'docs', 'digital-garden'] }),
			entry({ slug: 'creator', family: 'creator', kinds: ['wiki', 'digital-garden'] }),
			entry({ slug: 'flint', family: 'flint', kinds: ['wiki', 'docs', 'digital-garden'] }),
			entry({ slug: 'jasper', family: 'jasper', kinds: ['wiki', 'docs', 'digital-garden'] }),
			entry({
				slug: 'atlas',
				family: 'atlas',
				kinds: ['wiki', 'notebook', 'digital-garden'],
			}),
			entry({ slug: 'canopy', family: 'canopy', kinds: ['wiki', 'docs', 'digital-garden'] }),
			entry({ slug: 'folio', family: 'folio', kinds: ['wiki', 'docs', 'digital-garden'] }),
			entry({ slug: 'book', family: 'book', kinds: ['docs', 'wiki'] }),
			entry({ slug: 'notebook', family: 'notebook', kinds: ['wiki', 'docs'] }),
			entry({ slug: 'paper', family: 'notes', kinds: ['note'] }),
		];

		const folder = filterThemesForSelection(themes, 'folder');
		assert.deepEqual(
			folder.map((t) => t.slug).sort(),
			['atlas', 'canopy', 'creator', 'flint', 'folio', 'jasper', 'quartz'],
		);
		assert.equal(isFolderWikiTheme(entry({ slug: 'book', family: 'book' })), false);
		assert.equal(
			isFolderWikiTheme(
				entry({ slug: 'flint', family: 'flint', kinds: ['wiki', 'digital-garden'] }),
			),
			true,
		);
	});

	it('note selection uses note kind only', () => {
		const themes = [
			entry({ slug: 'paper', family: 'notes', kinds: ['note'] }),
			entry({ slug: 'news', family: 'notes', kinds: ['note', 'blog'] }),
			entry({ slug: 'quartz', family: 'quartz', kinds: ['wiki', 'digital-garden'] }),
		];
		const note = filterThemesForSelection(themes, 'note');
		assert.deepEqual(
			note.map((t) => t.slug).sort(),
			['news', 'paper'],
		);
	});
});
