/**
 * Youmi Watch — data-source coverage model (Phase 4.5).
 *
 * Honest source semantics so partial real data is never shown as fully live:
 *   • mock    — no meaningful real operational data exists for the page.
 *   • partial — some sections/providers are real, but coverage is incomplete.
 *   • live    — the required real-data coverage for the page is complete.
 *   (the frontend adds a fourth, 'local-fallback', when it can't reach the API)
 *
 * Pure + deterministic so it can be unit-tested in isolation.
 */

/** Providers we expect real data from before a provider-coverage page is "live". */
export const EXPECTED_PROVIDERS = Object.freeze([
  'deepgram',
  'dashscope',
  'brevo',
  'railway',
  'supabase',
])

/** Expected providers (in canonical order) that have at least one real row. */
export function realExpectedProviders(providers) {
  const seen = new Set((providers || []).map((p) => String(p)))
  return EXPECTED_PROVIDERS.filter((p) => seen.has(p))
}

export function pct(part, whole) {
  return whole > 0 ? Math.round((Number(part) / Number(whole)) * 100) : 0
}

/**
 * Decide the page source from whether any real data exists and whether the
 * required coverage is complete.
 */
export function decideSource({ hasAnyReal, complete }) {
  if (!hasAnyReal) return 'mock'
  return complete ? 'live' : 'partial'
}

/**
 * Assemble the typed coverage object returned with each endpoint. `sectionsLive`
 * / `sectionsMock` name the page sections; `providersWithRealData` is the subset
 * of EXPECTED_PROVIDERS with real data. `completenessPct` defaults to the
 * section ratio when not provided explicitly.
 */
export function makeCoverage({
  providersWithRealData = [],
  sectionsLive = [],
  sectionsMock = [],
  completenessPct,
} = {}) {
  return {
    providersWithRealData: [...providersWithRealData],
    providersExpected: [...EXPECTED_PROVIDERS],
    sectionsLive: [...sectionsLive],
    sectionsMock: [...sectionsMock],
    completenessPct:
      typeof completenessPct === 'number'
        ? completenessPct
        : pct(sectionsLive.length, sectionsLive.length + sectionsMock.length),
  }
}
