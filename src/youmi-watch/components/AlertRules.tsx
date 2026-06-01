/**
 * Alert rules — the threshold/notification configuration table. Exposed as both
 * a standalone glass card (AlertRules) for the page and a bare table
 * (AlertRulesTable) reused inside the Alert Center "Rules" tab. Enabled state is
 * a presentational switch for now (mock data — no persistence yet).
 */
import type { AlertRule } from '../data/mockData'
import { GlassCard } from './GlassCard'

function RuleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={`yw-switch${on ? ' is-on' : ''}`}
      role="img"
      aria-label={on ? 'Enabled' : 'Disabled'}
      title={on ? 'Enabled' : 'Disabled'}
    >
      <span className="yw-switch__knob" />
    </span>
  )
}

export function AlertRulesTable({ rules }: { rules: AlertRule[] }) {
  return (
    <div className="yw-table yw-rules-table">
      <div className="yw-trow yw-trow--head">
        <span className="yw-tcell">Provider</span>
        <span className="yw-tcell">Condition</span>
        <span className="yw-tcell">Threshold</span>
        <span className="yw-tcell">Channel</span>
        <span className="yw-tcell yw-tcell--end">Enabled</span>
      </div>
      {rules.map((rule) => (
        <div key={rule.id} className="yw-trow">
          <span className="yw-tcell yw-tcell--strong">{rule.provider}</span>
          <span className="yw-tcell">{rule.condition}</span>
          <span className="yw-tcell">
            <span className="yw-code">{rule.threshold}</span>
          </span>
          <span className="yw-tcell">{rule.channel}</span>
          <span className="yw-tcell yw-tcell--end">
            <RuleSwitch on={rule.enabled} />
          </span>
        </div>
      ))}
    </div>
  )
}

export function AlertRules({ rules }: { rules: AlertRule[] }) {
  return (
    <GlassCard
      title="Alert Rules"
      subtitle="Thresholds and notification channels per provider"
    >
      <AlertRulesTable rules={rules} />
    </GlassCard>
  )
}
