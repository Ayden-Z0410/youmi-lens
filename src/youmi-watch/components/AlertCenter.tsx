/**
 * AlertCenter — the main frosted-glass card on the Alerts page. Holds a local
 * tab switch (Active / Resolved / Rules) and renders the matching content: a
 * polished glass alert table for Active/Resolved, and the shared rules table for
 * Rules. Tabs are interactive locally; everything else is mock data.
 */
import { useState } from 'react'
import type { AlertRow, AlertRule } from '../data/mockData'
import { severityLabel, alertStatusLabel } from '../data/mockData'
import { GlassCard } from './GlassCard'
import { StatusBadge } from './StatusBadge'
import { AlertRulesTable } from './AlertRules'

type TabKey = 'active' | 'resolved' | 'rules'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rules', label: 'Rules' },
]

function AlertActions({ row }: { row: AlertRow }) {
  return (
    <span className="yw-row-actions">
      {row.status === 'active' && (
        <button type="button" className="yw-btn yw-btn--secondary yw-btn--sm">
          Acknowledge
        </button>
      )}
      <button type="button" className="yw-btn yw-btn--ghost">
        View Logs
      </button>
    </span>
  )
}

function AlertTable({ rows }: { rows: AlertRow[] }) {
  if (rows.length === 0) {
    return <p className="yw-empty">No alerts in this view.</p>
  }
  return (
    <div className="yw-table yw-alerts-table">
      <div className="yw-trow yw-trow--head">
        <span className="yw-tcell">Severity</span>
        <span className="yw-tcell">Alert</span>
        <span className="yw-tcell">Provider</span>
        <span className="yw-tcell">Trigger</span>
        <span className="yw-tcell">Time</span>
        <span className="yw-tcell">Status</span>
        <span className="yw-tcell yw-tcell--end">Actions</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="yw-trow">
          <span className="yw-tcell">
            <StatusBadge status={row.severity} label={severityLabel(row.severity)} />
          </span>
          <span className="yw-tcell yw-tcell--strong">{row.title}</span>
          <span className="yw-tcell">{row.provider}</span>
          <span className="yw-tcell">
            <span className="yw-code">{row.trigger}</span>
          </span>
          <span className="yw-tcell yw-tcell--muted">{row.time}</span>
          <span className="yw-tcell">
            <StatusBadge status={row.status} label={alertStatusLabel(row.status)} />
          </span>
          <span className="yw-tcell yw-tcell--end">
            <AlertActions row={row} />
          </span>
        </div>
      ))}
    </div>
  )
}

export interface AlertCenterProps {
  rows: AlertRow[]
  rules: AlertRule[]
}

export function AlertCenter({ rows, rules }: AlertCenterProps) {
  const [tab, setTab] = useState<TabKey>('active')

  const activeRows = rows.filter((r) => r.status === 'active')
  const resolvedRows = rows.filter((r) => r.status === 'resolved')

  return (
    <GlassCard
      className="yw-spaced"
      title="Alert Center"
      subtitle="Provider warnings, cost spikes, and infrastructure incidents"
      action={
        <div className="yw-tabs" role="tablist" aria-label="Alert views">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`yw-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'active' && <AlertTable rows={activeRows} />}
      {tab === 'resolved' && <AlertTable rows={resolvedRows} />}
      {tab === 'rules' && <AlertRulesTable rules={rules} />}
    </GlassCard>
  )
}
