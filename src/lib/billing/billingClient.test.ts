import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseMock, getSessionMock, getAiApiBaseMock } = vi.hoisted(() => {
  const getSessionMock = vi.fn()
  const getSupabaseMock = vi.fn(() => ({ auth: { getSession: getSessionMock } }))
  const getAiApiBaseMock = vi.fn(() => '/api')
  return { getSupabaseMock, getSessionMock, getAiApiBaseMock }
})

vi.mock('../supabase', () => ({ getSupabase: getSupabaseMock }))
vi.mock('../ai/apiBase', () => ({ getAiApiBase: getAiApiBaseMock }))

import {
  BillingApiError,
  createCheckout,
  getQuotaStatus,
  getSubscriptionStatus,
  openPortal,
  refreshSubscription,
} from './billingClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const emptySub = {
  provider: null,
  active: false,
  planCode: null,
  billingInterval: null,
  status: 'none',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  graceUntil: null,
  manageable: false,
}

beforeEach(() => {
  getSupabaseMock.mockReturnValue({ auth: { getSession: getSessionMock } })
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-tok' } } })
  getAiApiBaseMock.mockReturnValue('/api')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('billingClient', () => {
  it('attaches the Supabase JWT and reuses getAiApiBase', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, subscription: emptySub }))
    vi.stubGlobal('fetch', fetchMock)
    await getSubscriptionStatus()
    expect(getAiApiBaseMock).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/subscription/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    )
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer jwt-tok')
  })

  it('uses the correct HTTP methods for each route', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/subscription/status')) {
        return jsonResponse({ ok: true, subscription: emptySub })
      }
      if (String(url).includes('/subscription/refresh')) {
        return jsonResponse({ ok: true, refreshed: true, subscription: emptySub })
      }
      if (String(url).includes('/billing/checkout')) {
        return jsonResponse({ ok: true, url: 'https://checkout.stripe.com/c/test' })
      }
      if (String(url).includes('/billing/portal')) {
        return jsonResponse({ ok: true, url: 'https://billing.stripe.com/p/test' })
      }
      if (String(url).includes('/quota/status')) {
        return jsonResponse({ ok: true, plan: { planType: 'public_trial', unlimited: false } })
      }
      return jsonResponse({ ok: false }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    await getSubscriptionStatus()
    await refreshSubscription()
    await createCheckout('student_basic_monthly')
    await openPortal()
    await getQuotaStatus()

    const methods = fetchMock.mock.calls.map((c) => [String(c[0]), c[1]?.method])
    expect(methods).toEqual([
      ['/api/subscription/status', 'GET'],
      ['/api/subscription/refresh', 'POST'],
      ['/api/billing/checkout', 'POST'],
      ['/api/billing/portal', 'POST'],
      ['/api/quota/status', 'GET'],
    ])
  })

  it('checkout body contains only plan_code', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, url: 'https://checkout.stripe.com/c/x' }))
    vi.stubGlobal('fetch', fetchMock)
    await createCheckout('student_basic_annual')
    const init = fetchMock.mock.calls[0][1]
    expect(JSON.parse(String(init.body))).toEqual({ plan_code: 'student_basic_annual' })
  })

  it('rejects an invalid plan before fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, url: 'https://example.com' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createCheckout('not_a_plan' as 'student_basic_monthly')).rejects.toMatchObject({
      kind: 'invalid_plan',
      code: 'invalid_plan',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('portal sends no customer or customer_id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, url: 'https://billing.stripe.com/p/x' }))
    vi.stubGlobal('fetch', fetchMock)
    await openPortal()
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body).not.toHaveProperty('customer')
    expect(body).not.toHaveProperty('customer_id')
    expect(body).not.toHaveProperty('customerId')
  })

  it('preserves 401 auth failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: false, error: 'auth_required', message: 'Sign in required.' }, 401)),
    )
    await expect(getSubscriptionStatus()).rejects.toBeInstanceOf(BillingApiError)
    await expect(getSubscriptionStatus()).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      code: 'auth_required',
    })
  })

  it('preserves 409 no_customer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ ok: false, error: 'no_customer', message: 'No billing account found.' }, 409),
      ),
    )
    await expect(openPortal()).rejects.toMatchObject({ kind: 'http', status: 409, code: 'no_customer' })
  })

  it('preserves 502 and 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: false, error: 'checkout_failed', message: 'Could not start checkout.' }, 502)),
    )
    await expect(createCheckout('student_basic_monthly')).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      code: 'checkout_failed',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ ok: false, error: 'stripe_not_configured', message: 'Billing is temporarily unavailable.' }, 503),
      ),
    )
    await expect(createCheckout('student_basic_monthly')).rejects.toMatchObject({
      kind: 'http',
      status: 503,
      code: 'stripe_not_configured',
    })
  })

  it('normalizes network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(getQuotaStatus()).rejects.toMatchObject({
      kind: 'network',
      code: 'network_error',
      status: null,
    })
  })

  it('rejects malformed success responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(getSubscriptionStatus()).rejects.toMatchObject({ kind: 'malformed' })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, url: '' })))
    await expect(openPortal()).rejects.toMatchObject({ kind: 'malformed' })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, subscription: emptySub })))
    await expect(getSubscriptionStatus()).rejects.toMatchObject({ kind: 'malformed' })
  })
})
