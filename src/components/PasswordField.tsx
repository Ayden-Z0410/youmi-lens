import { useId, useState, type ChangeEvent } from 'react'
import { designTokens } from '../design-system/tokens'

type Props = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Accessible label rendered above the input. */
  label?: string
  /** HTML id; defaults to a generated one. */
  id?: string
  /** Auto-complete hint (e.g. "current-password", "new-password"). */
  autoComplete?: string
  /** When true, parent business logic is busy — visually still editable but you can opt to disable. */
  disabled?: boolean
  /** Optional minLength hint for the browser; client validation lives in caller. */
  minLength?: number
  onEnter?: () => void
}

/**
 * Password input with a built-in eye-toggle that flips between `type="password"` and `type="text"`.
 *
 * Toggling never clears the input — we mutate `type` only and keep the controlled `value`.
 */
export function PasswordField({
  value,
  onChange,
  placeholder,
  label,
  id,
  autoComplete = 'current-password',
  disabled,
  minLength,
  onEnter,
}: Props) {
  const t = designTokens
  const px = (n: number) => `${n}px`
  const generatedId = useId()
  const inputId = id ?? `pw-${generatedId}`
  const [visible, setVisible] = useState(false)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }

  return (
    <div style={{ width: '100%' }}>
      {label ? (
        <label
          htmlFor={inputId}
          style={{
            display: 'block',
            fontSize: t.fontSize.sm,
            fontWeight: 600,
            color: t.colors.text,
            marginBottom: px(t.spacing[2]),
          }}
        >
          {label}
        </label>
      ) : null}
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          className="login-screen__email-input auth-input"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          minLength={minLength}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault()
              onEnter()
            }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: `${px(t.spacing[3])} ${px(t.spacing[10])} ${px(t.spacing[3])} ${px(t.spacing[4])}`,
            borderRadius: t.radii.lg,
            border: `1px solid ${t.colors.border}`,
            fontSize: t.fontSize.base,
            background: t.colors.surface,
            color: t.colors.text,
            caretColor: t.colors.accent,
            letterSpacing: 'normal',
          }}
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onMouseDown={(e) => {
            // Prevent the click from blurring the input (which loses caret position).
            e.preventDefault()
          }}
          onClick={() => setVisible((v) => !v)}
          style={{
            position: 'absolute',
            top: '50%',
            right: px(t.spacing[2]),
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: t.colors.textMuted,
            cursor: 'pointer',
            borderRadius: t.radii.md,
          }}
        >
          <EyeIcon hidden={!visible} />
        </button>
      </div>
    </div>
  )
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  // Outline eye / eye-off. Matches Lucide-style stroke without adding a dep.
  if (hidden) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.36 18.36 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    )
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
