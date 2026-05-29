/**
 * Lecture Overlay – final production UI.
 *
 * Design spec:
 *  Expanded  600 × 118 px — deep navy frosted glass card
 *  Compact   260 × 56  px — deep navy frosted glass pill, no large blank window
 *
 * Collapse / expand calls Tauri commands to resize the actual native window.
 * The React component renders content appropriate for the current mode.
 */

import { useState, useCallback } from 'react'

// ── Public types ───────────────────────────────────────────────────────────────

export interface OverlayCaptionState {
  primaryBlack: string
  primaryGray: string
  secondaryBlack: string
  secondaryGray: string
  recorderStatus: 'idle' | 'recording' | 'paused'
  translateActive: boolean
  elapsedSec: number
}

type DisplayMode = 'bilingual' | 'primary' | 'translation'

// ── Design constants ───────────────────────────────────────────────────────────

const PEARL      = 'rgba(255,255,255,0.92)'
const PEARL_78   = 'rgba(255,255,255,0.78)'
const PEARL_62   = 'rgba(255,255,255,0.62)'
const PEARL_42   = 'rgba(255,255,255,0.42)'
const PEARL_18   = 'rgba(255,255,255,0.18)'
const PEARL_12   = 'rgba(255,255,255,0.12)'
const PEARL_08   = 'rgba(255,255,255,0.08)'
const GREEN      = '#35C76F'
const FONT       = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif'

const GLASS_BG      = 'linear-gradient(135deg, rgba(6,27,52,0.78), rgba(20,54,88,0.58))'
const GLASS_BLUR    = 'blur(32px) saturate(160%)'
const GLASS_BORDER  = '1px solid rgba(255,255,255,0.18)'
// No outer drop shadow: the overlay window is transparent + native NSWindow
// shadow is disabled, so any outer box-shadow would either get clipped by the
// rectangular window frame or leak into the four rounded-corner cutouts and
// reveal a rectangular boundary. Keep only the inset top highlight.
const GLASS_SHADOW  = 'inset 0 1px 0 rgba(255,255,255,0.18)'
const RADIUS_CARD   = 28
const RADIUS_PILL   = 999

// ── Tauri helpers ──────────────────────────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function invokeCmd(cmd: string): void {
  if (!isTauri()) return
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke(cmd)).catch(() => {})
}

function startWindowDrag(): void {
  if (!isTauri()) return
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    void getCurrentWindow().startDragging().catch(() => {})
  })
}

// ── Elapsed time formatter ─────────────────────────────────────────────────────

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function YBadge() {
  return (
    <div
      style={{
        width: 28, height: 28,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{
        color: PEARL,
        fontSize: 15,
        fontWeight: 700,
        fontFamily: FONT,
        lineHeight: 1,
        letterSpacing: '-0.03em',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}>Y</span>
    </div>
  )
}

function LangPill({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: PEARL_12,
      border: '1px solid rgba(255,255,255,0.10)',
      color: PEARL_78,
      fontSize: 12,
      fontWeight: 650,
      fontFamily: FONT,
      letterSpacing: '0.03em',
      lineHeight: 1,
      padding: '4px 0',
      borderRadius: 8,
      width: 38,
      flexShrink: 0,
      userSelect: 'none',
      WebkitUserSelect: 'none',
      textAlign: 'center',
    }}>
      {label}
    </span>
  )
}

function HeaderBtn({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      // Stop the press from bubbling to the header's drag handler. On Windows
      // WebView2, starting a window drag on mousedown swallows the click, so
      // without this the button needs multiple clicks. Drag still works from
      // the non-interactive header background.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? PEARL_12 : 'transparent',
        border: '1px solid transparent',
        borderRadius: 7,
        color: hov ? PEARL : PEARL_62,
        cursor: 'pointer',
        fontFamily: FONT,
        fontSize: '0.88rem',
        fontWeight: 400,
        lineHeight: 1,
        padding: '4px 7px',
        transition: 'background 0.10s, color 0.10s',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}

const MODE_LABELS: Record<DisplayMode, string> = {
  bilingual: 'Bilingual',
  primary: 'Primary',
  translation: 'Translation',
}

function ModeBtn({
  mode,
  translateActive,
  onCycle,
}: {
  mode: DisplayMode
  translateActive: boolean
  onCycle: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      title={translateActive ? 'Cycle display mode' : 'Translation not active'}
      onClick={translateActive ? onCycle : undefined}
      // See HeaderBtn: keep the click off the header drag region (Windows fix).
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 30,
        padding: '0 10px',
        background: hov && translateActive ? PEARL_18 : PEARL_08,
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 12,
        color: PEARL,
        cursor: translateActive ? 'pointer' : 'default',
        fontFamily: FONT,
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1,
        transition: 'background 0.10s',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        flexShrink: 0,
      }}
    >
      {MODE_LABELS[mode]}
      {translateActive && <span style={{ fontSize: '0.65rem', opacity: 0.65, marginLeft: 2 }}>▾</span>}
    </button>
  )
}

