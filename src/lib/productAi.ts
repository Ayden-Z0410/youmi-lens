/**
 * Single source of truth for product vs developer AI paths.
 *
 * - **Product mode** (release builds, or dev when `VITE_PRODUCT_AI_MODE=true`):
 *   No browser-stored credentials; cloud AI runs on the platform server; user only calls `/api/*` with session.
 * - **Developer mode** (`import.meta.env.DEV` and product mode flag off):
 *   Optional local test credential + toggles for debugging; must never be required for shipped apps.
 */

/** Shipped app: always hosted AI only. */
export function isProductAiMode(): boolean {
  return import.meta.env.PROD || import.meta.env.VITE_PRODUCT_AI_MODE === 'true'
}

/** Local engineering / demo: can use isolated dev credential UI when enabled. */
export function isDeveloperAiMode(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_PRODUCT_AI_MODE !== 'true'
}

/**
 * Developer-only: Advanced setup UI + optional `lc_openai_key`.
 * Must be false in any product/shipped build (including `VITE_PRODUCT_AI_MODE=true` in dev).
 */
export function showDeveloperAiCredentialsUi(): boolean {
  if (isProductAiMode()) return false
  return (
    isDeveloperAiMode() &&
    import.meta.env.VITE_SHOW_DEV_AI_KEY !== 'false'
  )
}
