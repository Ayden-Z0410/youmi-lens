import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseBillingResult } from '../hooks/useBilling'
import type { BillingState, NormalizedQuota } from '../lib/billing/billingState'
import {
  BillingPlanContent,
  BillingPlanModal,
} from './BillingPlanModal'
import {
  handleBillingModalEscape,
  handleBillingModalOverlayMouseDown,
} from './billingPlanModalChrome'

vi.mock('./BillingPlanModal.css', () => ({}))

const emptyQuota: NormalizedQuota = {
  monthlyMinutesLimit: null,
  minutesUsed: null,
  minutesRemaining: null,
  maxRecordingsPerDay: null,
  recordingsUsedToday: null,
  recordingsRemainingToday: null,
  maxStudyTasksPerDay: null,
  studyTasksUsedToday: null,
  studyTasksRemainingToday: null,
}

const studentQuota: NormalizedQuota = {
  monthlyMinutesLimit: 600,
  minutesUsed: 40,
  minutesRemaining: 560,
  maxRecordingsPerDay: 6,
  recordingsUsedToday: 2,
  recordingsRemainingToday: 4,
  maxStudyTasksPerDay: 10,
  studyTasksUsedToday: null,
  studyTasksRemainingToday: null,
}

function mockBilling(state: BillingState, over: Partial<UseBillingResult> = {}): UseBillingResult {
  return {
    state,
    loading: state.status === 'loading',
    error: null,
    actions: {
      load: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      upgrade: vi.fn(async () => {}),
      manage: vi.fn(async () => {}),
    },
    ...over,
  }
}

function renderContent(state: BillingState, onRetry?: () => void): string {
  return renderToStaticMarkup(createElement(BillingPlanContent, { state, onRetry }))
}

