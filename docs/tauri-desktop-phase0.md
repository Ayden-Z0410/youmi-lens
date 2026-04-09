# Tauri desktop - phase 0 (minimal shell)

This adds a **Tauri 2** wrapper only. The React/Vite app is unchanged in behavior; `npm run dev` still runs the web app in a browser.

## Prerequisites (macOS)

- **Node.js** (current project uses npm).
- **Rust** toolchain: install from [rustup.rs](https://rustup.rs) (`rustup` + stable). Required for `tauri dev` / `tauri build`.
- **Xcode Command Line Tools** (for Apple linker): `xcode-select --install` if needed.

## Commands

| Goal | Command |
|------|--------|
| Web only (unchanged) | `npm run dev` |
| Desktop window (Vite + Tauri) | `npm run dev:desktop` |
| Production web build | `npm run build` |
| Packaged desktop app | `npm run build:desktop` (after `npm run build` is run by Tauri) |

First `tauri dev` will download Rust crates; keep network available.

## Config notes

- **Dev URL:** `http://localhost:5173` (see `src-tauri/tauri.conf.json`). Vite uses `strictPort: true` so this port must be free for desktop dev.
- **Icons:** `src-tauri/icons/*` were generated with `npx tauri icon <source.png>`. Replace with a real 1024x1024 app icon when ready.

## Supabase login in the desktop app

See [supabase-tauri-auth.md](./supabase-tauri-auth.md) for magic-link **deep link** setup (`lecturecompanion://auth-callback`) and dashboard steps.

## Risks and follow-ups (not implemented in phase 0)

- **Microphone:** `src-tauri/Info.plist` includes `NSMicrophoneUsageDescription` (required for WKWebView + `getUserMedia` on macOS). Rebuild the desktop app after changes. If `navigator.mediaDevices` is still missing, check console `[lc-media env]` (`isSecureContext`). Sandboxed/notarized builds may also need `bundle.macOS.entitlements` with `com.apple.security.device.audio-input` (see Tauri macOS bundle docs).
- **Supabase OAuth providers:** Google/Apple need provider-side redirect URIs in addition to Supabase; magic link path is implemented first.
- **`/api` proxy:** Vite dev proxy does not apply to the packaged app; production desktop needs a reachable `VITE_API_BASE_URL` or a bundled backend.
- **Local cache / crash recovery:** IndexedDB / `localStorage` behavior in the WebView profile should be validated for your retention expectations.

**Security:** Do not put Supabase **service role** keys in the frontend or Tauri `tauri.conf.json` - unchanged from the web app.