// ── Caption row ────────────────────────────────────────────────────────────────

function CaptionRow({
  lang,
  committed,
  draft,
  placeholder,
}: {
  lang: 'EN' | '中'
  committed: string
  draft: string
  placeholder: string
}) {
  const hasContent = committed.trim() || draft.trim()
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
      overflow: 'hidden',
    }}>
      <LangPill label={lang} />
      {/*
        Natural left-to-right caption row. The helper in
        src/lib/overlayCaption.ts already trims to a short tail (~55 EN
        / ~28 ZH chars) that fits this row width, so we render text
        normally — left-aligned, single-line, no ellipsis. If text ever
        overflows by a few chars, `overflow: hidden` clips on the right
        edge silently (no "..."); the helper's tight char budget keeps
        that case rare.
      */}
      <span style={{
        flex: 1,
        minWidth: 0,
        color: hasContent ? PEARL : PEARL_42,
        fontSize: 17,
        fontWeight: 450,
        lineHeight: 1.35,
        fontStyle: hasContent ? 'normal' : 'italic',
        fontFamily: FONT,
        textAlign: 'left',
        direction: 'ltr',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}>
        {committed && <span>{committed}</span>}
        {draft && (
          <span style={{ color: PEARL_62, fontStyle: 'italic' }}>
            {committed ? ' ' : ''}
            {draft}
          </span>
        )}
        {!hasContent && placeholder}
      </span>
    </div>
  )
}

// ── Compact pill ───────────────────────────────────────────────────────────────

export function CompactPill({
  recorderStatus,
  onExpand,
}: {
  recorderStatus: OverlayCaptionState['recorderStatus']
  onExpand: () => void
}) {
  const isRecording = recorderStatus === 'recording'
  return (
    <div
      onMouseDown={(e) => { if (e.button === 0) startWindowDrag() }}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        background: 'transparent',
        overflow: 'hidden',
        cursor: 'grab',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: GLASS_BG,
          backdropFilter: GLASS_BLUR,
          WebkitBackdropFilter: GLASS_BLUR,
          border: GLASS_BORDER,
          borderRadius: RADIUS_PILL,
          boxShadow: GLASS_SHADOW,
          padding: '0 16px 0 15px',
          height: '100%',
          boxSizing: 'border-box',
          fontFamily: FONT,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          width: '100%',
          maxWidth: 'none',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            width: 8, height: 8,
            borderRadius: '50%',
            background: isRecording ? GREEN : PEARL_42,
            boxShadow: isRecording ? '0 0 10px rgba(53,199,111,0.36)' : 'none',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: PEARL,
            fontSize: 14,
            fontWeight: 500,
            flex: 1,
            minWidth: 0,
          }}
        >
          Youmi {isRecording ? 'Listening' : recorderStatus === 'paused' ? 'Paused' : 'Stopped'}
        </span>
        <button
          type="button"
          title="Expand overlay"
          onClick={onExpand}
          // See HeaderBtn: keep the click off the pill drag region (Windows fix).
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: 'transparent',
            border: 'none',
            color: PEARL_62,
            cursor: 'pointer',
            fontFamily: FONT,
            fontSize: '1.0rem',
            lineHeight: 1,
            padding: '3px 4px',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            flexShrink: 0,
          }}
        >
          ⌃
        </button>
      </div>
    </div>
  )
}

// ── Expanded card ──────────────────────────────────────────────────────────────

