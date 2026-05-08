/**
 * OverlayApp — root for the floating Lecture Overlay window.
 *
 * This component is rendered when the window URL hash is `#__overlay`.
 * It has no AuthProvider, no Supabase, no recording logic.
 * It solely listens for caption events emitted by the main App window and
 * renders the <OverlayWindow> UI.
 *
 * Events consumed (emitted by App.tsx via Tauri global event bus):
 *   youmi:overlay-captions  — { primaryBlack, primaryGray, secondaryBlack, secondaryGray }
 *   youmi:overlay-status    — { recorderStatus, translateActive }
 */

import { useEffect, useState, useRef } from 'react'
import { type OverlayCaptionState, OverlayWindow } from './components/overlay/OverlayWindow'

const DEFAULT_STATE: OverlayCaptionState = {
  primaryBlack: '',
  primaryGray: '',
  secondaryBlack: '',
  secondaryGray: '',
  recorderStatus: 'idle',
  translateActive: false,
  elapsedSec: 0,
}

type CaptionPayload = Pick<
  OverlayCaptionState,
  'primaryBlack' | 'primaryGray' | 'secondaryBlack' | 'secondaryGray'
>
type StatusPayload = Pick<OverlayCaptionState, 'recorderStatus' | 'translateActive' | 'elapsedSec'>

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function OverlayApp() {
  const [state, setState] = useState<OverlayCaptionState>(DEFAULT_STATE)
  // Keep a ref so event handlers always close over latest state
  const stateRef = useRef(state)
  stateRef.current = state

  // Make html/body transparent so the rounded overlay corners show the desktop
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.documentElement.style.margin = '0'
    document.documentElement.style.padding = '0'
    document.body.style.margin = '0'
    document.body.style.padding = '0'
    document.body.style.overflow = 'hidden'
  }, [])

  // Subscribe to Tauri events from main window
  useEffect(() => {
    if (!isTauri()) return

    let unlistenCaptions: (() => void) | null = null
    let unlistenStatus: (() => void) | null = null

    void import('@tauri-apps/api/event').then(({ listen }) => {
      void listen<CaptionPayload>('youmi:overlay-captions', (event) => {
        const { primaryBlack, primaryGray, secondaryBlack, secondaryGray } = event.payload
        setState((prev) => ({ ...prev, primaryBlack, primaryGray, secondaryBlack, secondaryGray }))
      }).then((fn) => {
        unlistenCaptions = fn
      })

      void listen<StatusPayload>('youmi:overlay-status', (event) => {
        const { recorderStatus, translateActive, elapsedSec } = event.payload
        setState((prev) => ({ ...prev, recorderStatus, translateActive, elapsedSec }))
      }).then((fn) => {
        unlistenStatus = fn
      })
    })

    return () => {
      unlistenCaptions?.()
      unlistenStatus?.()
    }
  }, [])

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      <OverlayWindow captions={state} />
    </div>
  )
}
