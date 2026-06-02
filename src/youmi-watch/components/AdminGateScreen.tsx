/**
 * AdminGateScreen — full-screen state shown while the server-verified admin
 * check is pending or has denied access. Uses the Youmi Watch liquid-glass
 * system (icy backdrop + centered glass card) so the gate looks like the same
 * product. Rendered only for the non-authorized states; the dashboard tree does
 * not mount until the server returns `authorized`.
 */
import { YoumiLensMonogramY } from '../../branding/YoumiLensMonogramY'
import { WatchIcon } from './WatchIcons'

export type AdminGateVariant = 'checking' | 'signed_out' | 'denied'

const COPY: Record<
  Exclude<AdminGateVariant, 'checking'>,
  { title: string; body: string; cta: string }
> = {
  signed_out: {
    title: 'Sign-in required',
    body: 'Youmi Watch is an internal admin tool. Sign in to Youmi Lens with an authorized developer account to continue.',
    cta: 'Go to Youmi Lens',
  },
  denied: {
    title: 'Access denied',
    body: 'This account is not authorized for Youmi Watch. Access is limited to admin and developer accounts, verified server-side.',
    cta: 'Back to Youmi Lens',
  },
}

function goToApp() {
  window.location.assign('/')
}

export function AdminGateScreen({ variant }: { variant: AdminGateVariant }) {
  return (
    <div className="yw-root">
      <div className="yw-gate">
        <div className="yw-gate__brand">
          <span className="yw-gate__mark">
            <YoumiLensMonogramY size={22} color="#ffffff" />
          </span>
          <div>
            <div className="yw-gate__title-brand">Youmi Watch</div>
            <div className="yw-gate__subtitle-brand">Developer Monitor</div>
          </div>
        </div>

        {variant === 'checking' ? (
          <div className="yw-gate__body">
            <span className="yw-spinner" aria-hidden />
            <p className="yw-gate__status" role="status">
              Verifying access…
            </p>
          </div>
        ) : (
          <div className="yw-gate__body">
            <span className={`yw-gate__icon is-${variant}`}>
              <WatchIcon name="shield" size={22} />
            </span>
            <h1 className="yw-gate__title">{COPY[variant].title}</h1>
            <p className="yw-gate__text">{COPY[variant].body}</p>
            <button type="button" className="yw-btn yw-btn--primary" onClick={goToApp}>
              {COPY[variant].cta}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
