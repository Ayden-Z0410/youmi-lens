/**
 * Shared production auth UI — renders the approved two-panel .yl-auth-* shell
 * (auth-shell.css) with the OFFICIAL logo. Same design system as Desktop/iPad.
 * Rendering only; each page controller supplies the form body + wires real auth.
 */
export function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

const WAVE = [7,13,22,12,19,30,15,9,24,34,20,12,17,27,14,8,20,31,17,11,23,16,9,6,15,25,13,8]
  .map((h) => `<span style="height:${h}px"></span>`).join('')

/**
 * Navy brand panel — three zones so the column reads top / centre / bottom:
 *   .yl-auth-brandtop  logo, anchored top (links home)
 *   .yl-auth-brandmid  the message + waveform, optically centred
 *   .yl-auth-brandfoot "One account, every device." as footer-level copy
 * The tagline used to sit third of four children, which parked it mid-panel
 * competing with the message; it is now the last child and reads as a footnote.
 */
export function brandPanel() {
  return `<div class="yl-auth-brand">
    <div class="yl-auth-brandtop"><a href="/" aria-label="Youmi Lens home"><img class="yl-auth-logo" src="/brand/youmi-lens-wordmark-transparent.png" alt="Youmi Lens"></a></div>
    <div class="yl-auth-brandmid">
      <div class="yl-auth-live"><span class="yl-auth-rec"></span><span class="yl-auth-livelabel">Live captions</span></div>
      <p class="yl-auth-caption">Every lecture, captioned in real time.</p>
      <p class="yl-auth-caption dim">Translated as your professor speaks.</p>
      <div class="yl-auth-wave">${WAVE}</div>
    </div>
    <div class="yl-auth-brandfoot">
      <p class="yl-auth-tagline">One account, every device.</p>
      <p class="yl-auth-desc">Your recordings, courses, and plan stay in sync across Mac, Windows, and iPad.</p>
    </div>
  </div>`
}

/** Wrap a form-body string in the full rounded auth surface. */
export function surface(bodyHtml) {
  return `<div class="yl-auth yl-auth-full">
    <div class="yl-auth-surface">
      ${brandPanel()}
      <div class="yl-auth-form"><div class="yl-auth-card">${bodyHtml}</div></div>
    </div>
  </div>`
}

export const APPLE_SVG = '<svg width="17" height="17" viewBox="0 0 16 16" fill="#fff" aria-hidden><path d="M11.05 8.36c-.02-1.7 1.39-2.52 1.45-2.56-.79-1.16-2.02-1.32-2.46-1.34-1.05-.11-2.04.61-2.57.61-.53 0-1.35-.6-2.22-.58-1.14.02-2.19.66-2.78 1.68-1.18 2.05-.3 5.08.85 6.74.56.81 1.23 1.72 2.11 1.69.85-.03 1.17-.55 2.2-.55s1.31.55 2.21.53c.91-.02 1.49-.83 2.05-1.64.64-.94.91-1.85.92-1.9-.02-.01-1.77-.68-1.79-2.7zM9.42 3.4c.47-.57.79-1.36.7-2.15-.68.03-1.5.45-1.98 1.02-.43.5-.81 1.3-.71 2.07.76.06 1.53-.38 1.99-.94z"/></svg>'
export const GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>'

export function ssoStack(word) {
  return `<div class="yl-auth-sso">
    <button type="button" class="yl-sso-btn yl-sso-apple" data-provider="apple">${APPLE_SVG} Continue with Apple</button>
    <button type="button" class="yl-sso-btn yl-sso-google" data-provider="google">${GOOGLE_SVG} Continue with Google</button>
  </div>
  <div class="yl-auth-divider"><span>or ${word} with email</span></div>`
}

/* ── Shared "Resend code" / "Change email" controls ─────────────────────────
   ONE implementation for both the registration verify step and the password
   reset code step. Both screens previously rendered bare text buttons whose
   handler awaited the network before repainting, so a click produced no visible
   change and duplicate requests were possible.

   The caller owns the state object so a cooldown survives a repaint (and cannot
   be bypassed by re-rendering). Copy is identical whether or not an address
   exists, so nothing here leaks account existence. */
export const RESEND_COOLDOWN_MS = 30_000

