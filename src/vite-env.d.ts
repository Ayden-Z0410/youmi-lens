/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_USE_AI_BACKEND?: string
  /**
   * HTTPS origin of your AI gateway (no trailing slash). App calls `${origin}/api/...`.
   * **Required** for Tauri production builds when unset — see `getAiApiBase()` and `docs/tauri-desktop-trial-p0.md`.
   */
  readonly VITE_API_BASE_URL?: string
  /** @deprecated No longer used by `apiBase`; Vite dev proxy targets port in `vite.config.ts`. */
  readonly VITE_AI_SERVER_PORT?: string
  /** Set to `true` to show Apple sign-in on the login screen (requires Supabase + Apple IdP setup). */
  readonly VITE_SHOW_APPLE_SIGNIN?: string
  /** Dev: set to `false` to hide the optional local OpenAI key panel. Ignored in production builds. */
  readonly VITE_SHOW_DEV_AI_KEY?: string
  /**
   * Tauri only: HTTPS origin (no trailing slash) that serves `/tauri-auth-callback` for Supabase redirects
   * when `lecturecompanion://` cannot be used as redirect URL. Production desktop builds default to custom scheme.
   */
  readonly VITE_AUTH_BRIDGE_ORIGIN?: string
  /** Dev/local A/B: `true` = Youmi AI mode skips live slice cycle only; main recording unchanged. */
  readonly VITE_EXPERIMENT_SKIP_YOUMI_LIVE_SLICE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
