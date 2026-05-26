const APP_OWNED_WEBVIEW_LABELS = new Set(['main', 'overlay'])

export function shouldCloseWebviewAfterAuthCleanup(label: string): boolean {
  return !APP_OWNED_WEBVIEW_LABELS.has(label)
}
