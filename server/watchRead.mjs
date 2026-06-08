/**
 * Youmi Watch — admin-gated read endpoints (Phase 3).
 *
 * Six read-only endpoints that aggregate the watch_* tables via the service-role
 * client and fall back to mock data when those tables are empty (or a read
 * fails after the admin check already passed). Every handler requires the same
 * server-verified admin/developer check (requireWatchAdmin).
 *
 * SAFETY
 *   • Read-only — no writes.
 *   • No provider API calls, no secrets, no raw API responses.
 *   • No raw transcript/audio/prompt/content or raw metadata in any output:
 *     the `metadata` column is never even SELECTed, and provider credentials are
 *     always rendered masked.
 *   • Fail closed: non-admin requests are rejected before any DB access.
 *
 * Pure aggregation helpers are exported for unit testing.
 */
import { getAdminClient } from './betaGate.mjs'
import { requireWatchAdmin } from './adminWatchAccess.mjs'
import { MOCK } from './watchMockData.mjs'
import {
  EXPECTED_PROVIDERS,
  realExpectedProviders,
  decideSource,
  makeCoverage,
  pct,
} from './watchCoverage.mjs'

const DAY_MS = 86400000
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const PROVIDER_ICON = {
  deepgram: 'mic',
  dashscope: 'sparkles',
  brevo: 'mail',
  railway: 'server',
  supabase: 'database',
  openai: 'sparkles',
}
const PROVIDER_COLOR = {
  deepgram: '#2f6bd4',
  dashscope: '#4fc4e0',
  brevo: '#8b7ff0',
  railway: '#10b981',
  supabase: '#f59e0b',
  openai: '#64748b',
}

