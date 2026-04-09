/** One-shot diagnostics for WebView vs browser (navigator.mediaDevices availability). */

let logged = false

export function logMediaEnvironmentOnce(): void {
  if (logged) return
  logged = true
  if (typeof window === 'undefined') return

  console.info('[lc-media env]', {
    href: location.href,
    protocol: location.protocol,
    isSecureContext: window.isSecureContext,
    typeofMediaDevices: typeof navigator.mediaDevices,
    typeofGetUserMedia: typeof navigator.mediaDevices?.getUserMedia,
  })

  if (typeof navigator.mediaDevices === 'undefined') {
    console.warn(
      '[lc-media] navigator.mediaDevices is missing - this is NOT the same as permission denied (getUserMedia was never called).',
    )
  }
}
