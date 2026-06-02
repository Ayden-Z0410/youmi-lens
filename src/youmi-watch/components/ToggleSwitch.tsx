/**
 * ToggleSwitch — presentational on/off switch reused across the Settings page.
 * Reuses the shared .yw-switch styling. Non-interactive for now (mock state);
 * exposes its state via aria-label / title for accessibility.
 */
export function ToggleSwitch({ on, label }: { on: boolean; label?: string }) {
  const state = on ? 'On' : 'Off'
  return (
    <span
      className={`yw-switch${on ? ' is-on' : ''}`}
      role="img"
      aria-label={label ? `${label}: ${state}` : state}
      title={state}
    >
      <span className="yw-switch__knob" />
    </span>
  )
}
