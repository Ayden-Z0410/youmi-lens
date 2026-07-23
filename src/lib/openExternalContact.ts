/**
 * Open an external URL — typically a Gmail compose URL (or any
 * mailto:/https://… link a future caller might pass via openExternalContact).
 *
 * Why not `mailto:`? On macOS, `mailto:` is dispatched to whatever the user
 * has registered as their default email handler. If that handler is Chrome
 * (a common default), the user lands on a browser page rather than in a
 * compose window. Gmail compose URLs provide a predictable destination for
 * Youmi Lens support flows.
 *
 * Behaviour:
 * - Tauri webview: route through @tauri-apps/plugin-shell open() so the URL
 *   opens in the user's default browser (capability `shell:allow-open` is
 *   already granted in src-tauri/capabilities).
 * - Web / dev: window.open(url, '_blank', 'noopener,noreferrer') so the URL
 *   opens in a new tab without navigating away from the dev app.
 *
 * Errors are caught and logged — opening the external URL is best-effort.
 */

function isTauriWebviewShell(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  )
}

async function openInEnvironment(url: string): Promise<void> {
  if (isTauriWebviewShell()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
      return
    } catch (err) {
      console.warn('[openExternalUrl] tauri shell open failed, falling back to window.open', err)
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      console.warn('[openExternalUrl] window.open failed', err)
    }
  }
}

/**
 * Strict opener for http(s) URLs only (billing Checkout / Portal, etc.).
 * Rejects javascript:/data:/file:/custom schemes, empty strings, and malformed URLs.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('external_url_invalid')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('external_url_invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('external_url_scheme_rejected')
  }
  await openInEnvironment(parsed.toString())
}

/**
 * Legacy contact/support opener. Preserves prior public behavior: no scheme
 * restriction (callers historically pass https Gmail compose URLs; mailto is
 * documented as acceptable). Prefer openExternalUrl for new billing flows.
 */
export async function openExternalContact(url: string): Promise<void> {
  await openInEnvironment(url)
}
