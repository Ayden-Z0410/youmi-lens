import { useEffect, useState } from 'react'
import { designTokens } from '../design-system/tokens'
import type { AiSourceMode } from '../lib/ai/aiSource'
import {
  getAiSource,
  getByokApiKey,
  getByokProvider,
  setAiSource,
  setByokApiKey,
  setByokProvider,
} from '../lib/ai/aiSource'
import type { ByokProviderId } from '../lib/ai/providers/types'

/** User-visible only: capability hints, no vendor or service codenames. */
const BYOK_LABELS: Record<ByokProviderId, string> = {
  openai: 'Full lecture features (transcription, live captions, summaries)',
  deepseek: 'Text features only — summaries & translation (no class-audio transcription)',
  qwen: 'Text features only — alternate path (no class-audio transcription)',
}

type Props = {
  /** When false, BYOK options are hidden (e.g. extreme dev-only builds). */
  allowByok: boolean
}

export function AiPreferencesSection({ allowByok }: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`

  const [mode, setMode] = useState<AiSourceMode>('youmi')
  const [provider, setProvider] = useState<ByokProviderId>('openai')
  const [key, setKey] = useState('')

  useEffect(() => {
    setMode(getAiSource())
    setProvider(getByokProvider())
    setKey(getByokApiKey())
  }, [])

  const persist = (nextMode: AiSourceMode, p: ByokProviderId, k: string) => {
    setAiSource(nextMode)
    setByokProvider(p)
    setByokApiKey(k)
  }

  return (
    <div
      style={{
        marginBottom: px(t.spacing[6]),
        paddingBottom: px(t.spacing[6]),
        borderBottom: `1px solid ${t.colors.border}`,
      }}
    >
      <h3
        style={{
          margin: `0 0 ${px(t.spacing[2])}`,
          fontSize: t.fontSize.sm,
          fontWeight: 600,
          color: t.colors.text,
        }}
      >
        AI
      </h3>
      <p style={{ margin: `0 0 ${px(t.spacing[4])}`, fontSize: t.fontSize.sm, color: t.colors.textMuted }}>
        Default is Youmi AI — no setup required. Advanced: use your own API key and pick the connection type that
        matches your account.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: px(t.spacing[3]) }}>
        <label
          style={{
            display: 'flex',
            gap: px(t.spacing[3]),
            alignItems: 'flex-start',
            cursor: allowByok ? 'pointer' : 'default',
          }}
        >
          <input
            type="radio"
            name="ai-source"
            checked={mode === 'youmi'}
            disabled={!allowByok && mode !== 'youmi'}
            onChange={() => {
              setMode('youmi')
              persist('youmi', provider, key)
            }}
          />
          <span>
            <strong>Youmi AI</strong>
            <span style={{ display: 'block', fontSize: t.fontSize.xs, color: t.colors.textMuted }}>
              Recommended  runs on our service after you sign in.
            </span>
          </span>
        </label>

        {allowByok ? (
          <label style={{ display: 'flex', gap: px(t.spacing[3]), alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="ai-source"
              checked={mode === 'byok'}
              onChange={() => {
                setMode('byok')
                persist('byok', provider, key)
              }}
            />
            <span style={{ flex: 1 }}>
              <strong>Use my own API key</strong>
              <span style={{ display: 'block', fontSize: t.fontSize.xs, color: t.colors.textMuted, marginBottom: px(t.spacing[2]) }}>
                For advanced users. Your key stays in this browser only unless you use cloud features (sent securely to process requests).
              </span>
              {mode === 'byok' ? (
                <>
                  <label className="field" style={{ display: 'block', marginBottom: px(t.spacing[2]) }}>
                    <span
                      style={{
                        fontSize: t.fontSize.xs,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: t.colors.textMuted,
                      }}
                    >
                      Connection type
                    </span>
                    <select
                      className="login-screen__email-input"
                      value={provider}
                      onChange={(e) => {
                        const p = e.target.value as ByokProviderId
                        setProvider(p)
                        persist('byok', p, key)
                      }}
                      style={{
                        width: '100%',
                        marginTop: px(t.spacing[2]),
                        padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
                        borderRadius: t.radii.lg,
                        border: `1px solid ${t.colors.border}`,
                        fontSize: t.fontSize.base,
                      }}
                    >
                      {(Object.keys(BYOK_LABELS) as ByokProviderId[]).map((id) => (
                        <option key={id} value={id}>
                          {BYOK_LABELS[id]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ display: 'block' }}>
                    <span
                      style={{
                        fontSize: t.fontSize.xs,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: t.colors.textMuted,
                      }}
                    >
                      API key
                    </span>
                    <input
                      type="password"
                      className="login-screen__email-input"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      onBlur={() => persist(mode, provider, key)}
                      placeholder="Paste key once per device"
                      style={{
                        width: '100%',
                        marginTop: px(t.spacing[2]),
                        padding: `${px(t.spacing[3])} ${px(t.spacing[4])}`,
                        borderRadius: t.radii.lg,
                        border: `1px solid ${t.colors.border}`,
                        fontSize: t.fontSize.base,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    />
                  </label>
                </>
              ) : null}
            </span>
          </label>
        ) : null}
      </div>
    </div>
  )
}
