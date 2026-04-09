import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './AuthProvider.tsx'
import './index.css'
import App from './App.tsx'
import { StyleGuideApp } from './design-system/StyleGuideApp.tsx'
import { TauriAuthBridge } from './components/TauriAuthBridge.tsx'
import { isTauriAuthBridgePathname } from './lib/authRedirect'

const styleGuide =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('styleguide') === '1'

const tauriBridge =
  typeof window !== 'undefined' && isTauriAuthBridgePathname(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {styleGuide ? (
      <StyleGuideApp />
    ) : tauriBridge ? (
      <TauriAuthBridge />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
)
