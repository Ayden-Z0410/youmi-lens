import { useState } from 'react'
import { useUpdater } from '../lib/updater/useUpdater'
import {
  updaterStatusLabel,
  updaterEntryVisible,
  type RecordingSafetyState,
} from '../lib/updater/updaterCore'

/**
 * Minimal lower-left updater affordance (Phase 2E). Not a sidebar redesign — a
 * single unobtrusive element: the current version (muted) when up to date, or an
 * "Update available / Downloading / Restart to update / Update failed" chip when
 * actionable. Clicking opens a compact modal with release notes + actions. The
 * modal's Install is gated by the recording-safety rule (never interrupts a
 * lecture that is recording, paused-but-unfinished, or still saving).
 */
export function UpdaterEntry({ recordingSafety }: { recordingSafety: RecordingSafetyState }) {
  const up = useUpdater(recordingSafety)
  const [open, setOpen] = useState(false)
  const actionable = updaterEntryVisible(up.status)

  // Hidden on web/dev (no app version, nothing to update) unless actionable.
  if (!actionable && !up.currentVersion) return null

  const chip = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={actionable ? updaterStatusLabel(up.status) : `Youmi Lens ${up.currentVersion || ''}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 10px',
        borderRadius: 9,
        border: '1px solid transparent',
        background: actionable ? 'rgba(6,27,52,0.06)' : 'transparent',
        color: actionable ? '#0b1f3b' : '#8492a6',
        fontSize: 12,
        fontWeight: actionable ? 600 : 500,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {actionable ? (
        <>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: up.status === 'error' ? '#b91c1c' : '#2f65b7',
              flexShrink: 0,
            }}
          />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {up.status === 'downloading' && up.progress != null
              ? `Downloading update… ${up.progress}%`
              : updaterStatusLabel(up.status)}
          </span>
        </>
      ) : (
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Youmi Lens {up.currentVersion ? `v${up.currentVersion}` : ''}
        </span>
      )}
    </button>
  )

  return (
    <div className="ds-root" style={{ padding: '4px 6px' }}>
      {chip}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Software update"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(9,16,28,0.42)',
            padding: 24,
          }}
        >
          <div
            style={{
              width: 'min(440px, 100%)',
              background: '#fff',
              borderRadius: 16,
              padding: 22,
              boxShadow: '0 30px 80px rgba(6,27,52,0.35)',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, color: '#0b1f3b' }}>
              {up.status === 'up-to-date' || (up.status === 'idle' && !up.newVersion)
                ? 'You’re up to date'
                : up.newVersion
                  ? 'Update available'
                  : 'Software update'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
              Current version {up.currentVersion ? `v${up.currentVersion}` : '—'}
              {up.newVersion ? ` · New version v${up.newVersion}` : ''}
            </div>

            {up.releaseNotes && (
              <div
                style={{
                  maxHeight: 200,
                  overflow: 'auto',
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: '#1a2c46',
                  background: '#f5f7fa',
                  border: '1px solid rgba(6,27,52,0.08)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 14,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {up.releaseNotes}
              </div>
            )}

            {up.status === 'downloading' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(6,27,52,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${up.progress ?? 0}%`, height: '100%', background: '#0b1f3b', transition: 'width .2s' }} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Downloading update… {up.progress ?? 0}%</div>
              </div>
            )}

            {up.blockedReason && (
              <div style={{ fontSize: 13, color: '#b45309', marginBottom: 14, lineHeight: 1.5 }}>{up.blockedReason}</div>
            )}
            {up.error && (
              <div style={{ fontSize: 13, color: '#b91c1c', marginBottom: 14, lineHeight: 1.5 }}>{up.error}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="ds-btn ds-btn--secondary" onClick={() => setOpen(false)}>
                Later
              </button>

              {up.error ? (
                <button type="button" className="ds-btn ds-btn--primary" onClick={() => void up.actions.check()}>
                  Retry
                </button>
              ) : up.status === 'available' ? (
                <button type="button" className="ds-btn ds-btn--primary" onClick={() => void up.actions.download()}>
                  Download update
                </button>
              ) : up.status === 'ready' ? (
                <button type="button" className="ds-btn ds-btn--primary" onClick={() => void up.actions.installAndRestart()}>
                  Install and restart
                </button>
              ) : up.status === 'downloading' || up.status === 'installing' ? (
                <button type="button" className="ds-btn ds-btn--primary" disabled aria-busy="true">
                  {updaterStatusLabel(up.status)}
                </button>
              ) : (
                <button type="button" className="ds-btn ds-btn--primary" onClick={() => void up.actions.check()}>
                  Check for updates
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
