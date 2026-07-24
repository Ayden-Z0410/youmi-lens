import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Guards that the app version is synchronized across every release-critical file.
 * (Mirrors scripts/check-versions.mjs so drift is caught by the frontend test run
 * too.) Phase 2E fixed package.json 0.0.0 → the real 0.1.8.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('version synchronization', () => {
  const pkg = JSON.parse(read('../../../package.json')).version as string
  const tauri = JSON.parse(read('../../../src-tauri/tauri.conf.json')).version as string
  const cargoTxt = read('../../../src-tauri/Cargo.toml')
  const cargo = (() => {
    const scope = cargoTxt.slice(cargoTxt.indexOf('[package]'))
    return /^\s*version\s*=\s*"([^"]+)"/m.exec(scope)?.[1] ?? null
  })()

  it('package.json, tauri.conf.json and Cargo.toml all report the same version', () => {
    expect(pkg).toBe(tauri)
    expect(cargo).toBe(tauri)
  })

  it('package.json is no longer the stale 0.0.0', () => {
    expect(pkg).not.toBe('0.0.0')
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
