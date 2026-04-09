# Desktop trial P0 � API base (Mac)

## Requirement

Packaged Mac apps (`npm run build` + `npm run build:desktop`) **must** reach your **remote AI gateway**. They do **not** fall back to `http://127.0.0.1:3847`.

## Configure

1. Copy or edit **`.env.production`** in the repo root.
2. Set a **single HTTPS origin** (no trailing slash):

   ```bash
   VITE_API_BASE_URL=https://your-api-gateway.example.com
   ```

3. Build:

   ```bash
   npm run build
   npm run build:desktop
   ```

If `VITE_API_BASE_URL` is missing in a Tauri production build, `getAiApiBase()` throws `AI_API_BASE_URL_REQUIRED` at runtime (fail fast instead of a silent localhost).

## Same base for HTTP + WebSocket

All hosted AI traffic uses `getAiApiBase()`:

- HTTP: transcribe, summarize, translate-caption, health, process-recording, live-transcribe-url, etc.
- WebSocket (live realtime): `liveCaptionRealtime.ts` derives `ws(s)://�/api/live-realtime-ws` from the same base.

## Dev unchanged

- `npm run dev` / `tauri dev`: Vite proxies `/api` ? local Node server on `127.0.0.1:3847` when `VITE_API_BASE_URL` is unset.
