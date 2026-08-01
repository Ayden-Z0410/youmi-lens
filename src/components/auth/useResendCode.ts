/**
 * Resend-code controller — React port of createResendState / wireResendControls
 * in landing/app/auth-ui.js.
 *
 * Behaviour copied from the Website, verbatim:
 *   • 30-second cooldown after a SUCCESSFUL send (a failure leaves the button live)
 *   • two guards — in-flight and cooldown — so any extra click is a no-op
 *   • countdown label "Resend in Ns", then back to "Resend code"
 *   • status line: "New code sent" on success, the backend message on failure
 *
 * The Website keeps this state at module scope so a cooldown survives a repaint
 * and cannot be bypassed by re-rendering. The React equivalent is to own the hook
 * ABOVE the step components (AuthScreens holds it), so leaving the verify step and
 * coming back does not hand the user a fresh allowance.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const RESEND_COOLDOWN_MS = 30_000

/** Whole seconds remaining until `until`, floored at 0. Pure — unit tested. */
export function resendCooldownSeconds(until: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/** Label the resend button shows for a given remaining-seconds value. */
export function resendButtonLabel(secondsLeft: number, busy: boolean): string {
  if (busy) return 'Sending…'
  return secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend code'
}

export type ResendStatus = { kind: 'ok' | 'err'; text: string } | null

export type ResendSendResult = { ok: boolean; message?: string | null }

export type ResendController = {
  secondsLeft: number
  busy: boolean
  status: ResendStatus
  /** True when a click must be ignored (in flight, or still cooling down). */
  blocked: boolean
  /** Run `send`; start the cooldown only when it reports success. */
  send: (fn: () => Promise<ResendSendResult>) => Promise<void>
  /** Clear status + cooldown (used when the user changes email). */
  reset: () => void
}

export function useResendCode(): ResendController {
  const [until, setUntil] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ResendStatus>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  // Read inside the click guard without making `send` depend on a changing value.
  const untilRef = useRef(0)
  const busyRef = useRef(false)

  useEffect(() => {
    untilRef.current = until
  }, [until])

  // Tick once per second while a cooldown is running.
  useEffect(() => {
    const compute = () => setSecondsLeft(resendCooldownSeconds(until))
    compute()
    if (until <= Date.now()) return
    const timer = setInterval(compute, 1000)
    return () => clearInterval(timer)
  }, [until])

  const send = useCallback(async (fn: () => Promise<ResendSendResult>) => {
    // Same two guards as the Website: in-flight and cooldown.
    if (busyRef.current || resendCooldownSeconds(untilRef.current) > 0) return
    busyRef.current = true
    setBusy(true)
    setStatus(null)
    try {
      const result = await fn()
      if (result?.ok) {
        setUntil(Date.now() + RESEND_COOLDOWN_MS)
        setStatus({ kind: 'ok', text: 'New code sent' })
      } else {
        // Failure must NOT start a cooldown — the user has to be able to retry.
        setStatus({
          kind: 'err',
          text: result?.message || 'Could not send the code. Please try again.',
        })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const reset = useCallback(() => {
    setUntil(0)
    setStatus(null)
    setSecondsLeft(0)
  }, [])

  return { secondsLeft, busy, status, blocked: busy || secondsLeft > 0, send, reset }
}
