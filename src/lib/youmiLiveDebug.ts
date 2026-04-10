/**
 * Evidence-only tracing for Youmi AI live captions (grep: [YoumiLive]).
 * Does not log tokens, JWTs, or signed URL query strings.
 * Off in production builds unless VITE_DEBUG_LIVE=true.
 */

const LIVE_CLIENT_TRACE =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_LIVE === 'true'

export function youmiLiveLog(
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'srv' | 'emit' | 'fail',
  message: string,
  fields?: Record<string, string | number | boolean | undefined>,
): void {
  if (!LIVE_CLIENT_TRACE) return
  const parts = [`[YoumiLive][${category}]`, message]
  if (fields && Object.keys(fields).length) {
    parts.push(JSON.stringify(fields))
  }
  console.info(parts.join(' '))
}

/** Safe preview of response JSON for logs (no secrets). */
export function youmiLiveSummarizeJsonBody(j: unknown, maxLen = 200): string {
  try {
    const s = JSON.stringify(j)
    if (s.length <= maxLen) return s
    return `${s.slice(0, maxLen)}...(len=${s.length})`
  } catch {
    return '[unserializable]'
  }
}

/** Log only origin + pathname of an HTTPS URL (drops query with tokens). */
export function youmiLiveSafeUrlParts(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url)
    return { host: u.hostname, path: u.pathname }
  } catch {
    return null
  }
}
