/**
 * "Resend code" / "Change email" row + status line — React port of
 * `resendControlsHtml()` in landing/app/auth-ui.js.
 *
 * Same markup contract as the Website: both secondary controls on one row so
 * neither reads as body copy, followed by a reserved-height live region so
 * showing or clearing the message never shifts the layout.
 */
import type { ResendController, ResendSendResult } from './useResendCode'
import { resendButtonLabel } from './useResendCode'

export function ResendControls({
  controller,
  onSend,
  onChangeEmail,
}: {
  controller: ResendController
  onSend: () => Promise<ResendSendResult>
  onChangeEmail: () => void
}) {
  const { secondsLeft, busy, status, blocked } = controller

  return (
    <>
      <div className="yl-auth-subactions">
        <button
          type="button"
          className="yl-auth-back"
          disabled={blocked}
          onClick={() => void controller.send(onSend)}
        >
          {resendButtonLabel(secondsLeft, busy)}
        </button>
        <button type="button" className="yl-auth-back" onClick={onChangeEmail}>
          Change email
        </button>
      </div>
      <p
        className={`yl-auth-status${status ? ` ${status.kind}` : ''}`}
        role="status"
        aria-live="polite"
      >
        {status?.text ?? ''}
      </p>
    </>
  )
}
