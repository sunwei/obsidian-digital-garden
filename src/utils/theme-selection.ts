import type { CatalogEntry } from '../theme/types';

/** Catalog kind for Obsidian folder / digital-garden skins (see theme-focus digital-garden). */
export const DIGITAL_GARDEN_KIND = 'digital-garden';

/** Catalog kind for single-note skins. */
export const NOTE_KIND = 'note';

function hasKind(theme: CatalogEntry, kind: string): boolean {
	return (theme.kinds ?? []).some((k) => String(k).toLowerCase() === kind);
}

/** Folder publish: themes tagged `digital-garden` (not plain `wiki` — book/notebook stay out). */
export function isFolderWikiTheme(theme: CatalogEntry): boolean {
	return hasKind(theme, DIGITAL_GARDEN_KIND);
}

/** Sidebar theme list: `note` kind for a single note; `digital-garden` for a folder. */
export function filterThemesForSelection(
	themes: CatalogEntry[],
	kind: 'note' | 'folder',
): CatalogEntry[] {
	const withPack = themes.filter((t) => !!t.packUrl);
	if (kind === 'folder') {
		return withPack.filter(isFolderWikiTheme);
	}
	return withPack.filter((t) => hasKind(t, NOTE_KIND));
}
