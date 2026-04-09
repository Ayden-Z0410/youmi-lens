import { useState } from 'react'
import { designTokens } from './tokens'
import './tokens.css'
import { YoumiLensMarkY } from '../branding/YoumiLensMarkY'
import { YoumiLensMonogramY } from '../branding/YoumiLensMonogramY'
import { LoginPreview } from './previews/LoginPreview'
import { MainShellPreview } from './previews/MainShellPreview'

type TabId = 'tokens' | 'buttons' | 'brand' | 'login' | 'shell'

const px = (n: number) => `${n}px`

const tabs: { id: TabId; label: string }[] = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'brand', label: 'Brand assets' },
  { id: 'login', label: 'Login' },
  { id: 'shell', label: 'Main shell' },
]

export function StyleGuideApp() {
  const [tab, setTab] = useState<TabId>('tokens')

  return (
    <div
      className="ds-root"
      style={{
        minHeight: '100vh',
        background: designTokens.colors.bgPage,
        color: designTokens.colors.text,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, PingFang SC, sans-serif',
        fontSize: designTokens.fontSize.base,
        lineHeight: designTokens.lineHeight.normal,
      }}
    >
      <header
        style={{
          borderBottom: `1px solid ${designTokens.colors.border}`,
          background: designTokens.colors.surface,
          padding: `${px(designTokens.spacing[4])} ${px(designTokens.spacing[6])}`,
        }}
      >
        <h1 style={{ margin: 0, fontSize: designTokens.fontSize.xl, fontWeight: 600 }}>
          Youmi Lens - design system (dev)
        </h1>
        <p style={{ margin: `${px(designTokens.spacing[2])} 0 0`, color: designTokens.colors.textMuted, fontSize: designTokens.fontSize.sm }}>
          Scoped under <code>.ds-root</code>; main app unchanged. Add <code>?styleguide=1</code> in development.
        </p>
      </header>

      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: px(designTokens.spacing[2]),
          padding: px(designTokens.spacing[4]),
          borderBottom: `1px solid ${designTokens.colors.border}`,
          background: designTokens.colors.surface,
        }}
        aria-label="Style guide sections"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'ds-btn ds-btn--primary' : 'ds-btn ds-btn--secondary'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: tab === 'login' ? 0 : px(designTokens.spacing[6]), maxWidth: tab === 'login' ? 'none' : 1200, margin: tab === 'login' ? 0 : '0 auto' }}>
        {tab === 'tokens' ? <TokenPanel /> : null}
        {tab === 'buttons' ? <ButtonPanel /> : null}
        {tab === 'brand' ? <BrandAssetsPanel /> : null}
        {tab === 'login' ? <LoginPreview embedded /> : null}
        {tab === 'shell' ? (
          <section>
            <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Main shell (YoumiLensShell)</h2>
            <p style={{ color: designTokens.colors.textMuted, marginBottom: px(designTokens.spacing[4]) }}>
              Uses <code>yl-*</code> classes from <code>youmiLensShell.css</code>; independent of <code>--ds-*</code> until you align them.
            </p>
            <MainShellPreview />
          </section>
        ) : null}
      </main>
    </div>
  )
}

