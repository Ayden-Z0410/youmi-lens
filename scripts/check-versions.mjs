#!/usr/bin/env node
/**
 * Version synchronization gate (Phase 2E).
 *
 * The app version must be identical across every place a release depends on:
 *   - package.json               "version"
 *   - src-tauri/tauri.conf.json  "version"   (drives the built app + updater manifest)
 *   - src-tauri/Cargo.toml       [package] version
 *
 * Optionally validate a release tag too:  node scripts/check-versions.mjs --tag v0.1.9
 *
 * Exits non-zero (failing release preparation / CI) if any disagree. Prints only
 * versions — never secrets.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function pkgVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
}
function tauriConfVersion() {
  return JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version
}
function cargoVersion() {
  const txt = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')
  const pkgIdx = txt.indexOf('[package]')
  const scope = pkgIdx >= 0 ? txt.slice(pkgIdx) : txt
  const m = /^\s*version\s*=\s*"([^"]+)"/m.exec(scope)
  return m ? m[1] : null
}

export function collectVersions() {
  return {
    'package.json': pkgVersion(),
    'tauri.conf.json': tauriConfVersion(),
    'Cargo.toml': cargoVersion(),
  }
}

function main() {
  const versions = collectVersions()
  const values = Object.values(versions)
  const allEqual = values.every((v) => v && v === values[0])

  const tagArg = process.argv.indexOf('--tag')
  const tag = tagArg >= 0 ? String(process.argv[tagArg + 1] || '').replace(/^v/, '') : null

  console.log('Version check:')
  for (const [file, v] of Object.entries(versions)) console.log(`  ${file.padEnd(18)} ${v}`)
  if (tag) console.log(`  ${'--tag'.padEnd(18)} ${tag}`)

  if (!allEqual) {
    console.error('\n✗ Versions disagree across package.json / tauri.conf.json / Cargo.toml.')
    process.exit(1)
  }
  if (tag && tag !== values[0]) {
    console.error(`\n✗ Release tag (${tag}) does not match the app version (${values[0]}).`)
    process.exit(1)
  }
  console.log('\n✓ Versions are in sync.')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
