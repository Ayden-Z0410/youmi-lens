/**
 * GlassCard — the primary translucent container for the Youmi Watch dashboard.
 * Frosted glass surface with a specular top hairline (see .yw-card in CSS).
 * Optionally renders a header row with title/subtitle and a right-aligned action.
 */
import type { ReactNode } from 'react'

export interface GlassCardProps {
  title?: ReactNode
  subtitle?: ReactNode
  /** Right-aligned header slot (e.g. a button or dropdown). */
  action?: ReactNode
  children?: ReactNode
  className?: string
}

export function GlassCard({ title, subtitle, action, children, className }: GlassCardProps) {
  const hasHeader = title != null || action != null
  return (
    <section className={`yw-card${className ? ` ${className}` : ''}`}>
      <div className="yw-card__pad">
        {hasHeader && (
          <header className="yw-card__head">
            <div>
              {title != null && <h2 className="yw-card__title">{title}</h2>}
              {subtitle != null && <p className="yw-card__subtitle">{subtitle}</p>}
            </div>
            {action != null && <div>{action}</div>}
          </header>
        )}
        {children}
      </div>
    </section>
  )
}
