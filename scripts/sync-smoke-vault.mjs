#!/usr/bin/env node
/**
 * Sync Garden build artifacts into tests/smoke-vault for real Obsidian smoke.
 *
 * - main.js / styles.css → relative symlinks to repo root (after staging build)
 * - manifest.json → file copy (small; safe to track in git)
 *
 * Usage: npm run build:smoke   # staging build + this script
 *    or: npm run sync:smoke-vault  # after an existing root build
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pluginDir = path.join(root, 'tests', 'smoke-vault', '.obsidian', 'plugins', 'mdfriday-garden')

function rmIfPresent(p) {
	try {
		fs.lstatSync(p)
		fs.rmSync(p, { force: true })
	} catch {
		/* absent */
	}
}

function requireFile(name) {
	const src = path.join(root, name)
	if (!fs.existsSync(src)) {
		throw new Error(`Missing build artifact: ${src}\nRun: MDF_CF_ENV=staging npm run build`)
	}
	return src
}

fs.mkdirSync(pluginDir, { recursive: true })
rmIfPresent(path.join(pluginDir, '.gitkeep'))

const results = []

for (const name of ['main.js', 'styles.css']) {
	const src = requireFile(name)
	const dest = path.join(pluginDir, name)
	rmIfPresent(dest)
	const rel = path.relative(pluginDir, src)
	try {
		fs.symlinkSync(rel, dest)
		results.push(`symlink ${name} → ${rel}`)
	} catch (err) {
		fs.copyFileSync(src, dest)
		results.push(`copy ${name} (symlink failed: ${err.message})`)
	}
}

{
	const src = requireFile('manifest.json')
	const dest = path.join(pluginDir, 'manifest.json')
	rmIfPresent(dest)
	fs.copyFileSync(src, dest)
	results.push('copy manifest.json')
}

console.log('✓ Smoke vault plugin synced:')
for (const line of results) console.log(`  ${line}`)
console.log(`  → ${pluginDir}`)