function TokenPanel() {
  const colorEntries = Object.entries(designTokens.colors) as [string, string][]
  const spacingEntries = Object.entries(designTokens.spacing).filter(([k]) => k !== 'px') as [string, number][]
  const radiiEntries = Object.entries(designTokens.radii) as [string, number][]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: px(designTokens.spacing[8]) }}>
      <section>
        <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Colors</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: px(designTokens.spacing[3]),
          }}
        >
          {colorEntries.map(([name, hex]) => (
            <div key={name} className="ds-card" style={{ padding: px(designTokens.spacing[3]), overflow: 'hidden' }}>
              <div
                style={{
                  height: 56,
                  borderRadius: designTokens.radii.md,
                  background: hex,
                  border: name === 'bgPage' || name === 'surface' ? `1px solid ${designTokens.colors.border}` : undefined,
                  marginBottom: px(designTokens.spacing[2]),
                }}
              />
              <div style={{ fontSize: designTokens.fontSize.xs, fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: designTokens.fontSize.xs, color: designTokens.colors.textMuted }}>{hex}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Spacing (px scale)</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(designTokens.spacing[4]), alignItems: 'flex-end' }}>
          {spacingEntries.map(([key, val]) => (
            <div key={key} style={{ textAlign: 'center' }}>
              <div
                style={{
                  height: Math.max(val, 4),
                  width: Math.max(val, 4),
                  background: designTokens.colors.highlight,
                  borderRadius: 4,
                  margin: '0 auto',
                }}
              />
              <div style={{ fontSize: designTokens.fontSize.xs, marginTop: px(designTokens.spacing[1]) }}>
                {key}: {val}px
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Radii</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(designTokens.spacing[4]), alignItems: 'flex-end' }}>
          {radiiEntries.map(([key, val]) => (
            <div key={key} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 72,
                  height: 48,
                  background: designTokens.colors.secondary,
                  borderRadius: val === 9999 ? 9999 : val,
                  margin: '0 auto',
                }}
              />
              <div style={{ fontSize: designTokens.fontSize.xs, marginTop: px(designTokens.spacing[1]) }}>
                {key}: {val === 9999 ? 'full' : `${val}px`}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Typography</h2>
        <div className="ds-card" style={{ padding: px(designTokens.spacing[4]) }}>
          {(['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map((k) => (
            <p key={k} style={{ margin: `0 0 ${px(designTokens.spacing[2])}`, fontSize: designTokens.fontSize[k] }}>
              {k} - The quick brown fox (Youmi Lens)
            </p>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Shadows</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(designTokens.spacing[4]) }}>
          {(['none', 'sm', 'md', 'lg', 'focus'] as const).map((k) => (
            <div
              key={k}
              className="ds-card"
              style={{
                padding: px(designTokens.spacing[6]),
                boxShadow: designTokens.shadows[k],
                minWidth: 120,
                textAlign: 'center',
                fontSize: designTokens.fontSize.sm,
              }}
            >
              {k}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

const brandAssetRows = [
  {
    key: 'ip',
    src: '/brand/youmi-ip-character.png',
    name: 'Youmi IP character',
    use: 'Brand mascot and visual personality reference (deep sea blue, restrained, light-tech). Use to align illustration tone in marketing, onboarding, and empty states.',
    notSubstitute:
      'The corporate logo lockup, the app icon, in-product UI icons, or favicon. It is not a replacement mark for chrome or OS tiles.',
  },
  {
    key: 'lockup',
    src: '/brand/youmi-lens-logo-lockup.png',
    name: 'Youmi Lens logo lockup',
    use: 'Official horizontal identity: symbol + Youmi Lens wordmark. Headers, splash, about, decks, and external comms.',
    notSubstitute:
      'The app icon at Dock/Store sizes, symbol-only at favicon sizes, or the full IP illustration. Do not stretch or recolour outside brand rules.',
  },
  {
    key: 'icon',
    src: '/brand/youmi-lens-app-icon.png',
    name: 'Youmi Lens app icon',
    use: 'Application icon artwork for OS chrome, Dock, taskbar, and store listings (squircle tile + stylised Y).',
    notSubstitute:
      'The full wordmark lockup, marketing hero art, or the IP character. Not for inline page titles or replacing UI symbols inside the app shell.',
  },
] as const

function BrandAssetsPanel() {
  return (
    <section aria-label="Official brand reference images">
      <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Brand assets</h2>
      <p style={{ color: designTokens.colors.textMuted, marginBottom: px(designTokens.spacing[4]), maxWidth: 720 }}>
        Read-only reference for the three official baselines. Source files also live under{' '}
        <code style={{ fontSize: designTokens.fontSize.sm }}>docs/assets/brand/</code> in the repo.
      </p>

      <div
        className="ds-card"
        style={{
          marginBottom: px(designTokens.spacing[6]),
          padding: px(designTokens.spacing[4]),
          maxWidth: 720,
        }}
      >
        <h3 style={{ margin: `0 0 ${px(designTokens.spacing[2])}`, fontSize: designTokens.fontSize.md, fontWeight: 600 }}>
          Symbol system (dev)
        </h3>
        <p style={{ margin: `0 0 ${px(designTokens.spacing[3])}`, fontSize: designTokens.fontSize.sm, color: designTokens.colors.text, lineHeight: designTokens.lineHeight.relaxed }}>
          <strong>Master brand Y</strong> (extracted SVG): hero, decks, brand pages.{' '}
          <strong>UI monogram</strong> (simple Y): app shell, top bar, compact UI - same wordmark, calmer mark.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(designTokens.spacing[6]), alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: designTokens.fontSize.xs, color: designTokens.colors.textMuted, marginBottom: px(designTokens.spacing[2]) }}>
              Master mark (lockup path)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: px(designTokens.spacing[3]) }}>
              <YoumiLensMarkY variant="lockup" size={56} color={designTokens.colors.primary} aria-hidden />
              <span style={{ fontSize: designTokens.fontSize.lg, fontWeight: 600, letterSpacing: '-0.03em' }}>Youmi Lens</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: designTokens.fontSize.xs, color: designTokens.colors.textMuted, marginBottom: px(designTokens.spacing[2]) }}>
              UI monogram
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: px(designTokens.spacing[3]) }}>
              <YoumiLensMonogramY size={40} color={designTokens.colors.primary} aria-hidden />
              <span style={{ fontSize: designTokens.fontSize.lg, fontWeight: 600, letterSpacing: '-0.03em' }}>Youmi Lens</span>
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: px(designTokens.spacing[4]),
        }}
      >
        {brandAssetRows.map((row) => (
          <div key={row.key} className="ds-card" style={{ padding: px(designTokens.spacing[4]), overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 200,
                marginBottom: px(designTokens.spacing[3]),
                borderRadius: designTokens.radii.md,
                background: designTokens.colors.bgPage,
                border: `1px solid ${designTokens.colors.border}`,
              }}
            >
              <img
                src={row.src}
                alt=""
                width={280}
                height={280}
                style={{ maxWidth: '100%', maxHeight: 220, width: 'auto', height: 'auto', objectFit: 'contain' }}
                decoding="async"
                loading="lazy"
              />
            </div>
            <h3 style={{ margin: `0 0 ${px(designTokens.spacing[2])}`, fontSize: designTokens.fontSize.md, fontWeight: 600 }}>
              {row.name}
            </h3>
            <p style={{ margin: `0 0 ${px(designTokens.spacing[2])}`, fontSize: designTokens.fontSize.sm, color: designTokens.colors.text, lineHeight: designTokens.lineHeight.relaxed }}>
              <span style={{ fontWeight: 600 }}>Use: </span>
              {row.use}
            </p>
            <p style={{ margin: 0, fontSize: designTokens.fontSize.sm, color: designTokens.colors.textMuted, lineHeight: designTokens.lineHeight.relaxed }}>
              <span style={{ fontWeight: 600, color: designTokens.colors.text }}>Not a substitute for: </span>
              {row.notSubstitute}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ButtonPanel() {
  return (
    <section>
      <h2 style={{ marginTop: 0, fontSize: designTokens.fontSize.lg }}>Button states (.ds-btn)</h2>
      <p style={{ color: designTokens.colors.textMuted, marginBottom: px(designTokens.spacing[4]) }}>
        Primary / secondary / ghost; hover and active via CSS; focus ring on <code>:focus-visible</code>.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(designTokens.spacing[3]), alignItems: 'center' }}>
        <button type="button" className="ds-btn ds-btn--primary">
          Primary
        </button>
        <button type="button" className="ds-btn ds-btn--secondary">
          Secondary
        </button>
        <button type="button" className="ds-btn ds-btn--ghost">
          Ghost
        </button>
        <button type="button" className="ds-btn ds-btn--primary" disabled>
          Disabled
        </button>
      </div>
    </section>
  )
}
