/**
 * AppearanceSettings — small card of presentational appearance toggles. Mock
 * state only — toggling is not wired to any real theme switch yet.
 */
import type { AppearanceOption } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { ToggleSwitch } from './ToggleSwitch'

export function AppearanceSettings({ options }: { options: AppearanceOption[] }) {
  return (
    <GlassCard title="Appearance" subtitle="Dashboard look & feel">
      <div className="yw-settings-list">
        {options.map((option) => (
          <div key={option.id} className="yw-setting-row">
            <span className="yw-setting-row__label">{option.label}</span>
            <ToggleSwitch on={option.enabled} label={option.label} />
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
