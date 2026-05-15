import { describe, expect, it } from 'vitest'
import {
  resolveAuthRedirectUrl,
  TAURI_AUTH_BRIDGE_PATH,
  TAURI_AUTH_CALLBACK,
} from './authRedirect'

describe('resolveAuthRedirectUrl', () => {
  it('keeps pure web sign-in on the current origin even when a Tauri bridge is configured', () => {
    expect(
      resolveAuthRedirectUrl({
        bridgeOrigin: 'https://bridge.example.com',
        dev: false,
        isTauriRuntime: false,
        origin: 'https://app.example.com',
      }),
    ).toBe('https://app.example.com')
  })

  it('uses the configured bridge inside the Tauri runtime', () => {
    expect(
      resolveAuthRedirectUrl({
        bridgeOrigin: 'https://bridge.example.com/',
        dev: false,
        isTauriRuntime: true,
        origin: 'http://tauri.localhost',
      }),
    ).toBe(`https://bridge.example.com${TAURI_AUTH_BRIDGE_PATH}`)
  })

  it('treats packaged Tauri localhost as desktop even if runtime detection is unavailable', () => {
    expect(
      resolveAuthRedirectUrl({
        bridgeOrigin: 'https://bridge.example.com',
        dev: false,
        isTauriRuntime: false,
        origin: 'http://tauri.localhost',
      }),
    ).toBe(`https://bridge.example.com${TAURI_AUTH_BRIDGE_PATH}`)
  })

  it('uses the local bridge for Tauri dev without an explicit bridge origin', () => {
    expect(
      resolveAuthRedirectUrl({
        bridgeOrigin: null,
        dev: true,
        isTauriRuntime: true,
        origin: 'http://localhost:5173',
      }),
    ).toBe(`http://localhost:5173${TAURI_AUTH_BRIDGE_PATH}`)
  })

  it('uses the custom scheme for Tauri production without an explicit bridge origin', () => {
    expect(
      resolveAuthRedirectUrl({
        bridgeOrigin: null,
        dev: false,
        isTauriRuntime: true,
        origin: 'http://tauri.localhost',
      }),
    ).toBe(TAURI_AUTH_CALLBACK)
  })
})