export function OverlayWindow({ captions }: { captions: OverlayCaptionState }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<DisplayMode>('bilingual')

  const {
    primaryBlack, primaryGray,
    secondaryBlack, secondaryGray,
    recorderStatus, translateActive, elapsedSec,
  } = captions

  // If translation goes offline, fall back to primary-only
  const effectiveMode: DisplayMode =
    !translateActive && mode !== 'primary' ? 'primary' : mode

  const cycleMode = useCallback(() => {
    setMode(m =>
      m === 'bilingual' ? 'primary' : m === 'primary' ? 'translation' : 'bilingual'
    )
  }, [])

  const handleCollapse = useCallback(() => {
    setCollapsed(true)
    invokeCmd('resize_overlay_compact')
  }, [])

  const handleExpand = useCallback(() => {
    setCollapsed(false)
    invokeCmd('resize_overlay_expanded')
  }, [])

  // ── Compact pill ────────────────────────────────────────────────────────────
  if (collapsed) {
    return <CompactPill recorderStatus={recorderStatus} onExpand={handleExpand} />
  }

  // ── Expanded card ───────────────────────────────────────────────────────────
  const showPrimary     = effectiveMode === 'bilingual' || effectiveMode === 'primary'
  const showSecondary   = translateActive && (effectiveMode === 'bilingual' || effectiveMode === 'translation')
  const isRecording     = recorderStatus === 'recording'

  const enPlaceholder   = isRecording ? 'Waiting for live captions…' : 'No captions yet.'
  const zhPlaceholder   = isRecording
    ? (primaryGray.trim() ? 'Translating…' : '正在等待实时字幕…')
    : '暂无翻译。'

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: GLASS_BG,
      backdropFilter: GLASS_BLUR,
      WebkitBackdropFilter: GLASS_BLUR,
      border: GLASS_BORDER,
      borderRadius: RADIUS_CARD,
      boxShadow: GLASS_SHADOW,
      overflow: 'hidden',
      boxSizing: 'border-box',
      fontFamily: FONT,
    }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        onMouseDown={(e) => { if (e.button === 0) startWindowDrag() }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 12px 7px',
          flexShrink: 0,
          cursor: 'grab',
        }}
      >
        {/* Left */}
        <YBadge />

        <span
          style={{
            color: PEARL,
            fontSize: 15,
            fontWeight: 650,
            letterSpacing: '-0.015em',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            flexShrink: 0,
          }}
        >
          Youmi Lens
        </span>

        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isRecording ? GREEN : PEARL_42,
          boxShadow: isRecording ? '0 0 10px rgba(53,199,111,0.36)' : 'none',
          flexShrink: 0, marginLeft: 2,
        }} />

        <span
          style={{
            color: isRecording ? GREEN : PEARL_62,
            fontSize: 14,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {isRecording ? 'Listening' : recorderStatus === 'paused' ? 'Paused' : 'Stopped'}
        </span>

        {recorderStatus !== 'idle' && (
          <span
            style={{
              color: PEARL_62,
              fontSize: 14,
              fontWeight: 400,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
            }}
          >
            {formatElapsed(elapsedSec)}
          </span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1, minWidth: 0 }} />

        {/* Right controls */}
        <ModeBtn mode={effectiveMode} translateActive={translateActive} onCycle={cycleMode} />
        <HeaderBtn label="—" title="Collapse to pill (recording continues)" onClick={handleCollapse} />
        <HeaderBtn label="↩" title="Bring Youmi Lens window to front" onClick={() => invokeCmd('focus_main_window')} />
        <HeaderBtn label="×" title="Close overlay (recording continues)" onClick={() => invokeCmd('hide_overlay')} />
      </div>

      {/* ── Hairline separator ──────────────────────────────────────────── */}
      <div style={{ height: 1, background: PEARL_12, margin: '0 12px', flexShrink: 0 }} />

      {/* ── Caption rows ────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 5,
        padding: '6px 12px 8px',
        overflow: 'hidden',
        minHeight: 0,
      }}>
        {showPrimary && (
          <CaptionRow
            lang="EN"
            committed={primaryBlack}
            draft={primaryGray}
            placeholder={enPlaceholder}
          />
        )}
        {showSecondary && (
          <CaptionRow
            lang="中"
            committed={secondaryBlack}
            draft={secondaryGray}
            placeholder={zhPlaceholder}
          />
        )}
        {effectiveMode === 'translation' && !showPrimary && !translateActive && (
          <CaptionRow lang="中" committed="" draft="" placeholder={zhPlaceholder} />
        )}
      </div>
    </div>
  )
}
