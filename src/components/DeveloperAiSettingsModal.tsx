import { designTokens } from '../design-system/tokens'

type Props = {
  open: boolean
  onClose: () => void
  apiKey: string
  onApiKeyChange: (value: string) => void
  onSave: () => void
  /** When true, production uses the app server — only dev builds need local key UI. */
  isProductionBuild: boolean
}

/**
 * Optional local AI credential for **development** when not using the backend proxy.
 * Never shown in production (`import.meta.env.PROD`).
 */
export function DeveloperAiSettingsModal({
  open,
  onClose,
  apiKey,
  onApiKeyChange,
  onSave,
  isProductionBuild,
}: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: px(t.spacing[6]),
        boxSizing: 'border-box',
      }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-labelledby="dev-ai-title"
        className="ds-card"
        style={{
          width: '100%',
          maxWidth: 440,
          padding: px(t.spacing[8]),
          border: `1px solid ${t.colors.border}`,
          background: t.colors.surface,
          borderRadius: t.radii.xl,
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="dev-ai-title"
          style={{
            margin: `0 0 ${px(t.spacing[2])}`,
            fontSize: t.fontSize.md,
            fontWeight: 600,
            color: t.colors.text,
          }}
        >
          Advanced setup (development)
        </h2>
        <p style={{ margin: `0 0 ${px(t.spacing[5])}`, fontSize: t.fontSize.sm, color: t.colors.textMuted, lineHeight: t.lineHeight.relaxed }}>
          {isProductionBuild ? (
            <>Shipped builds use the Youmi Lens cloud service for speech and summaries. You should not need this screen.</>
          ) : (
            <>
              On your machine, the app can send audio to a small local server (recommended) or use a one-off
              test credential stored <strong>only in this browser</strong>. End users will use the hosted
              service, not manual setup.
            </>
          )}
        </p>

        <label className="field" style={{ display: 'block', marginBottom: px(t.spacing[4]) }}>
          <span
            style={{
              fontSize: t.fontSize.xs,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: t.colors.textMuted,
            }}
          >
            Local test credential
          </span>
          <input
            type="password"
            className="login-screen__email-input"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginTop: px(t.spacing[2]),
              padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
              borderRadius: t.radii.lg,
              border: `1px solid ${t.colors.border}`,
              fontSize: t.fontSize.base,
              fontFamily: 'ui-monospace, monospace',
            }}
          />
        </label>
        {apiKey.trim() ? (
          <p style={{ margin: `0 0 ${px(t.spacing[4])}`, fontSize: t.fontSize.sm, color: t.colors.success }}>
            Credential stored in this browser for local testing.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: px(t.spacing[3]), flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ds-btn ds-btn--primary"
            onClick={() => {
              onSave()
            }}
          >
            Save
          </button>
          <button type="button" className="ds-btn ds-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
