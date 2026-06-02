/**
 * AlertThresholds — alert threshold list for the Settings page. Each row shows a
 * threshold code chip and a toggle, consistent with the Alerts page rules. Mock
 * state only.
 */
import type { ThresholdRow } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { ToggleSwitch } from './ToggleSwitch'

export function AlertThresholds({ rows }: { rows: ThresholdRow[] }) {
  return (
    <GlassCard title="Alert Thresholds" subtitle="Per-provider warning thresholds">
      <div className="yw-settings-list">
        {rows.map((row) => (
          <div key={row.id} className="yw-setting-row">
            <span className="yw-setting-row__label">{row.label}</span>
            <span className="yw-setting-row__control">
              <span className="yw-code">{row.threshold}</span>
              <ToggleSwitch on={row.enabled} label={row.label} />
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