export function createResendState() {
  return { until: 0, busy: false, timer: null }
}
export function resendCooldownSeconds(rs) {
  return Math.max(0, Math.ceil((rs.until - Date.now()) / 1000))
}
export function stopResendCountdown(rs) {
  if (rs.timer) { clearInterval(rs.timer); rs.timer = null }
}

/** Markup: the two secondary controls plus a reserved-height live region. */
export function resendControlsHtml(rs) {
  const s = resendCooldownSeconds(rs)
  return `<div class="yl-auth-subactions">
      <button type="button" class="yl-auth-back" id="resend"${s > 0 ? ' disabled' : ''}>${s > 0 ? `Resend in ${s}s` : 'Resend code'}</button>
      <button type="button" class="yl-auth-back" id="change">Change email</button>
    </div>
    <p class="yl-auth-status" id="rstatus" role="status" aria-live="polite"></p>`
}

/**
 * Wire the controls rendered by resendControlsHtml.
 *   send()      → async, resolves { ok, message }
 *   onChange()  → return to the email-entry step (caller repaints, then we focus)
 */
export function wireResendControls(rs, { send, onChange }) {
  const btn = document.getElementById('resend')
  const statusEl = document.getElementById('rstatus')
  if (!btn || !statusEl) return

  const setStatus = (kind, text) => {
    statusEl.className = 'yl-auth-status' + (text ? ' ' + kind : '')
    statusEl.textContent = text // textContent → backend copy is never parsed as HTML
  }
  const runCountdown = () => {
    stopResendCountdown(rs)
    const tick = () => {
      const s = resendCooldownSeconds(rs)
      if (s > 0) { btn.disabled = true; btn.textContent = `Resend in ${s}s`; return }
      stopResendCountdown(rs)
      btn.disabled = false
      btn.textContent = 'Resend code'
    }
    tick()
    rs.timer = setInterval(tick, 1000)
  }
  if (resendCooldownSeconds(rs) > 0) runCountdown()

  btn.addEventListener('click', async () => {
    // Two guards — in-flight and cooldown — make any extra click a no-op.
    if (rs.busy || resendCooldownSeconds(rs) > 0) return
    rs.busy = true
    const stale = document.querySelector('.yl-auth-banner')
    if (stale) stale.remove() // drop the old result so banners never stack
    btn.disabled = true
    btn.textContent = 'Sending…'
    setStatus('', '')

    const r = await send()
    rs.busy = false
    if (r && r.ok) {
      rs.until = Date.now() + RESEND_COOLDOWN_MS
      setStatus('ok', 'New code sent')
      runCountdown()
    } else {
      btn.disabled = false
      btn.textContent = 'Resend code'
      setStatus('err', (r && r.message) || 'Could not send the code. Please try again.')
    }
  })

  document.getElementById('change').addEventListener('click', () => {
    stopResendCountdown(rs)
    onChange() // caller resets its step + transient message, then repaints
    const field = document.getElementById('email')
    if (field) field.focus() // keyboard users land where they must type
  })
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function banner(kind, html) { return `<div class="yl-auth-banner ${kind}">${html}</div>` }
export function mount(html) {
  const root = document.getElementById('auth-root')
  if (root) root.innerHTML = html
}

/* Transient status message for the commercial pages, styled by `.toast` in
   commercial.css. One live region is created once and kept in the DOM so repeat
   messages are announced reliably; the `.toast` class (and therefore all visible
   styling) is only present while a message is showing, so the idle region has no
   visual or layout footprint. Text is set via textContent, so backend copy is
   inserted as text and never parsed as HTML. */
let toastNode = null
let toastTimer = null

export function hideToast() {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  if (toastNode) { toastNode.classList.remove('toast'); toastNode.textContent = '' }
}

export function toast(message, ms = 6000) {
  const text = String(message == null ? '' : message).trim()
  if (!text) return
  if (!toastNode) {
    toastNode = document.createElement('div')
    toastNode.id = 'yl-toast'
    toastNode.setAttribute('role', 'status')
    toastNode.setAttribute('aria-live', 'polite')
    toastNode.addEventListener('click', hideToast)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideToast() })
    document.body.appendChild(toastNode)
  }
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  toastNode.classList.add('toast')
  // Clear first, then set on the next tick: a change inside an already-live
  // region is what screen readers announce, including for a repeated message.
  toastNode.textContent = ''
  setTimeout(() => { if (toastNode) toastNode.textContent = text }, 0)
  toastTimer = setTimeout(hideToast, ms)
}
