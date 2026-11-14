/**
 * Vault-safe stub injection into the Foundry project workspace.
 * No Obsidian runtime imports — unit-testable in Node.
 */
import fs from 'fs';
import path from 'path';
import {
	COMMERCE_PAGE_SLUGS,
	overlayStatePath,
	planCommerceStubs,
	planContentOverlay,
	stubDirPath,
	stubMarkdown,
	type CommercePageSlug,
	type OverlayState,
} from './commerce-core.ts';

function listExistingNotes(sourceAbs: string): string[] {
	const found: string[] = [];
	for (const slug of COMMERCE_PAGE_SLUGS) {
		for (const rel of [`${slug}.md`, `${slug}/index.md`]) {
			try {
				if (fs.existsSync(path.join(sourceAbs, rel))) found.push(rel);
			} catch {
				// ignore
			}
		}
	}
	return found;
}

function readOverlayState(projectPath: string): OverlayState | null {
	try {
		const raw = fs.readFileSync(overlayStatePath(projectPath), 'utf8');
		const parsed = JSON.parse(raw) as OverlayState;
		if (parsed && parsed.v === 1 && typeof parsed.originalTarget === 'string') return parsed;
	} catch {
		// none
	}
	return null;
}

function writeOverlayState(projectPath: string, state: OverlayState): void {
	const file = overlayStatePath(projectPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

function writeStubFiles(projectPath: string, slugs: CommercePageSlug[], locale?: string): void {
	const dir = stubDirPath(projectPath);
	fs.mkdirSync(dir, { recursive: true });
	for (const slug of slugs) {
		fs.writeFileSync(path.join(dir, `${slug}.md`), stubMarkdown(slug, locale), 'utf8');
	}
}

function symlinkEntry(from: string, to: string): void {
	try {
		if (fs.existsSync(to) || fs.lstatSync(to).isSymbolicLink()) fs.rmSync(to, { recursive: true, force: true });
	} catch {
		try { fs.rmSync(to, { recursive: true, force: true }); } catch { /* */ }
	}
	fs.symlinkSync(from, to);
}

function applyStubsToContent(contentDir: string, projectPath: string, write: CommercePageSlug[], skip: CommercePageSlug[]): void {
	for (const slug of skip) {
		const stubFile = path.join(contentDir, `${slug}.md`);
		try {
			const st = fs.lstatSync(stubFile);
			if (st.isFile() && !st.isSymbolicLink()) fs.rmSync(stubFile);
		} catch {
			// absent
		}
	}
	for (const slug of write) {
		const dest = path.join(contentDir, `${slug}.md`);
		const src = path.join(stubDirPath(projectPath), `${slug}.md`);
		try {
			const st = fs.lstatSync(dest);
			if (st.isSymbolicLink()) continue; // vault note, already skipped in plan — belt and suspenders
		} catch {
			// missing
		}
		fs.copyFileSync(src, dest);
	}
}

function materializeOverlay(contentDir: string, target: string, projectPath: string, write: CommercePageSlug[], skip: CommercePageSlug[]): void {
	fs.rmSync(contentDir, { recursive: true, force: true });
	fs.mkdirSync(contentDir, { recursive: true });
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(target, { withFileTypes: true });
	} catch (e) {
		console.warn('[commerce] cannot read vault content folder', e);
	}
	for (const entry of entries) {
		if (entry.name === '.' || entry.name === '..') continue;
		symlinkEntry(path.join(target, entry.name), path.join(contentDir, entry.name));
	}
	applyStubsToContent(contentDir, projectPath, write, skip);
	writeOverlayState(projectPath, { v: 1, originalTarget: target, stubs: write });
}

function refreshOverlay(contentDir: string, target: string, projectPath: string, write: CommercePageSlug[], skip: CommercePageSlug[]): void {
	let desired = new Set<string>();
	try {
		desired = new Set(fs.readdirSync(target));
	} catch {
		desired = new Set();
	}
	const stubNames = new Set(write.map((s) => `${s}.md`));
	let current: string[] = [];
	try {
		current = fs.readdirSync(contentDir);
	} catch {
		current = [];
	}
	for (const name of current) {
		if (stubNames.has(name)) continue;
		if (desired.has(name)) continue;
		try {
			const st = fs.lstatSync(path.join(contentDir, name));
			if (st.isSymbolicLink()) fs.rmSync(path.join(contentDir, name), { force: true });
		} catch {
			// ignore
		}
	}
	for (const name of desired) {
		const dest = path.join(contentDir, name);
		if (fs.existsSync(dest) || (() => { try { fs.lstatSync(dest); return true; } catch { return false; } })()) {
			continue;
		}
		symlinkEntry(path.join(target, name), dest);
	}
	applyStubsToContent(contentDir, projectPath, write, skip);
	writeOverlayState(projectPath, { v: 1, originalTarget: target, stubs: write });
}

/**
 * Write build-time stub pages into the project workspace without touching the vault.
 * If `content/` is a symlink to the published folder, it is replaced with an overlay
 * directory (per-entry symlinks + real stub files) for the duration of subsequent builds.
 */
export async function ensureCommerceStubPages(input: {
	projectPath: string;
	locale?: string;
}): Promise<{ write: CommercePageSlug[]; skip: CommercePageSlug[]; kind: string }> {
	const contentDir = path.join(input.projectPath, 'content');
	let contentIsSymlink = false;
	let contentTarget: string | null = null;
	try {
		const st = fs.lstatSync(contentDir);
		contentIsSymlink = st.isSymbolicLink();
		if (contentIsSymlink) contentTarget = fs.realpathSync(contentDir);
	} catch {
		return { write: [], skip: [...COMMERCE_PAGE_SLUGS], kind: 'none' };
	}

	const overlay = readOverlayState(input.projectPath);
	const sourceAbs = contentIsSymlink ? contentTarget! : overlay?.originalTarget || contentDir;
	const existing = listExistingNotes(sourceAbs);
	const planned = planCommerceStubs(existing, '');
	writeStubFiles(input.projectPath, planned.write, input.locale);

	const plan = planContentOverlay({
		contentIsSymlink,
		contentTarget: contentTarget || overlay?.originalTarget,
		overlayActive: !!overlay && !contentIsSymlink,
		write: planned.write,
		skip: planned.skip,
	});

	if (plan.kind === 'none') return { ...planned, kind: plan.kind };
	if (plan.kind === 'write-into-dir') {
		applyStubsToContent(contentDir, input.projectPath, planned.write, planned.skip);
		return { ...planned, kind: plan.kind };
	}
	const target = plan.originalTarget || sourceAbs;
	if (plan.kind === 'materialize-overlay') {
		materializeOverlay(contentDir, target, input.projectPath, planned.write, planned.skip);
	} else {
		refreshOverlay(contentDir, target, input.projectPath, planned.write, planned.skip);
	}
	return { ...planned, kind: plan.kind };
}
