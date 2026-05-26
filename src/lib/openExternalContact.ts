/**
 * Open an external contact URL — typically a Gmail compose URL (or any
 * mailto:/https://… link a future caller might pass).
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

export async function openExternalContact(url: string): Promise<void> {
  if (isTauriWebviewShell()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
      return
    } catch (err) {
      console.warn('[openExternalContact] tauri shell open failed, falling back to window.open', err)
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      console.warn('[openExternalContact] window.open failed', err)
    }
  }
}
