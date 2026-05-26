/**
 * Open a mailto: URL the user's default email client.
 *
 * Tauri: route through @tauri-apps/plugin-shell open() (capability
 * `shell:allow-open` is already granted in src-tauri/capabilities).
 * Web/dev: fall back to window.location.assign(url) so the browser hands
 * the URL to the system mail handler.
 *
 * Errors are caught and logged — opening the mail client is best-effort.
 */
function isTauriWebviewShell(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  )
}

export async function openMailto(url: string): Promise<void> {
  if (isTauriWebviewShell()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
      return
    } catch (err) {
      console.warn('[openMailto] tauri shell open failed, falling back to window.location', err)
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.location.assign(url)
    } catch (err) {
      console.warn('[openMailto] window.location.assign failed', err)
    }
  }
}
