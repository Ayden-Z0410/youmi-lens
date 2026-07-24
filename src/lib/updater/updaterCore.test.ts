import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  isNewerVersion,
  tauriTargetFor,
  selectUpdate,
  canInstallUpdate,
  sanitizeUpdaterError,
  updaterEntryVisible,
  updaterStatusLabel,
  type UpdateManifest,
} from './updaterCore'

const manifest = (over: Partial<UpdateManifest> = {}): UpdateManifest => ({
  version: '0.2.0',
  notes: 'Fixes long-recording save.',
  pub_date: '2026-07-24T00:00:00Z',
  platforms: {
    'darwin-aarch64': { signature: 'sig-mac-arm', url: 'https://youmilens.com/rel/0.2.0/mac-arm.app.tar.gz' },
    'darwin-x86_64': { signature: 'sig-mac-intel', url: 'https://youmilens.com/rel/0.2.0/mac-intel.app.tar.gz' },
    'windows-x86_64': { signature: 'sig-win', url: 'https://youmilens.com/rel/0.2.0/win-setup.nsis.zip' },
  },
  ...over,
})

describe('semver comparison (downgrade prevention)', () => {
  it('detects strictly newer versions only', () => {
    expect(isNewerVersion('0.2.0', '0.1.8')).toBe(true)
    expect(isNewerVersion('0.1.9', '0.1.8')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('0.1.8', '0.1.8')).toBe(false) // same → no update
    expect(isNewerVersion('0.1.7', '0.1.8')).toBe(false) // older → never downgrade
  })
  it('orders correctly and tolerates prefixes/prerelease', () => {
    expect(compareSemver('v0.1.8', '0.1.8')).toBe(0)
    expect(compareSemver('0.2.0-beta.1', '0.1.8')).toBe(1)
  })
})

describe('platform/arch target selection (never cross platforms)', () => {
  it('maps Mac and Windows correctly', () => {
    expect(tauriTargetFor('macos', 'aarch64')).toBe('darwin-aarch64')
    expect(tauriTargetFor('darwin', 'x86_64')).toBe('darwin-x86_64')
    expect(tauriTargetFor('windows', 'x86_64')).toBe('windows-x86_64')
  })
  it('returns null for unsupported combos', () => {
    expect(tauriTargetFor('macos', 'ppc')).toBeNull()
    expect(tauriTargetFor('android', 'arm64')).toBeNull()
  })
})

describe('update selection', () => {
  it('selects the correct signed Mac artifact for a newer version', () => {
    const r = selectUpdate(manifest(), '0.1.8', 'darwin-aarch64')
    expect(r.available).toBe(true)
    if (r.available) {
      expect(r.url).toContain('mac-arm')
      expect(r.signature).toBe('sig-mac-arm')
      expect(r.version).toBe('0.2.0')
    }
  })
  it('selects the correct Windows artifact', () => {
    const r = selectUpdate(manifest(), '0.1.8', 'windows-x86_64')
    expect(r.available).toBe(true)
    if (r.available) expect(r.url).toContain('win-setup')
  })
  it('returns no update when current is latest', () => {
    expect(selectUpdate(manifest(), '0.2.0', 'darwin-aarch64')).toMatchObject({ available: false, reason: 'up_to_date' })
  })
  it('never offers a downgrade', () => {
    expect(selectUpdate(manifest({ version: '0.1.0' }), '0.1.8', 'darwin-aarch64')).toMatchObject({ available: false })
  })
  it('rejects a missing signature (no unsigned fallback)', () => {
    const m = manifest()
    m.platforms['darwin-aarch64'].signature = ''
    expect(selectUpdate(m, '0.1.8', 'darwin-aarch64')).toMatchObject({ available: false, reason: 'missing_signature' })
  })
  it('rejects a non-https artifact URL', () => {
    const m = manifest()
    m.platforms['darwin-aarch64'].url = 'http://insecure/mac.tar.gz'
    expect(selectUpdate(m, '0.1.8', 'darwin-aarch64')).toMatchObject({ available: false, reason: 'insecure_url' })
  })
  it('does not point a platform at a missing artifact', () => {
    expect(selectUpdate(manifest(), '0.1.8', 'windows-aarch64')).toMatchObject({ available: false, reason: 'no_artifact_for_platform' })
  })
})

describe('recording-safety gate', () => {
  it('blocks install while recording', () => {
    expect(canInstallUpdate({ recorderStatus: 'recording', saveInFlight: false })).toMatchObject({ ok: false })
  })
  it('blocks install while paused (unfinished)', () => {
    expect(canInstallUpdate({ recorderStatus: 'paused', saveInFlight: false })).toMatchObject({ ok: false })
  })
  it('blocks install while a Stop&Save is in flight', () => {
    expect(canInstallUpdate({ recorderStatus: 'idle', saveInFlight: true })).toMatchObject({ ok: false })
  })
  it('blocks install while recovering an unfinished durable session', () => {
    expect(
      canInstallUpdate({ recorderStatus: 'idle', saveInFlight: false, recoveringSession: true }),
    ).toMatchObject({ ok: false })
  })
  it('allows install when idle and nothing is saving', () => {
    expect(canInstallUpdate({ recorderStatus: 'idle', saveInFlight: false })).toEqual({ ok: true })
  })
})

describe('ux + safety helpers', () => {
  it('sanitizes errors (no urls/tokens/signatures)', () => {
    expect(sanitizeUpdaterError(new Error('signature verify failed for https://x?token=abc'))).not.toMatch(/https|token|abc/)
    expect(sanitizeUpdaterError(new Error('network timeout'))).toMatch(/connection/)
  })
  it('shows the sidebar entry only for actionable states', () => {
    expect(updaterEntryVisible('available')).toBe(true)
    expect(updaterEntryVisible('downloading')).toBe(true)
    expect(updaterEntryVisible('error')).toBe(true)
    expect(updaterEntryVisible('idle')).toBe(false)
    expect(updaterEntryVisible('up-to-date')).toBe(false)
  })
  it('labels states with the approved copy', () => {
    expect(updaterStatusLabel('available')).toBe('Update available')
    expect(updaterStatusLabel('downloading')).toBe('Downloading update…')
    expect(updaterStatusLabel('ready')).toBe('Restart to update')
    expect(updaterStatusLabel('up-to-date')).toBe('You’re up to date')
    expect(updaterStatusLabel('error')).toBe('Update failed — Retry')
  })
})
