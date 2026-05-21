import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './AuthProvider.tsx'
import './index.css'
import App from './App.tsx'
import { StyleGuideApp } from './design-system/StyleGuideApp.tsx'
import { TauriAuthBridge } from './components/TauriAuthBridge.tsx'
import { isTauriAuthBridgePathname } from './lib/authRedirect'
import { OverlayApp } from './OverlayApp.tsx'

const isOverlay =
  typeof window !== 'undefined' && window.location.hash === '#__overlay'

// Apply overlay class synchronously — before first paint — so index.css transparent
// override wins over `:root { background: #fff }` without any flash.
if (isOverlay) {
  document.documentElement.classList.add('youmi-overlay')
  document.documentElement.style.setProperty('background', 'transparent', 'important')
  document.documentElement.style.setProperty('background-color', 'transparent', 'important')
  document.body.style.setProperty('background', 'transparent', 'important')
  document.body.style.setProperty('background-color', 'transparent', 'important')
}

const styleGuide =
  !isOverlay &&
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('styleguide') === '1'

const tauriBridge =
  !isOverlay &&
  typeof window !== 'undefined' && isTauriAuthBridgePathname(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOverlay ? (
      <OverlayApp />
    ) : styleGuide ? (
      <StyleGuideApp />
    ) : tauriBridge ? (
      <TauriAuthBridge />
    ) : (
      <AuthProvider>
        {import.meta.env.DEV ? (
          <div className="debug-build-banner" aria-hidden="true">
            DEBUG BUILD V3
          </div>
        ) : null}
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
)
