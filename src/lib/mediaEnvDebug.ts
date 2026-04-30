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

/** Sample rate the recording AudioContext will use (no mic permission). Falls back to 48000. */
export function probeDefaultAudioSampleRate(): number {
  if (typeof window === 'undefined') return 48000
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return 48000
    const ctx = new Ctor()
    const sr = typeof ctx.sampleRate === 'number' && ctx.sampleRate > 0 ? ctx.sampleRate : 48000
    void ctx.close().catch(() => undefined)
    return sr
  } catch {
    return 48000
  }
}
