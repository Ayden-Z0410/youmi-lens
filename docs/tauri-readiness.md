# Tauri integration � readiness note (analysis only)

This document is a **pre-integration checklist**. No Tauri code ships in the repo yet.

## 1. What fits Tauri well

- **Frontend build:** Vite + React + TypeScript (`npm run build` ? static `dist/`). Tauri can point `build.distDir` at `dist` and `beforeBuildCommand` at `npm run build`.
- **Routing:** Single-page app (one `index.html`, `createRoot` on `#root`). No client-side router package � no hash/history quirks beyond default `file://` vs custom protocol (Tauri uses a custom asset protocol by default � fine).
- **Supabase auth:** `@supabase/supabase-js` uses HTTPS + `fetch`; works in a WebView if network and redirect URLs are configured (magic link / OAuth need allowed redirect URIs for your `tauri://` or `https://` custom scheme).
- **Cloud API:** AI proxy calls use `fetch` to `/api` or `VITE_API_BASE_URL`; same pattern works if the desktop app bundles the webview origin and proxies API calls.

## 2. Likely adjustments for a minimal Tauri shell

| Area | Today | Tauri note |
|------|--------|------------|
| **Env vars** | `import.meta.env.VITE_*` at build time | Set in `.env` before `tauri build` / `tauri dev`, or inject via Tauri config; no runtime `process.env` in the browser bundle. |
| **AI server** | Dev: Vite proxies `/api` ? `127.0.0.1:3847` | Production desktop either ships a **sidecar** Node binary, embeds a Rust HTTP server, or uses only remote `VITE_API_BASE_URL`. |
| **Deep links / OAuth** | Browser redirect URLs | Register custom scheme or localhost callback in Supabase + Tauri. |
| **localStorage** | Keys for API key, prefs, tab save lock | Persists per WebView profile; behaves like a browser profile (usually OK). |

## 3. Risk hotspots

1. **Microphone:** `navigator.mediaDevices.getUserMedia` in `useRecorder.ts`. Tauri must declare **macOS microphone entitlement** (and Windows equivalent). Without it, recording fails at runtime.
2. **MediaRecorder / codecs:** Depends on WebView (WKWebView on macOS). Prefer MIME types already probed with `MediaRecorder.isTypeSupported`; test on target OS.
3. **IndexedDB (local-only mode):** Same WebView storage; generally supported � verify quota and persistence across app updates if you rely on it.
4. **Supabase magic link:** Email links often open the **system browser**; user may land in browser, not the app, unless you use a custom URL scheme and handle `tauri://` deep links.
5. **CORS / cookies:** Less of an issue for Supabase JWT in memory/localStorage; still validate cookie-based flows if added later.

## 4. Desktop trial P0 (current)

See **`docs/tauri-desktop-trial-p0.md`**: packaged Mac builds require **`VITE_API_BASE_URL`** (no localhost fallback in Tauri production).

## 5. Suggested minimal integration order (when you choose to implement)

1. Add Tauri CLI + `src-tauri` with `devPath` ? Vite dev server, `distDir` ? `../dist`.
2. Enable devtools in dev; confirm app shell loads.
3. Request microphone permission; smoke-test record ? stop ? local save.
4. Configure Supabase redirect URLs for desktop.
5. Decide AI strategy: remote API only vs bundled sidecar for `/api`.

## 6. Explicitly out of scope here

- Async AI worker, enqueue, polling (Phase 2) � unchanged by desktop shell choice.
- Changing build tooling � not required until you add the Tauri crate and config.
