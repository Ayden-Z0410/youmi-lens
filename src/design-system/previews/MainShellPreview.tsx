/**
 * Main window shell preview - wraps YoumiLensShell with default placeholders only.
 */
import { YoumiLensShell } from '../../components/YoumiLensShell'

export function MainShellPreview() {
  return (
    <div
      style={{
        width: '100%',
        minHeight: 'min(100vh, 900px)',
        overflow: 'auto',
        borderRadius: 12,
        border: '1px solid var(--ds-color-border, #e2e8f0)',
        boxShadow: 'var(--ds-shadow-md, 0 4px 12px rgba(15, 23, 42, 0.08))',
      }}
    >
      <YoumiLensShell />
    </div>
  )
}
