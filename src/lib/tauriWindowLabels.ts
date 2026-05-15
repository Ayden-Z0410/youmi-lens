export const TAURI_MAIN_WINDOW_LABEL = 'main'
export const TAURI_OVERLAY_WINDOW_LABEL = 'overlay'

const FIRST_CLASS_WEBVIEW_WINDOW_LABELS = new Set([
  TAURI_MAIN_WINDOW_LABEL,
  TAURI_OVERLAY_WINDOW_LABEL,
])

export function shouldCloseAuxiliaryWebviewWindow(label: string): boolean {
  return !FIRST_CLASS_WEBVIEW_WINDOW_LABELS.has(label)
}
