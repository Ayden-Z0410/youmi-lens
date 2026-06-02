/**
 * ProviderConnections — provider connection list for the Settings page.
 *
 * SECURITY: UI-only. Credential fields render fixed masked placeholders
 * ("••••••••") explicitly labelled as mock — there are NO real key inputs, no
 * key storage, and nothing here is sourced from a real secret. "Manage" is a
 * presentational button only.
 */
import type { ProviderConnectionRow } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'
import { WatchIcon, type IconName } from './WatchIcons'

function Cred({ label, value }: { label: string; value: string }) {
  return (
    <span className="yw-cred">
      {label} <strong>{value}</strong>
    </span>
  )
}

export function ProviderConnections({ rows }: { rows: ProviderConnectionRow[] }) {
  return (
    <GlassCard
      className="yw-spaced"
      title="Provider Connections"
      subtitle="Masked mock credentials — no real keys are stored or editable"
    >
      <div className="yw-conn-list">
        {rows.map((row) => (
          <div key={row.id} className="yw-conn">
            <div className="yw-conn__id">
              <span className="yw-provider__logo">
                <WatchIcon name={row.icon as IconName} size={18} />
              </span>
              <div>
                <div className="yw-provider__name">{row.name}</div>
                <div className="yw-provider__kind">{row.kind}</div>
              </div>
            </div>

            <div className="yw-conn__creds">
              <Cred label="Key" value={row.keyMasked} />
              <Cred label="Region" value={row.region} />
              <Cred label="Mode" value={row.mode} />
            </div>

            <div className="yw-conn__status">
              <StatusBadge status={row.status} label={row.statusLabel} />
              <span className="yw-conn__checked">{row.lastChecked}</span>
            </div>

            <button type="button" className="yw-btn yw-btn--secondary yw-btn--sm">
              Manage
            </button>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