// ── small pure utils ────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function r6(n) {
  return Math.round(num(n) * 1e6) / 1e6
}
function usd(n) {
  return `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function capitalize(s) {
  const str = String(s || '')
  return str.charAt(0).toUpperCase() + str.slice(1)
}
function humanizeEvent(eventType) {
  return String(eventType || 'event').replace(/_/g, ' ')
}
function startOfDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function startOfMonth(now) {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
function isoDaysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString()
}
function hhmm(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function relTime(iso, now) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = Math.max(0, now - t)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
function shortId(id) {
  const s = String(id || '').replace(/-/g, '')
  return `req_${s.slice(0, 8) || 'unknown'}`
}

// ── exported pure aggregation helpers ───────────────────────────────────────

/**
 * Aggregate cost-event rows into spend rollups + a 7-day per-provider trend.
 * Pure; `now` injectable for tests. Rows shape: { provider, estimated_cost_usd,
 * occurred_at }.
 */
export function aggregateCostRows(rows, { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const today0 = startOfDay(now)
  const weekStart = today0 - 6 * DAY_MS
  const monthStart = startOfMonth(now)

  let total = 0
  let today = 0
  let week = 0
  let month = 0
  const byProvider = {}

  for (const r of list) {
    const cost = num(r?.estimated_cost_usd)
    const t = Date.parse(r?.occurred_at)
    total += cost
    const p = String(r?.provider || 'unknown')
    byProvider[p] = (byProvider[p] || 0) + cost
    if (Number.isFinite(t)) {
      if (t >= today0) today += cost
      if (t >= weekStart) week += cost
      if (t >= monthStart) month += cost
    }
  }
  for (const k of Object.keys(byProvider)) byProvider[k] = r6(byProvider[k])

  return {
    total: r6(total),
    today: r6(today),
    week: r6(week),
    month: r6(month),
    byProvider,
    trend: buildCostTrend(list, now),
  }
}

function buildCostTrend(rows, now) {
  const today0 = startOfDay(now)
  const days = []
  for (let i = 6; i >= 0; i--) days.push(today0 - i * DAY_MS)
  const labels = days.map((d) => DOW[new Date(d).getDay()])

  const byProvDay = {}
  for (const r of rows) {
    const t = Date.parse(r?.occurred_at)
    if (!Number.isFinite(t)) continue
    const idx = days.findIndex((d) => t >= d && t < d + DAY_MS)
    if (idx < 0) continue
    const p = String(r?.provider || 'unknown')
    if (!byProvDay[p]) byProvDay[p] = [0, 0, 0, 0, 0, 0, 0]
    byProvDay[p][idx] += num(r?.estimated_cost_usd)
  }
  const series = Object.keys(byProvDay).map((p) => ({
    name: capitalize(p),
    color: PROVIDER_COLOR[p] || '#64748b',
    points: byProvDay[p].map(r6),
  }))
  return { labels, series }
}

/** Keep only the most recent snapshot per provider. Pure. */
export function latestSnapshotPerProvider(rows) {
  const list = Array.isArray(rows) ? rows : []
  const byProvider = {}
  for (const r of list) {
    const t = Date.parse(r?.captured_at) || 0
    const cur = byProvider[r?.provider]
    if (!cur || t > cur.__t) byProvider[r.provider] = { row: r, __t: t }
  }
  return Object.values(byProvider).map((x) => x.row)
}

/**
 * Convert a cost-event row into a sanitized log entry. NEVER includes metadata,
 * transcripts, or any raw field — only safe, display-ready values. Pure.
 */
export function costRowToLogEntry(row, { now = Date.now() } = {}) {
  const provider = String(row?.provider || 'unknown')
  return {
    id: row?.id,
    time: hhmm(row?.occurred_at),
    provider: capitalize(provider),
    event: humanizeEvent(row?.event_type),
    status: 'success',
    statusLabel: 'Success',
    severity: 'info',
    severityLabel: 'Info',
    latency: '—',
    cost: usd(row?.estimated_cost_usd),
    requestId: shortId(row?.id),
    _ago: relTime(row?.occurred_at, now),
  }
}

// ── builders (DB → payload, with mock fallback) ─────────────────────────────

function mockPayload(key) {
  return {
    ok: true,
    source: 'mock',
    coverage: makeCoverage({ completenessPct: 0 }),
    ...MOCK[key],
  }
}

/** Map a watch_alerts severity (critical|warning|info) → AlertDatum severity. */
function overviewAlertSeverity(sev) {
  if (sev === 'critical') return 'error'
  if (sev === 'warning') return 'warning'
  return 'info'
}

async function buildOverview() {
  const db = getAdminClient()
  if (!db) return mockPayload('overview')

  const { data: costRows, error } = await db
    .from('watch_cost_events')
    .select('provider,event_type,estimated_cost_usd,occurred_at')
    .gte('occurred_at', isoDaysAgo(35))
    .order('occurred_at', { ascending: false })
    .limit(5000)
  if (error) throw new Error(error.message)
  if (!costRows || costRows.length === 0) return mockPayload('overview')

  // Active alerts (real) for the overview alerts panel — empty (not mock) when
  // none have fired.
  const { data: activeAlerts } = await db
    .from('watch_alerts')
    .select('id,provider,severity,title,trigger_expr,last_seen_at')
    .eq('status', 'active')
    .order('last_seen_at', { ascending: false })
    .limit(8)

  const now = Date.now()
  const agg = aggregateCostRows(costRows, { now })
  const realProviders = realExpectedProviders(costRows.map((r) => r.provider))
  // Overview is only "live" once cost data covers every expected provider.
  const complete = realProviders.length === EXPECTED_PROVIDERS.length
  const source = decideSource({ hasAnyReal: costRows.length > 0, complete })

  const metrics = [
    { id: 'total-estimated', label: 'Total Estimated', icon: 'cost', value: usd(agg.month), description: 'This month' },
    { id: 'today', label: 'Today', icon: 'cost', value: usd(agg.today), description: 'Estimated spend' },
    { id: 'this-week', label: 'This Week', icon: 'cost', value: usd(agg.week), description: 'Rolling 7 days' },
    { id: 'active-alerts', label: 'Active Alerts', icon: 'alert', value: String((activeAlerts || []).length), description: 'Require attention' },
  ]
  const alerts = (activeAlerts || []).slice(0, 5).map((a) => ({
    id: a.id,
    severity: overviewAlertSeverity(a.severity),
    title: a.title,
    detail: a.trigger_expr || `${capitalize(a.provider || 'system')} alert`,
    time: relTime(a.last_seen_at, now),
  }))
  const activity = costRows.slice(0, 6).map((r, i) => ({
    id: `ev-${i}`,
    icon: PROVIDER_ICON[r.provider] || 'logs',
    text: `${capitalize(r.provider)} — ${humanizeEvent(r.event_type)}`,
    time: relTime(r.occurred_at, now),
  }))
  const coverage = makeCoverage({
    providersWithRealData: realProviders,
    sectionsLive: ['costSummary', 'recentEvents'],
    sectionsMock: complete ? [] : ['providerCoverage'],
    completenessPct: pct(realProviders.length, EXPECTED_PROVIDERS.length),
  })
  return { ok: true, source, coverage, metrics, usageTrend: agg.trend, alerts, activity }
}

async function buildProviders() {
  const db = getAdminClient()
  if (!db) return mockPayload('providers')

  const { data: snaps, error } = await db
    .from('watch_provider_snapshots')
    .select('provider,status,latency_ms,health_pct,usage_value,usage_unit,quota_used_pct,estimated_cost_usd,captured_at')
    .gte('captured_at', isoDaysAgo(7))
    .order('captured_at', { ascending: false })
    .limit(2000)
  if (error) throw new Error(error.message)
  if (!snaps || snaps.length === 0) return mockPayload('providers')

  const latest = latestSnapshotPerProvider(snaps)
  const now = Date.now()
  const byProvider = Object.fromEntries(latest.map((s) => [s.provider, s]))
  const realProviders = realExpectedProviders(latest.map((s) => s.provider))

  // List EVERY expected provider; real ones from their snapshot, the rest as an
  // honest "no data yet" row (dataState: 'unknown') so missing coverage is never
  // hidden.
  const providers = EXPECTED_PROVIDERS.map((p) => {
    const s = byProvider[p]
    if (!s) {
      return {
        id: p,
        name: capitalize(p),
        kind: PROVIDER_KIND[p] || 'Provider',
        icon: PROVIDER_ICON[p] || 'server',
        status: 'neutral',
        statusLabel: 'No data',
        usage: '—',
        usageNote: 'no snapshot yet',
        cost: '—',
        health: '—',
        healthNote: '—',
        dataState: 'unknown',
      }
    }
    return {
      id: p,
      name: capitalize(p),
      kind: PROVIDER_KIND[p] || 'Provider',
      icon: PROVIDER_ICON[p] || 'server',
      status: providerRowStatus(s.status),
      statusLabel: capitalize(providerRowStatus(s.status)),
      usage: s.usage_value != null ? `${s.usage_value}${s.usage_unit ? ` ${s.usage_unit}` : ''}` : '—',
      usageNote: 'latest',
      cost: s.estimated_cost_usd != null ? usd(s.estimated_cost_usd) : '—',
      health: s.health_pct != null ? `${s.health_pct}%` : '—',
      healthNote: relTime(s.captured_at, now),
      dataState: 'live',
    }
  })
  const connectionHealth = EXPECTED_PROVIDERS.map((p) => {
    const s = byProvider[p]
    if (!s) {
      return {
        id: p,
        name: capitalize(p),
        icon: PROVIDER_ICON[p] || 'server',
        latency: '—',
        status: 'neutral',
        statusLabel: 'Unknown',
        dataState: 'unknown',
      }
    }
    return {
      id: p,
      name: capitalize(p),
      icon: PROVIDER_ICON[p] || 'server',
      latency: s.latency_ms != null ? `${s.latency_ms}ms latency` : '—',
      status: healthStatus(s.status),
      statusLabel: capitalize(s.status || 'unknown'),
      dataState: 'live',
    }
  })
  const healthy = latest.filter((s) => s.status === 'operational').length
  const warnings = latest.filter((s) => s.status === 'degraded' || s.status === 'warning').length
  const offline = latest.filter((s) => s.status === 'offline').length
  const metrics = [
    { id: 'connected', label: 'Connected', icon: 'link', value: `${realProviders.length}/${EXPECTED_PROVIDERS.length}`, description: 'Providers with real data', status: { kind: 'operational', label: 'Active' } },
    { id: 'healthy', label: 'Healthy', icon: 'check-circle', value: String(healthy), description: 'Operating normally', status: { kind: 'normal', label: 'Normal' } },
    { id: 'warnings', label: 'Warnings', icon: 'alert', value: String(warnings), description: 'Need attention', status: { kind: 'watch', label: 'Watch' } },
    { id: 'offline', label: 'Offline', icon: 'offline', value: String(offline), description: offline ? 'Provider outage' : 'No outages', status: { kind: 'stable', label: 'Stable' } },
  ]
  // Provider snapshots can be complete while the trend chart is still mocked, so
  // source must be based on section coverage rather than provider count alone.
  const complete = realProviders.length === EXPECTED_PROVIDERS.length
  const coverage = makeCoverage({
    providersWithRealData: realProviders,
    sectionsLive: realProviders.length ? ['providerSnapshots'] : [],
    sectionsMock: ['usageTrend', ...(complete ? [] : ['providerSnapshots'])],
    completenessPct: pct(realProviders.length, EXPECTED_PROVIDERS.length),
  })
  const source = decideSource({
    hasAnyReal: realProviders.length > 0,
    complete: coverage.sectionsMock.length === 0,
  })
  return { ok: true, source, coverage, metrics, providers, usageTrend: MOCK.providers.usageTrend, connectionHealth }
}

async function buildAlerts() {
  const db = getAdminClient()
  if (!db) return mockPayload('alerts')

  const { data: alerts, error } = await db
    .from('watch_alerts')
    .select('id,provider,severity,status,title,trigger_expr,last_seen_at')
    .order('last_seen_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)

  const { data: rules } = await db
    .from('watch_alert_rules')
    .select('id,provider,condition,threshold_value,threshold_text,threshold_unit,channel,enabled')
    .order('provider', { ascending: true })

  const hasAlerts = Array.isArray(alerts) && alerts.length > 0
  const hasRules = Array.isArray(rules) && rules.length > 0
  if (!hasAlerts && !hasRules) return mockPayload('alerts')

  const now = Date.now()
  // Real fired alerts only — NEVER fall back to mock activity. An empty list is
  // the honest "no alerts" state (the UI shows its empty state).
  const rows = (alerts || []).map((a) => ({
    id: a.id,
    severity: a.severity,
    title: a.title,
    provider: a.provider ? capitalize(a.provider) : '—',
    trigger: a.trigger_expr || '',
    time: relTime(a.last_seen_at, now),
    status: a.status === 'resolved' ? 'resolved' : 'active',
  }))
  const rules2 = (rules || []).map((r) => ({
    id: r.id,
    provider: capitalize(r.provider),
    condition: capitalize(r.condition),
    threshold: ruleThreshold(r),
    channel: capitalize(r.channel || 'email'),
    enabled: !!r.enabled,
  }))
  const active = (alerts || []).filter((a) => a.status === 'active')
  // Metrics derived from real alerts (zeros when no alerts have fired) — never mock.
  const metrics = [
    { id: 'active-alerts', label: 'Active Alerts', icon: 'alert', value: String(active.length), description: 'Require attention' },
    { id: 'resolved-today', label: 'Resolved Today', icon: 'check-circle', value: String((alerts || []).filter((a) => a.status === 'resolved').length), description: 'Cleared' },
    { id: 'critical', label: 'Critical', icon: 'alert', value: String(active.filter((a) => a.severity === 'critical').length), description: 'High severity' },
    { id: 'total-week', label: 'Total This Week', icon: 'logs', value: String((alerts || []).length), description: 'Across all providers' },
  ]
  const first = rows[0]
  const selectedDetail = first
    ? {
        alertId: first.id,
        provider: first.provider,
        trigger: first.trigger || '—',
        relatedMetric: '—',
        suggestedAction: 'Review the alert and acknowledge once handled.',
      }
    : {
        alertId: '',
        provider: '—',
        trigger: '—',
        relatedMetric: '—',
        suggestedAction: 'No active alerts. Configured rules are listed below.',
      }

  // Rules can be live while alert ACTIVITY is empty → that page is "partial".
  const sectionsLive = []
  const sectionsMock = []
  if (hasRules) sectionsLive.push('alertRules')
  if (hasAlerts) sectionsLive.push('alertActivity')
  else sectionsMock.push('alertActivity')
  const source = decideSource({ hasAnyReal: hasRules || hasAlerts, complete: hasRules && hasAlerts })
  const coverage = makeCoverage({ sectionsLive, sectionsMock })
  return { ok: true, source, coverage, metrics, rows, rules: rules2, selectedDetail }
}

async function buildCosts() {
  const db = getAdminClient()
  if (!db) return mockPayload('costs')

  const { data, error } = await db
    .from('watch_cost_events')
    .select('provider,estimated_cost_usd,occurred_at')
    .gte('occurred_at', isoDaysAgo(40))
    .order('occurred_at', { ascending: false })
    .limit(10000)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return mockPayload('costs')

  const now = Date.now()
  const agg = aggregateCostRows(data, { now })
  const realProviders = realExpectedProviders(data.map((r) => r.provider))
  // One provider's cost event must NOT present the whole report as complete.
  const complete = realProviders.length === EXPECTED_PROVIDERS.length
  const source = decideSource({ hasAnyReal: data.length > 0, complete })

  const { data: config } = await db.from('watch_config').select('key,value')
  const cfg = Object.fromEntries((config || []).map((c) => [c.key, c.value]))
  const budgetUsd = num(cfg.monthly_budget_usd) || 2500
  const spend = agg.month
  const remaining = budgetUsd - spend
  const usagePercent = budgetUsd > 0 ? Math.round((spend / budgetUsd) * 100) : 0

  const distribution = buildDistribution(agg.byProvider)
  const breakdown = buildBreakdown(agg.byProvider)
  const projected = projectMonthEnd(spend, now)
  const metrics = [
    { id: 'total-estimated', label: 'Total Estimated', icon: 'cost', value: usd(spend), description: complete ? 'This month' : `This month (${realProviders.length}/${EXPECTED_PROVIDERS.length} providers)` },
    { id: 'today', label: 'Today', icon: 'cost', value: usd(agg.today), description: 'Current daily spend' },
    { id: 'this-week', label: 'This Week', icon: 'cost', value: usd(agg.week), description: 'Rolling 7 days' },
    { id: 'forecast', label: 'Forecast', icon: 'trend', value: complete ? usd(projected) : '—', description: complete ? 'Projected month-end' : 'Awaiting full coverage' },
  ]
  const coverage = makeCoverage({
    providersWithRealData: realProviders,
    sectionsLive: ['costEvents'],
    sectionsMock: complete ? [] : ['providerCoverage', 'costForecast'],
    completenessPct: pct(realProviders.length, EXPECTED_PROVIDERS.length),
  })
  return {
    ok: true,
    source,
    coverage,
    metrics,
    trend: agg.trend,
    distribution,
    budget: {
      monthlyBudget: usd(budgetUsd),
      currentSpend: usd(spend),
      remaining: usd(remaining),
      usagePercent,
      status: usagePercent >= 75 ? 'watch' : 'normal',
      statusLabel: usagePercent >= 75 ? 'Watch' : 'Normal',
    },
    breakdown,
    forecast: {
      // Forecast is only presented as reliable when coverage is complete.
      reliable: complete,
      projectedCost: complete ? usd(projected) : '—',
      budgetRemainingAfter: complete ? usd(budgetUsd - projected) : '—',
      riskLevel: !complete ? 'Unknown' : projected > budgetUsd ? 'High' : usagePercent >= 75 ? 'Medium' : 'Low',
      riskStatus: !complete ? 'neutral' : projected > budgetUsd ? 'error' : usagePercent >= 75 ? 'watch' : 'normal',
      suggestedAction: complete
        ? 'Review the highest-cost providers and tighten alert thresholds as needed.'
        : `Forecast pending: ${realProviders.length} of ${EXPECTED_PROVIDERS.length} providers reporting cost data.`,
    },
  }
}

async function buildLogs() {
  const db = getAdminClient()
  if (!db) return mockPayload('logs')

  // Note: `metadata` is deliberately NOT selected — sanitized output only.
  const { data, error } = await db
    .from('watch_cost_events')
    .select('id,provider,event_type,estimated_cost_usd,occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return mockPayload('logs')

  const now = Date.now()
  const rows = data.map((r) => costRowToLogEntry(r, { now }))
  // Logs is "live" on its own real internal event feed, independent of other
  // pages — the feed is the page's core content and is fully real. Metrics are
  // derived from those real events (never the mock counters).
  const realProviders = realExpectedProviders(data.map((r) => r.provider))
  const totalCost = data.reduce((s, r) => s + num(r.estimated_cost_usd), 0)
  const distinctProviders = new Set(data.map((r) => String(r.provider))).size
  const metrics = [
    { id: 'total-events', label: 'Total Events', icon: 'logs', value: String(data.length), description: 'Recent internal events' },
    { id: 'providers-active', label: 'Active Providers', icon: 'providers', value: String(distinctProviders), description: 'With recorded events' },
    { id: 'est-cost', label: 'Estimated Cost', icon: 'cost', value: usd(totalCost), description: 'Across shown events' },
    { id: 'latest', label: 'Latest Event', icon: 'clock', value: rows[0]?.time ?? '—', description: 'Most recent' },
  ]
  const top = data[0]
  const selectedDetail = top
    ? {
        provider: capitalize(top.provider),
        event: humanizeEvent(top.event_type),
        status: 'Recorded',
        statusLabel: 'Recorded',
        requestId: rows[0].requestId,
        relatedMetric: '—',
        relatedUser: 'system',
        recordingId: '—',
        retryCount: 0,
        message: 'Internal cost/usage event recorded by Youmi Watch.',
        suggestedAction: 'No action required.',
      }
    : MOCK.logs.selectedDetail
  const coverage = makeCoverage({
    providersWithRealData: realProviders,
    sectionsLive: ['events'],
    sectionsMock: [],
    completenessPct: 100,
  })
  return {
    ok: true,
    source: 'live',
    coverage,
    metrics,
    filters: MOCK.logs.filters,
    rows,
    selectedDetail,
    systemHealth: MOCK.logs.systemHealth,
  }
}

async function buildSettings() {
  const db = getAdminClient()
  if (!db) return mockPayload('settings')

  const { data: rules } = await db
    .from('watch_alert_rules')
    .select('id,provider,name,condition,threshold_value,threshold_text,threshold_unit,enabled')
    .order('provider', { ascending: true })
  const { data: config } = await db.from('watch_config').select('key,value')
  const { data: snaps } = await db
    .from('watch_provider_snapshots')
    .select('provider,status,captured_at')
    .gte('captured_at', isoDaysAgo(7))
    .order('captured_at', { ascending: false })
    .limit(500)

  const hasRules = Array.isArray(rules) && rules.length > 0
  const hasConfig = Array.isArray(config) && config.length > 0
  if (!hasRules && !hasConfig) return mockPayload('settings')

  const alertThresholds = (rules || []).map((r) => ({
    id: r.id,
    label: r.name,
    threshold: ruleThreshold(r),
    enabled: !!r.enabled,
  }))

  const cfg = Object.fromEntries((config || []).map((c) => [c.key, c.value]))
  const liveNotifications = notificationsFromConfig(cfg.notification_channels)
  const notifications = liveNotifications || MOCK.settings.notifications

  // Connection STATUS may come from snapshots; credentials are ALWAYS masked.
  // Providers without a snapshot are marked dataState 'unknown' (mock), not Live.
  const latest = latestSnapshotPerProvider(snaps || [])
  const statusByProvider = Object.fromEntries(latest.map((s) => [s.provider, s.status]))
  const providerConnections = MOCK.settings.providerConnections.map((c) => {
    const snapStatus = statusByProvider[c.id]
    if (!snapStatus) return { ...c, status: 'neutral', statusLabel: 'Unknown', dataState: 'unknown' }
    return {
      ...c,
      status: snapStatus === 'operational' ? 'success' : snapStatus === 'offline' ? 'error' : 'warning',
      statusLabel: snapStatus === 'operational' ? 'Connected' : capitalize(snapStatus),
      dataState: 'live',
      // keyMasked / region / mode stay masked — never real keys.
    }
  })
  const snapProviders = realExpectedProviders(latest.map((s) => s.provider))
  const connectionsComplete = snapProviders.length === EXPECTED_PROVIDERS.length

  const enabledRules = (rules || []).filter((r) => r.enabled).length
  const enabledChannels = notifications.filter((n) => n.enabled === true).length
  const metrics = [
    { id: 'connected-providers', label: 'Connected Providers', icon: 'providers', value: `${snapProviders.length}/${EXPECTED_PROVIDERS.length}`, description: 'With live status' },
    { id: 'alert-rules', label: 'Alert Rules', icon: 'alert', value: String(hasRules ? enabledRules : MOCK.settings.alertThresholds.length), description: 'Enabled thresholds' },
    { id: 'notif-channels', label: 'Notification Channels', icon: 'bell', value: String(enabledChannels), description: 'Email and desktop' },
    { id: 'security-mode', label: 'Security Mode', icon: 'shield', value: 'Server', description: 'AdminGate verified' },
  ]

  // Only config/rules/snapshot-derived sections are live. Static UI preferences
  // and masked security settings still come from mock data, so this page remains
  // partial until those sections have real backing data too.
  const sectionsLive = []
  const sectionsMock = ['security', 'appearance']
  if (hasRules) sectionsLive.push('alertThresholds')
  else sectionsMock.push('alertThresholds')
  if (liveNotifications) sectionsLive.push('notifications')
  else sectionsMock.push('notifications')
  if (connectionsComplete) sectionsLive.push('providerConnections')
  else sectionsMock.push('providerConnections')
  const source = decideSource({
    hasAnyReal: hasRules || hasConfig,
    complete: sectionsMock.length === 0,
  })
  const coverage = makeCoverage({ providersWithRealData: snapProviders, sectionsLive, sectionsMock })
  return {
    ok: true,
    source,
    coverage,
    metrics,
    providerConnections,
    alertThresholds: alertThresholds.length ? alertThresholds : MOCK.settings.alertThresholds,
    notifications,
    security: MOCK.settings.security,
    securityNote: MOCK.settings.securityNote,
    appearance: MOCK.settings.appearance,
  }
}

// ── small mapping helpers ───────────────────────────────────────────────────

const PROVIDER_KIND = {
  deepgram: 'Speech-to-Text API',
  dashscope: 'LLM / Summaries',
  brevo: 'Email API',
  railway: 'API Hosting',
  supabase: 'Database & Storage',
  openai: 'Fallback LLM',
}

function providerRowStatus(snapStatus) {
  if (snapStatus === 'operational') return 'normal'
  if (snapStatus === 'degraded') return 'degraded'
  if (snapStatus === 'offline') return 'offline'
  if (snapStatus === 'warning') return 'warning'
  return 'normal'
}
function healthStatus(snapStatus) {
  if (snapStatus === 'operational') return 'operational'
  if (snapStatus === 'degraded' || snapStatus === 'warning') return 'degraded'
  if (snapStatus === 'offline') return 'offline'
  return 'neutral'
}
function ruleThreshold(r) {
  if (r.threshold_text) return capitalize(r.threshold_text)
  if (r.threshold_value == null) return ''
  const unit = r.threshold_unit
  if (unit === 'percent') return `${r.threshold_value}%`
  if (unit === 'usd') return `$${r.threshold_value}`
  return `${r.threshold_value}`
}
function buildDistribution(byProvider) {
  const total = Object.values(byProvider).reduce((s, v) => s + num(v), 0)
  const entries = Object.entries(byProvider).sort((a, b) => b[1] - a[1])
  return entries.map(([provider, cost]) => ({
    id: provider,
    label: capitalize(provider),
    percent: total > 0 ? Math.round((num(cost) / total) * 100) : 0,
    color: PROVIDER_COLOR[provider] || '#64748b',
  }))
}
function buildBreakdown(byProvider) {
  const entries = Object.entries(byProvider).sort((a, b) => b[1] - a[1])
  return entries.map(([provider, cost]) => ({
    id: provider,
    provider: capitalize(provider),
    usage: '—',
    unit: '—',
    estimatedCost: usd(cost),
    change: '—',
    changeDir: 'up',
    status: 'normal',
    statusLabel: 'Normal',
  }))
}
function projectMonthEnd(spendSoFar, now) {
  const d = new Date(now)
  const dayOfMonth = d.getDate()
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  if (dayOfMonth <= 0) return r6(spendSoFar)
  return r6((spendSoFar / dayOfMonth) * daysInMonth)
}
function notificationsFromConfig(value) {
  if (!value || typeof value !== 'object') return null
  const out = []
  const known = [
    ['email', 'Email alerts', 'Developer email'],
    ['desktop', 'Desktop notifications', 'Local device'],
    ['slack', 'Slack', 'Coming later'],
    ['discord', 'Discord', 'Coming later'],
  ]
  for (const [key, channel, detail] of known) {
    const entry = value[key]
    if (!entry) continue
    const connectable = key === 'email' || key === 'desktop'
    out.push({ id: key, channel, detail, enabled: connectable ? !!entry.enabled : null })
  }
  return out.length ? out : null
}

// ── HTTP handlers ───────────────────────────────────────────────────────────

async function respond(res, key, build) {
  try {
    const payload = await build()
    res.status(200).json(payload)
  } catch (e) {
    // Read failed AFTER the admin check passed → serve safe mock fallback.
    console.warn(`[watchRead] ${key} read failed: ${e?.message || 'unknown'}; serving mock`)
    res.status(200).json(mockPayload(key))
  }
}

export async function handleWatchOverview(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  await respond(res, 'overview', buildOverview)
}
export async function handleWatchProviders(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  await respond(res, 'providers', buildProviders)
}
export async function handleWatchAlerts(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  await respond(res, 'alerts', buildAlerts)
}
export async function handleWatchCosts(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  await respond(res, 'costs', buildCosts)
}
export async function handleWatchLogs(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  await respond(res, 'logs', buildLogs)
}
export async function handleWatchSettings(req, res) {
  const user = await requireWatchAdmin(req, res)
  if (!user) return
  await respond(res, 'settings', buildSettings)
}
