const PRODUCT_WEBVIEW_LABELS = new Set(['main', 'overlay'])

/** Auth handoff cleanup should only remove disposable auxiliary webviews. */
export function shouldCloseAuthCleanupWebview(label: string): boolean {
  return !PRODUCT_WEBVIEW_LABELS.has(label)
}
