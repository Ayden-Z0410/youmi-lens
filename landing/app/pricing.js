/**
 * Website Pricing — EXACT approved values (plans.js). Shows the current-plan
 * indicator for signed-in users and starts real Stripe Checkout for upgrades
 * (existing /api/billing/checkout; no new Stripe logic). Visitors are routed to
 * sign in / create account first.
 */
import { getSession, getQuotaStatus, startCheckout } from './auth.js'
import { esc, toast } from './auth-ui.js'
import { FREE, PAID, PRICE, COMPARE_ROWS, usd, annualPerMonth, mins } from './plans.js'

const root = () => document.getElementById('pricing-root')
let interval = 'month'
let planType = null // 'public_trial' | 'student_pass' | null(visitor)
let signedIn = false

const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M13.5 4.5 6.5 11.5 3 8" fill="none" stroke="#2f8f73" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const DASH = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 8h8" fill="none" stroke="#c3ceda" stroke-width="2" stroke-linecap="round"/></svg>'

function planCards() {
  const price = interval === 'month' ? PRICE.monthly : PRICE.annual
  const isFreeCurrent = signedIn && planType === 'public_trial'
  const isPaidCurrent = signedIn && planType === 'student_pass'
  const free = `<article class="card plan${isFreeCurrent ? ' plan--current' : ''}">
    ${isFreeCurrent ? '<div style="margin-bottom:10px"><span class="badge badge--active">Current plan</span></div>' : ''}
    <h3>Free Beta</h3><p class="plan__sub">For trying Youmi Lens in class.</p>
    <div class="plan__price"><span class="plan__amount">Free</span></div><p class="plan__meta">No card required</p>
    <ul><li>${CHECK}${mins(FREE.monthlyMinutes)} of transcription / month</li><li>${CHECK}Up to ${mins(FREE.maxRecordingMinutes)} per recording</li><li>${CHECK}${FREE.recordingsPerDay} recordings / day</li><li>${CHECK}Live captions &amp; course library</li><li>${DASH}<span style="color:var(--muted-text)">Extended monthly minutes</span></li></ul>
    <div class="foot"><button class="btn btn--secondary btn--block"${isFreeCurrent ? ' disabled' : ''}>${isFreeCurrent ? 'Your current plan' : 'Included'}</button></div></article>`
  const paidAction = isPaidCurrent
    ? '<button class="btn btn--secondary btn--block" disabled>Your current plan</button>'
    : `<button class="btn btn--primary btn--block" data-checkout="${interval}">${signedIn ? 'Upgrade to Student Basic' : 'Get Student Basic'}</button>`
  const paid = `<article class="card plan plan--featured${isPaidCurrent ? ' plan--current' : ''}"><div class="plan__pop">Most popular</div>
    <h3>Student Basic ${isPaidCurrent ? '<span class="badge badge--active" style="vertical-align:middle">Current plan</span>' : ''}</h3><p class="plan__sub">For a full semester of lectures.</p>
    <div class="plan__price"><span class="plan__amount">${usd(price.usdCents)}</span><span class="plan__period">/ ${price.interval === 'year' ? 'year' : 'month'}</span></div>
    <p class="plan__meta">${PAID.entitlementDays}-day access per period · cancel anytime${interval === 'year' ? ` · ≈ ${annualPerMonth()}/mo` : ''}</p>
    <ul><li>${CHECK}<strong>${mins(PAID.monthlyMinutes)}</strong>&nbsp;of transcription / month</li><li>${CHECK}Up to ${mins(PAID.maxRecordingMinutes)} per recording</li><li>${CHECK}${PAID.recordingsPerDay} recordings / day</li><li>${CHECK}${PAID.processingJobsPerDay} processing jobs / day</li><li>${CHECK}Everything in Free Beta</li></ul>
    <div class="foot">${paidAction}</div></article>`
  return free + paid
}

function view() {
  const rows = COMPARE_ROWS.map((r) => `<tr><td>${esc(r[0])}</td><td style="color:var(--muted-text)">${esc(r[1])}</td><td class="pay">${esc(r[2])}</td></tr>`).join('')
  return `<div class="stage--pad" style="max-width:1160px;margin:0 auto">
    <div class="section-head"><h1>Simple pricing for students</h1><p>Start free. Upgrade to Student Basic for longer lectures and more monthly minutes. One account works on Mac, Windows, and iPad.</p></div>
    <div class="seg-wrap"><div class="seg" role="group" aria-label="Billing period">
      <button data-interval="month" aria-pressed="${interval === 'month'}">Monthly</button>
      <button data-interval="year" aria-pressed="${interval === 'year'}">Annual</button></div>
      ${interval === 'year' ? `<span class="seg-hint">≈ ${annualPerMonth()}/mo billed annually</span>` : ''}</div>
    <div class="plans">${planCards()}</div>
    <div class="compare card"><table><thead><tr><th>Compare</th><th>Free Beta</th><th>Student Basic</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="plan__disclaim">Prices in USD. Student Basic is also available as a 30-day pass on iPad via the App Store. Taxes may apply at checkout.</p>
  </div>`
}

/**
 * Public release switch — while commercialization is off the route is KEPT (it
 * is indexed and linked) but renders a price-free Coming Soon placeholder: no
 * amounts, no Monthly/Annual toggle, no comparison table, and no data-checkout
 * button is ever created, so no visitor can reach TEST MODE Checkout.
 */
function comingSoonView() {
  return `<div class="stage--pad" style="max-width:1160px;margin:0 auto">
    <div class="section-head"><h1>Pricing is coming soon</h1>
    <p>Youmi Lens is free to use while we finish bringing Mac, Windows, and iPad in line. Paid plans are not available yet — there is nothing to buy today.</p></div>
    <div style="text-align:center;margin-top:8px"><a class="btn btn--primary" href="/">Back to home</a></div>
  </div>`
}

function paint() {
  if (window.YOUMI_CONFIG?.isCommercializationEnabled?.() !== true) {
    root().innerHTML = comingSoonView()
    return
  }
  root().innerHTML = view()
  root().querySelectorAll('.seg [data-interval]').forEach((b) => b.addEventListener('click', () => { interval = b.dataset.interval; paint() }))
  root().querySelectorAll('[data-checkout]').forEach((b) => b.addEventListener('click', async () => {
    if (!signedIn) { location.assign('/register/'); return } // visitors sign up first
    const code = b.dataset.checkout === 'year' ? PRICE.annual.code : PRICE.monthly.code
    b.disabled = true; b.textContent = 'Starting checkout…'
    const r = await startCheckout(code)
    if (r.ok) { location.assign(r.url); return }
    b.disabled = false; b.textContent = 'Upgrade to Student Basic'
    toast(r.message || 'Checkout is temporarily unavailable.')
  }))
}

;(async () => {
  paint() // render immediately with exact values
  // Switch off → Coming Soon is already final; skip the session/quota lookups.
  if (window.YOUMI_CONFIG?.isCommercializationEnabled?.() !== true) return
  const session = await getSession()
  signedIn = Boolean(session)
  if (signedIn) { const q = await getQuotaStatus(); if (q.ok) planType = q.body?.plan?.planType || 'public_trial' }
  paint() // re-render with current-plan indicator
})()
