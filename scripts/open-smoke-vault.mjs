#!/usr/bin/env node
/**
 * Open tests/smoke-vault in Obsidian via URI (macOS-friendly).
 * First open may still require "Open folder as vault" once if Obsidian has never seen the path.
 */
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vault = path.join(root, 'tests', 'smoke-vault')
if (!fs.existsSync(vault)) {
	console.error('Missing smoke vault at', vault)
	process.exit(1)
}

const encoded = encodeURIComponent(vault)
const uri = `obsidian://open?path=${encoded}`
console.log('Opening:', vault)
console.log('URI:', uri)

// Prefer Obsidian URI; fall back to open -a
const child = spawn('open', [uri], { stdio: 'inherit' })
child.on('exit', (code) => {
	if (code !== 0) {
		console.warn('URI open failed; trying open -a Obsidian …')
		spawn('open', ['-a', 'Obsidian', vault], { stdio: 'inherit' })
	}
})
