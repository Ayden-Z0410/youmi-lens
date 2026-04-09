import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import '../branding/youmiLensShell.css'
import { YoumiLensMonogramY } from '../branding/YoumiLensMonogramY'

export type YoumiLensShellProps = {
  /** One-line welcome under the brand (e.g. Welcome, {display name}) */
  welcomeLine?: string
  /** Optional right-side controls in the top bar */
  topBarActions?: ReactNode
  /** Sidebar: nav + history; default placeholders if omitted */
  sidebar?: ReactNode
  /** Lecture title row + record controls */
  recordingStrip?: ReactNode
  /** Hero, API/settings, backup, etc. Rendered below the strip, above transcript */
  mainExtra?: ReactNode
  /** Main transcript body (primary focus) */
  transcript?: ReactNode
  /** Summary / notes column */
  rightPanel?: ReactNode
  /** Replaces default subtitle under "Summary" in the right column header */
  summaryHint?: ReactNode
  /** Optional Youmi companion strip below transcript */
  companionHint?: ReactNode
}

/**
 * Low-fidelity layout shell for Youmi Lens desktop main UI.
 * Does not include business logic; pass existing UI fragments as children slots.
 */
export function YoumiLensShell({
  welcomeLine,
  topBarActions,
  sidebar,
  recordingStrip,
  mainExtra,
  transcript,
  rightPanel,
  summaryHint,
  companionHint,
}: YoumiLensShellProps) {
  const SHELL_WIDTH_KEY = 'yl_shell_widths_v1'
  const RESIZER_W = 8
  const LEFT_MIN = 220
  const LEFT_MAX = 520
  const RIGHT_MIN = 260
  const RIGHT_MAX = 620
  const MAIN_MIN = 480

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

  const readStoredWidths = () => {
    try {
      const raw = localStorage.getItem(SHELL_WIDTH_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { left?: unknown; right?: unknown }
      if (typeof parsed.left !== 'number' || typeof parsed.right !== 'number') return null
      return { left: parsed.left, right: parsed.right }
    } catch {
      return null
    }
  }

  const [leftWidth, setLeftWidth] = useState(() => readStoredWidths()?.left ?? 240)
  const [rightWidth, setRightWidth] = useState(() => readStoredWidths()?.right ?? 360)
  const [draggingResizer, setDraggingResizer] = useState<'left' | 'right' | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SHELL_WIDTH_KEY, JSON.stringify({ left: leftWidth, right: rightWidth }))
    } catch {
      /* ignore */
    }
  }, [leftWidth, rightWidth])

  useEffect(() => {
    const clampForViewport = () => {
      const total = window.innerWidth
      setLeftWidth((prevLeft) => {
        const leftBounded = clamp(prevLeft, LEFT_MIN, LEFT_MAX)
        const rightBounded = clamp(rightWidth, RIGHT_MIN, RIGHT_MAX)
        const leftMaxByMain = Math.max(LEFT_MIN, total - rightBounded - MAIN_MIN - 2 * RESIZER_W)
        return clamp(leftBounded, LEFT_MIN, leftMaxByMain)
      })
      setRightWidth((prevRight) => {
        const rightBounded = clamp(prevRight, RIGHT_MIN, RIGHT_MAX)
        const leftBounded = clamp(leftWidth, LEFT_MIN, LEFT_MAX)
        const rightMaxByMain = Math.max(RIGHT_MIN, total - leftBounded - MAIN_MIN - 2 * RESIZER_W)
        return clamp(rightBounded, RIGHT_MIN, rightMaxByMain)
      })
    }

    clampForViewport()
    window.addEventListener('resize', clampForViewport)
    return () => window.removeEventListener('resize', clampForViewport)
  }, [leftWidth, rightWidth])

  const shellStyle = useMemo(
    () =>
      ({
        '--yl-sidebar-w': `${Math.round(leftWidth)}px`,
        '--yl-right-w': `${Math.round(rightWidth)}px`,
      }) as CSSProperties,
    [leftWidth, rightWidth],
  )

  const startResize = (which: 'left' | 'right', clientX: number) => {
    const startLeft = leftWidth
    const startRight = rightWidth
    setDraggingResizer(which)

    const onMove = (e: PointerEvent) => {
      const total = window.innerWidth
      if (which === 'left') {
        const nextLeftRaw = startLeft + (e.clientX - clientX)
        const rightBounded = clamp(startRight, RIGHT_MIN, RIGHT_MAX)
        const leftMaxByMain = Math.max(LEFT_MIN, total - rightBounded - MAIN_MIN - 2 * RESIZER_W)
        setLeftWidth(clamp(nextLeftRaw, LEFT_MIN, Math.min(LEFT_MAX, leftMaxByMain)))
        return
      }
      const nextRightRaw = startRight - (e.clientX - clientX)
      const leftBounded = clamp(startLeft, LEFT_MIN, LEFT_MAX)
      const rightMaxByMain = Math.max(RIGHT_MIN, total - leftBounded - MAIN_MIN - 2 * RESIZER_W)
      setRightWidth(clamp(nextRightRaw, RIGHT_MIN, Math.min(RIGHT_MAX, rightMaxByMain)))
    }

    const onUp = () => {
      setDraggingResizer(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div className={`yl-shell${draggingResizer ? ' yl-shell--resizing' : ''}`} style={shellStyle}>
      <header className="yl-topbar">
        <div className="yl-topbar-lead">
          <div className="yl-brand">
            <span className="yl-brand-mark">
              <YoumiLensMonogramY size={21} color="currentColor" aria-hidden />
            </span>
            <span>Youmi Lens</span>
          </div>
          {welcomeLine ? (
            <p className="yl-welcome-line" role="status">
              {welcomeLine}
            </p>
          ) : null}
        </div>
        <div className="yl-topbar-actions">{topBarActions}</div>
      </header>

      <aside className="yl-sidebar">
        {sidebar ?? (
          <>
            <div className="yl-nav-section">
              <div className="yl-nav-section-label">Workspace</div>
              <nav className="yl-nav" aria-label="Workspace">
                <span className="yl-nav-item yl-active">Record</span>
                <span className="yl-nav-item">Library</span>
                <span className="yl-nav-item">Settings</span>
              </nav>
            </div>
            <div className="yl-sidebar-divider" aria-hidden />
            <div className="yl-history-section">
              <div className="yl-nav-section-label yl-nav-section-label--secondary">Recent</div>
              <div className="yl-history">
                <p className="yl-history-empty">No sessions yet (placeholder)</p>
              </div>
            </div>
          </>
        )}
      </aside>

      <div
        className="yl-col-resizer yl-col-resizer--left"
        role="separator"
        aria-label="Resize sidebar and main panel"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          startResize('left', e.clientX)
        }}
      />

      <main className="yl-main">
        <section className="yl-recording-strip" aria-label="Lecture and recording">
          {recordingStrip ?? (
            <>
              <div className="yl-recording-strip__lead">
                <p className="yl-recording-strip__eyebrow">Now</p>
                <h1 className="yl-lecture-title">Current lecture</h1>
                <p className="yl-meta">Course / duration / date (placeholder)</p>
              </div>
              <div className="yl-recording-strip__controls">
                <div className="yl-timer-block" title="Elapsed time (placeholder)">
                  <span className="yl-timer-label">Elapsed</span>
                  <span className="yl-timer">0:00</span>
                </div>
                <div className="yl-record-actions">
                  <button type="button" className="yl-btn-primary">
                    Start
                  </button>
                  <button type="button" className="yl-btn-ghost">
                    Stop &amp; save
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {mainExtra ? <div className="yl-main-extra">{mainExtra}</div> : null}

        <section className="yl-transcript-panel" aria-label="Transcript">
          <div className="yl-panel-label yl-panel-label--primary">Transcript</div>
          {transcript ?? (
            <div className="yl-transcript-placeholder">
              <p className="yl-transcript-line">
                Instructor outlines the midterm scope and mentions problem set four due next week.
              </p>
              <p className="yl-transcript-line">
                (Placeholder copy: live captions and segments would stream here. This panel stays the primary focus.)
              </p>
            </div>
          )}
        </section>

        {companionHint ? <div className="yl-companion-slot">{companionHint}</div> : null}
      </main>

      <div
        className="yl-col-resizer yl-col-resizer--right"
        role="separator"
        aria-label="Resize main and summary panel"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          startResize('right', e.clientX)
        }}
      />

      <aside className="yl-right" aria-label="Summary and notes">
        <div className="yl-summary-card">
          <header className="yl-summary-header">
            <div className="yl-panel-label">Summary</div>
            {summaryHint ?? (
              <p className="yl-summary-hint">Condensed takeaways from this session (placeholder)</p>
            )}
          </header>
          {rightPanel ?? (
            <div className="yl-summary-body">
              <section className="yl-summary-block" aria-label="Key points">
                <h3 className="yl-summary-block-title">Key points</h3>
                <p className="yl-summary-placeholder">Notes and highlights will appear here after processing.</p>
              </section>
              <section className="yl-summary-block" aria-label="Terms and references">
                <h3 className="yl-summary-block-title">Terms</h3>
                <p className="yl-summary-placeholder muted">Optional glossary from transcript (placeholder)</p>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