function renderModal(billing: UseBillingResult, onClose = vi.fn()): string {
  return renderToStaticMarkup(
    createElement(BillingPlanModal, { open: true, onClose, billing }),
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('BillingPlanContent states', () => {
  it('signed_out', () => {
    const html = renderContent({ status: 'signed_out' })
    expect(html).toContain('Sign in to view your plan')
    expect(html).toContain('data-billing-status="signed_out"')
    expect(html).not.toContain('Current plan')
    expect(html).not.toContain('$4.99')
  })

  it('loading', () => {
    const html = renderContent({ status: 'loading' })
    expect(html).toContain('Loading plan information')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('>Free<')
    expect(html).not.toContain('Current plan')
  })

  it('free', () => {
    const html = renderContent({ status: 'free', quota: studentQuota })
    expect(html).toContain('data-billing-status="free"')
    expect(html).toContain('Free')
    expect(html).toContain('Student Basic')
    expect(html).toContain('Monthly · $4.99')
    expect(html).toContain('Annual · $49.99')
    expect(html).toContain('600 Study Minutes per month')
    expect(html).toContain('6 Recordings per day')
    expect(html).toContain('10 Study Tasks per day')
    expect(html).toContain('Upgrade checkout opens in a later step')
  })

  it('active monthly', () => {
    const html = renderContent({
      status: 'active',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      currentPeriodEnd: '2026-08-15T00:00:00.000Z',
      manageable: true,
      quota: studentQuota,
    })
    expect(html).toContain('data-billing-status="active"')
    expect(html).toContain('data-billing-interval="monthly"')
    expect(html).toContain('Student Basic')
    expect(html).toContain('Monthly')
    expect(html).toContain('Active')
    expect(html).not.toContain('Annual')
  })

  it('active annual', () => {
    const html = renderContent({
      status: 'active',
      planCode: 'student_basic_annual',
      interval: 'annual',
      currentPeriodEnd: '2027-01-01T00:00:00.000Z',
      manageable: true,
      quota: studentQuota,
    })
    expect(html).toContain('data-billing-interval="annual"')
    expect(html).toContain('Annual')
    expect(html).not.toContain('Monthly')
  })

  it('canceling', () => {
    const html = renderContent({
      status: 'canceling',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      accessThrough: '2026-08-15T00:00:00.000Z',
      manageable: true,
      quota: studentQuota,
    })
    expect(html).toContain('Cancellation scheduled')
    expect(html).toContain('Access remains available through')
    expect(html).not.toContain('Ended')
    expect(html).not.toContain('Inactive')
  })

  it('past_due with grace', () => {
    const html = renderContent({
      status: 'past_due',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
      graceUntil: '2026-07-04T00:00:00.000Z',
      accessActive: true,
      manageable: true,
      quota: studentQuota,
    })
    expect(html).toContain('Payment issue')
    expect(html).toContain('access is still active')
    expect(html).toContain('Grace until')
    expect(html).not.toContain('no longer active')
  })

  it('past_due without grace', () => {
    const html = renderContent({
      status: 'past_due',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      currentPeriodEnd: null,
      graceUntil: null,
      accessActive: false,
      manageable: true,
      quota: emptyQuota,
    })
    expect(html).toContain('access is currently limited')
    expect(html).not.toContain('Grace until')
  })

  it('expired', () => {
    const html = renderContent({
      status: 'expired',
      planCode: 'student_basic_annual',
      interval: 'annual',
      currentPeriodEnd: '2026-01-01T00:00:00.000Z',
      manageable: false,
      quota: studentQuota,
    })
    expect(html).toContain('Inactive')
    expect(html).toContain('no longer active')
    expect(html).toContain('Free access')
  })

  it('unavailable never renders Free fallback', () => {
    const html = renderContent(
      {
        status: 'unavailable',
        reason: 'Network error loading billing.',
        retryable: true,
        backendCode: 'network_error',
      },
      () => {},
    )
    expect(html).toContain('Billing information is temporarily unavailable')
    expect(html).toContain('Network error loading billing.')
    expect(html).toContain('Retry')
    expect(html).not.toContain('Current plan')
    expect(html).not.toContain('data-billing-status="free"')
    expect(html).not.toMatch(/>\s*Free\s*</)
  })
})

describe('BillingPlanContent usage', () => {
  it('maps 600 / 6 / 10 and omits fabricated Study Tasks usage', () => {
    const html = renderContent({ status: 'free', quota: studentQuota })
    expect(html).toContain('600')
    expect(html).toContain('6')
    expect(html).toContain('10 per day')
    expect(html).not.toContain('0 used today · 10 / day')
    expect(html).not.toContain('0 used today · 10')
  })

  it('shows Study Tasks usage only when supplied', () => {
    const html = renderContent({
      status: 'active',
      planCode: 'student_basic_monthly',
      interval: 'monthly',
      currentPeriodEnd: null,
      manageable: true,
      quota: { ...studentQuota, studyTasksUsedToday: 3, studyTasksRemainingToday: 7 },
    })
    expect(html).toContain('3 used today · 10 / day')
  })
})

describe('BillingPlanModal chrome', () => {
  it('renders dialog semantics when open', () => {
    const billing = mockBilling({ status: 'free', quota: studentQuota })
    const html = renderModal(billing)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Plan &amp; billing')
    expect(html).toContain('aria-label="Close"')
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    handleBillingModalEscape({ key: 'Escape' }, onClose)
    handleBillingModalEscape({ key: 'Enter' }, onClose)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('overlay click closes; content click does not', () => {
    const onClose = vi.fn()
    const overlay = { id: 'overlay' }
    handleBillingModalOverlayMouseDown({ target: overlay, currentTarget: overlay }, onClose)
    handleBillingModalOverlayMouseDown({ target: { id: 'dialog' }, currentTarget: overlay }, onClose)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Retry invokes load', () => {
    const load = vi.fn(async () => {})
    const billing = mockBilling(
      {
        status: 'unavailable',
        reason: 'Billing is temporarily unavailable.',
        retryable: true,
      },
      {
        actions: {
          load,
          refresh: vi.fn(async () => {}),
          upgrade: vi.fn(async () => {}),
          manage: vi.fn(async () => {}),
        },
      },
    )
    // Presentational Retry wiring used by the modal frame.
    const onRetry = () => {
      void billing.actions.load()
    }
    const html = renderContent(billing.state, onRetry)
    expect(html).toContain('Retry')
    onRetry()
    expect(load).toHaveBeenCalledOnce()
  })

  it('does not call Checkout, Portal, or open external URLs in this slice', () => {
    const upgrade = vi.fn(async () => {})
    const manage = vi.fn(async () => {})
    const billing = mockBilling(
      {
        status: 'active',
        planCode: 'student_basic_monthly',
        interval: 'monthly',
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
        manageable: true,
        quota: studentQuota,
      },
      {
        actions: {
          load: vi.fn(async () => {}),
          refresh: vi.fn(async () => {}),
          upgrade,
          manage,
        },
      },
    )
    const html = renderModal(billing)
    expect(html).toContain('Subscription management opens in a later step')
    expect(upgrade).not.toHaveBeenCalled()
    expect(manage).not.toHaveBeenCalled()
  })
})

describe('Settings integration markers', () => {
  it('App Settings exposes View plan / View plans and keeps AccessUsageModal', async () => {
    const fs = await import('node:fs/promises')
    const app = await fs.readFile(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('BillingPlanModal')
    expect(app).toContain('View plan')
    expect(app).toContain('View plans')
    expect(app).toContain('AccessUsageModal')
    expect(app).toContain('setAccessUsageOpen(true)')
    expect(app).toContain('setBillingPlanOpen(true)')
    expect(app).not.toContain('actions.upgrade')
    expect(app).not.toContain('actions.manage')
    expect(app).not.toContain('createCheckout')
    expect(app).not.toContain('openPortal')
  })
})
