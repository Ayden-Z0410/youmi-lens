/**
 * Mock data for the Youmi Watch developer dashboard.
 *
 * No real API integrations yet — every value here is static placeholder data so
 * the UI can be designed and reviewed in isolation. When the backend lands, swap
 * these exports for fetch hooks behind the same types.
 */

export type StatusKind =
  | 'healthy'
  | 'normal'
  | 'operational'
  | 'warning'
  | 'watch'
  | 'degraded'
  | 'offline'
  | 'error'
  | 'stable'
  | 'neutral'
  // Alerts page: severity + alert lifecycle states.
  | 'critical'
  | 'info'
  | 'active'
  | 'resolved'
  // Logs page: event outcomes.
  | 'success'
  | 'deployed'

export type TrendDirection = 'up' | 'down' | 'flat'

export interface MetricDatum {
  id: string
  label: string
  /** Lucide-ish icon key resolved in WatchIcons. */
  icon: string
  value: string
  description?: string
  /** Optional small status line (dot + text) shown at the card foot. */
  status?: { kind: StatusKind; label: string }
  /** Optional trend chip. */
  trend?: { direction: TrendDirection; value: string; note?: string }
}

/** Whether a row's values are real ('live'), mock placeholder ('mock'), or not yet known ('unknown'). */
export type RowDataState = 'live' | 'mock' | 'unknown'

export interface ProviderDatum {
  id: string
  name: string
  kind: string
  icon: string
  status: StatusKind
  statusLabel: string
  usage: string
  usageNote?: string
  cost: string
  health: string
  healthNote?: string
  dataState?: RowDataState
}

export interface ConnectionHealthDatum {
  id: string
  name: string
  icon: string
  latency: string
  status: StatusKind
  statusLabel: string
  dataState?: RowDataState
}

export interface AlertDatum {
  id: string
  severity: 'warning' | 'error' | 'info' | 'success'
  title: string
  detail: string
  time: string
}

export interface ActivityDatum {
  id: string
  icon: string
  text: string
  time: string
}

export interface ChartSeries {
  name: string
  color: string
  points: number[]
}

export interface TrendChartData {
  labels: string[]
  series: ChartSeries[]
  /** Highest y value used to scale the axis; falls back to max(points). */
  yMax?: number
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── Series colours (kept in sync with the chart legend swatches) ────────────
const C_ACCENT = '#2f6bd4'
const C_CYAN = '#4fc4e0'
const C_VIOLET = '#8b7ff0'
const C_GREEN = '#10b981'
const C_AMBER = '#f59e0b'

// ───────────────────────────────────────────────────────────────────────────
// Overview page
// ───────────────────────────────────────────────────────────────────────────

export const overviewMetrics: MetricDatum[] = [
  {
    id: 'active-users',
    label: 'Active Users',
    icon: 'users',
    value: '1,284',
    description: 'Daily active across Mac & iPad',
    trend: { direction: 'up', value: '12.4%', note: 'vs last week' },
  },
  {
    id: 'recordings',
    label: 'Recordings Today',
    icon: 'mic',
    value: '342',
    description: 'Captured & processed',
    trend: { direction: 'up', value: '8.1%', note: 'vs yesterday' },
  },
  {
    id: 'ai-minutes',
    label: 'AI Minutes',
    icon: 'sparkles',
    value: '8,640',
    description: 'Transcription + summaries',
    trend: { direction: 'up', value: '5.3%', note: 'vs last week' },
  },
  {
    id: 'error-rate',
    label: 'Error Rate',
    icon: 'alert',
    value: '0.4%',
    description: 'Failed jobs / total',
    trend: { direction: 'down', value: '0.2pp', note: 'improving' },
  },
]

export const overviewUsageTrend: TrendChartData = {
  labels: DAY_LABELS,
  yMax: 10000,
  series: [
    { name: 'Recordings', color: C_ACCENT, points: [3200, 4100, 3800, 5200, 6100, 4800, 5600] },
    { name: 'AI Minutes', color: C_CYAN, points: [2400, 3000, 4200, 3600, 5400, 6200, 7100] },
    { name: 'Live Sessions', color: C_VIOLET, points: [1200, 1500, 1300, 2100, 1800, 2400, 2200] },
  ],
}

export const overviewAlerts: AlertDatum[] = [
  {
    id: 'a1',
    severity: 'warning',
    title: 'Supabase storage approaching limit',
    detail: 'Project storage at 82% of the current plan quota.',
    time: '14 min ago',
  },
  {
    id: 'a2',
    severity: 'success',
    title: 'Deepgram latency recovered',
    detail: 'Speech API p95 latency back under 150ms.',
    time: '1 hr ago',
  },
  {
    id: 'a3',
    severity: 'warning',
    title: 'Signup codes running low',
    detail: '38 unused beta invite codes remaining.',
    time: '3 hr ago',
  },
  {
    id: 'a4',
    severity: 'info',
    title: 'Nightly backup completed',
    detail: 'All recordings & transcripts snapshotted successfully.',
    time: '6 hr ago',
  },
]

export const overviewActivity: ActivityDatum[] = [
  { id: 'r1', icon: 'user-plus', text: '12 new users signed up via beta codes', time: '2m' },
  { id: 'r2', icon: 'mic', text: 'Lecture “Organic Chemistry 201” processed', time: '8m' },
  { id: 'r3', icon: 'refresh', text: 'DashScope provider reconnected automatically', time: '21m' },
  { id: 'r4', icon: 'rocket', text: 'Server v0.1.8 deployed to Railway', time: '47m' },
  { id: 'r5', icon: 'sparkles', text: 'Bilingual summary backfill job finished', time: '1h' },
]

// ───────────────────────────────────────────────────────────────────────────
// Providers page
// ───────────────────────────────────────────────────────────────────────────

export const providerMetrics: MetricDatum[] = [
  {
    id: 'connected',
    label: 'Connected',
    icon: 'link',
    value: '5',
    description: 'Deepgram, DashScope, +3',
    status: { kind: 'operational', label: 'Active' },
  },
  {
    id: 'healthy',
    label: 'Healthy',
    icon: 'check-circle',
    value: '4',
    description: 'Services operating normally',
    status: { kind: 'normal', label: 'Normal' },
  },
  {
    id: 'warnings',
    label: 'Warnings',
    icon: 'alert',
    value: '1',
    description: 'Supabase storage limit',
    status: { kind: 'watch', label: 'Watch' },
  },
  {
    id: 'offline',
    label: 'Offline',
    icon: 'offline',
    value: '0',
    description: 'No provider outages',
    status: { kind: 'stable', label: 'Stable' },
  },
]

export const providers: ProviderDatum[] = [
  {
    id: 'deepgram',
    name: 'Deepgram',
    kind: 'Speech-to-Text API',
    icon: 'mic',
    status: 'normal',
    statusLabel: 'Normal',
    usage: '428.2 min',
    usageNote: 'this month',
    cost: '$42.18',
    health: '99.9%',
    healthNote: '2 min ago',
  },
  {
    id: 'dashscope',
    name: 'DashScope',
    kind: 'LLM / Summaries',
    icon: 'sparkles',
    status: 'normal',
    statusLabel: 'Normal',
    usage: '1.2M tok',
    usageNote: 'this month',
    cost: '$28.40',
    health: '99.7%',
    healthNote: '1 min ago',
  },
  {
    id: 'railway',
    name: 'Railway',
    kind: 'API Hosting',
    icon: 'server',
    status: 'normal',
    statusLabel: 'Normal',
    usage: '99.98%',
    usageNote: 'uptime',
    cost: '$20.00',
    health: '100%',
    healthNote: '30 sec ago',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    kind: 'Database & Storage',
    icon: 'database',
    status: 'degraded',
    statusLabel: 'Degraded',
    usage: '82% disk',
    usageNote: 'storage used',
    cost: '$25.00',
    health: '97.2%',
    healthNote: '4 min ago',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'Fallback LLM',
    icon: 'sparkles',
    status: 'normal',
    statusLabel: 'Normal',
    usage: '210K tok',
    usageNote: 'this month',
    cost: '$11.62',
    health: '99.9%',
    healthNote: '3 min ago',
  },
]

export const providerUsageTrend: TrendChartData = {
  labels: DAY_LABELS,
  yMax: 10000,
  series: [
    { name: 'Deepgram', color: C_ACCENT, points: [4200, 5100, 4800, 6300, 7100, 6400, 8200] },
    { name: 'DashScope', color: C_CYAN, points: [3100, 3600, 4900, 4200, 5800, 5200, 6100] },
    { name: 'Supabase', color: C_VIOLET, points: [1800, 2100, 1900, 2600, 2300, 2900, 2700] },
  ],
}

export const connectionHealth: ConnectionHealthDatum[] = [
  { id: 'deepgram', name: 'Deepgram', icon: 'mic', latency: '12ms latency', status: 'operational', statusLabel: 'Operational' },
  { id: 'dashscope', name: 'DashScope', icon: 'sparkles', latency: '45ms latency', status: 'operational', statusLabel: 'Operational' },
  { id: 'railway', name: 'Railway', icon: 'server', latency: '22ms latency', status: 'operational', statusLabel: 'Operational' },
  { id: 'supabase', name: 'Supabase', icon: 'database', latency: '162ms latency', status: 'degraded', statusLabel: 'Degraded' },
  { id: 'openai', name: 'OpenAI', icon: 'sparkles', latency: '88ms latency', status: 'operational', statusLabel: 'Operational' },
]

// ───────────────────────────────────────────────────────────────────────────
// Alerts page
// ───────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info'
export type AlertStatus = 'active' | 'resolved'

export interface AlertRow {
  id: string
  severity: AlertSeverity
  /** Human-readable alert summary. */
  title: string
  provider: string
  /** Machine condition that fired the alert (rendered as a code chip). */
  trigger: string
  time: string
  status: AlertStatus
}

export interface AlertRule {
  id: string
  provider: string
  condition: string
  threshold: string
  channel: string
  enabled: boolean
}

export interface AlertDetail {
  /** Id of the alert this detail describes (links back to AlertRow). */
  alertId: string
  provider: string
  trigger: string
  relatedMetric: string
  /** Optional 0–100 value for the inline meter; omit to hide the bar. */
  relatedPercent?: number
  suggestedAction: string
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}
const STATUS_LABEL: Record<AlertStatus, string> = {
  active: 'Active',
  resolved: 'Resolved',
}

export const severityLabel = (s: AlertSeverity): string => SEVERITY_LABEL[s]
export const alertStatusLabel = (s: AlertStatus): string => STATUS_LABEL[s]

export const alertMetrics: MetricDatum[] = [
  {
    id: 'active-alerts',
    label: 'Active Alerts',
    icon: 'alert',
    value: '2',
    description: 'Require attention',
  },
  {
    id: 'resolved-today',
    label: 'Resolved Today',
    icon: 'check-circle',
    value: '5',
    description: 'Cleared automatically',
  },
  {
    id: 'critical',
    label: 'Critical',
    icon: 'alert',
    value: '1',
    description: 'High severity',
  },
  {
    id: 'total-week',
    label: 'Total This Week',
    icon: 'logs',
    value: '8',
    description: 'Across all providers',
  },
]

export const alertRows: AlertRow[] = [
  {
    id: 'al-supabase-storage',
    severity: 'critical',
    title: 'Supabase storage above 75%',
    provider: 'Supabase',
    trigger: 'storage_used > 75%',
    time: '9m ago',
    status: 'active',
  },
  {
    id: 'al-dashscope-cost',
    severity: 'warning',
    title: 'DashScope daily cost exceeds threshold',
    provider: 'DashScope',
    trigger: 'daily_cost > $3',
    time: '24m ago',
    status: 'active',
  },
  {
    id: 'al-brevo-credits',
    severity: 'warning',
    title: 'Brevo credits below threshold',
    provider: 'Brevo',
    trigger: 'credits < 500',
    time: '1h ago',
    status: 'active',
  },
  {
    id: 'al-railway-deploy',
    severity: 'info',
    title: 'Railway deployment healthy',
    provider: 'Railway',
    trigger: 'deploy_status = success',
    time: '2h ago',
    status: 'resolved',
  },
]

export const alertRules: AlertRule[] = [
  { id: 'rule-deepgram', provider: 'Deepgram', condition: 'Monthly minutes', threshold: '80%', channel: 'Email', enabled: true },
  { id: 'rule-dashscope', provider: 'DashScope', condition: 'Daily cost', threshold: '$3', channel: 'Email', enabled: true },
  { id: 'rule-supabase', provider: 'Supabase', condition: 'Storage used', threshold: '75%', channel: 'Email', enabled: true },
  { id: 'rule-brevo', provider: 'Brevo', condition: 'Credits remaining', threshold: '500', channel: 'Email', enabled: true },
  { id: 'rule-railway', provider: 'Railway', condition: 'Service health', threshold: 'Offline', channel: 'Email', enabled: true },
]

export const selectedAlertDetail: AlertDetail = {
  alertId: 'al-supabase-storage',
  provider: 'Supabase',
  trigger: 'Storage used above 75%',
  relatedMetric: '78% storage used',
  relatedPercent: 78,
  suggestedAction:
    'Review storage bucket usage and remove unused lecture audio files.',
}

// ───────────────────────────────────────────────────────────────────────────
// Costs page
// ───────────────────────────────────────────────────────────────────────────

export interface CostBreakdownRow {
  id: string
  provider: string
  usage: string
  unit: string
  estimatedCost: string
  change: string
  changeDir: 'up' | 'down'
  status: StatusKind
  statusLabel: string
}

export interface CostDistributionSlice {
  id: string
  label: string
  percent: number
  color: string
}

export interface BudgetSummary {
  monthlyBudget: string
  currentSpend: string
  remaining: string
  usagePercent: number
  status: StatusKind
  statusLabel: string
}

export interface CostForecast {
  projectedCost: string
  budgetRemainingAfter: string
  riskLevel: string
  riskStatus: StatusKind
  suggestedAction: string
  /** False when cost coverage is incomplete — the forecast is not reliable. */
  reliable?: boolean
}

export const costMetrics: MetricDatum[] = [
  {
    id: 'total-estimated',
    label: 'Total Estimated',
    icon: 'cost',
    value: '$1,842.35',
    description: 'This month',
  },
  {
    id: 'today',
    label: 'Today',
    icon: 'cost',
    value: '$62.40',
    description: 'Current daily spend',
  },
  {
    id: 'this-week',
    label: 'This Week',
    icon: 'cost',
    value: '$418.20',
    description: 'Rolling 7 days',
  },
  {
    id: 'forecast',
    label: 'Forecast',
    icon: 'trend',
    value: '$2,310',
    description: 'Projected month-end',
  },
]

/** Daily estimated spend per provider (USD) over the last 7 days. */
export const costTrend: TrendChartData = {
  labels: DAY_LABELS,
  yMax: 24,
  series: [
    { name: 'Deepgram', color: C_ACCENT, points: [5.2, 6.1, 5.6, 7.0, 8.1, 6.4, 7.2] },
    { name: 'DashScope', color: C_CYAN, points: [12.0, 14.2, 16.0, 15.1, 19.8, 18.0, 22.0] },
    { name: 'Brevo', color: C_VIOLET, points: [1.6, 2.0, 1.8, 2.1, 1.7, 2.0, 1.9] },
    { name: 'Railway', color: C_GREEN, points: [4.6, 5.0, 4.8, 5.1, 5.2, 5.0, 5.4] },
    { name: 'Supabase', color: C_AMBER, points: [3.1, 3.6, 4.0, 3.9, 4.3, 4.1, 4.6] },
  ],
}

export const budgetSummary: BudgetSummary = {
  monthlyBudget: '$2,500',
  currentSpend: '$1,842.35',
  remaining: '$657.65',
  usagePercent: 74,
  status: 'watch',
  statusLabel: 'Watch',
}

export const costDistribution: CostDistributionSlice[] = [
  { id: 'deepgram', label: 'Deepgram', percent: 34, color: C_ACCENT },
  { id: 'dashscope', label: 'DashScope', percent: 29, color: C_CYAN },
  { id: 'brevo', label: 'Brevo', percent: 18, color: C_VIOLET },
  { id: 'railway', label: 'Railway', percent: 11, color: C_GREEN },
  { id: 'supabase', label: 'Supabase', percent: 8, color: C_AMBER },
]

export const costBreakdown: CostBreakdownRow[] = [
  { id: 'deepgram', provider: 'Deepgram', usage: '428.2', unit: 'min', estimatedCost: '$42.18', change: '+8%', changeDir: 'up', status: 'normal', statusLabel: 'Normal' },
  { id: 'dashscope', provider: 'DashScope', usage: '2.1M', unit: 'tokens', estimatedCost: '$118.40', change: '+22%', changeDir: 'up', status: 'watch', statusLabel: 'Watch' },
  { id: 'brevo', provider: 'Brevo', usage: '1,248', unit: 'emails', estimatedCost: '$12.00', change: '-3%', changeDir: 'down', status: 'normal', statusLabel: 'Normal' },
  { id: 'railway', provider: 'Railway', usage: '312', unit: 'hours', estimatedCost: '$34.20', change: '+4%', changeDir: 'up', status: 'healthy', statusLabel: 'Healthy' },
  { id: 'supabase', provider: 'Supabase', usage: '78', unit: 'storage %', estimatedCost: '$28.60', change: '+12%', changeDir: 'up', status: 'warning', statusLabel: 'Warning' },
]

export const costForecast: CostForecast = {
  projectedCost: '$2,310',
  budgetRemainingAfter: '$190',
  riskLevel: 'Medium',
  riskStatus: 'watch',
  suggestedAction:
    'Watch DashScope daily token usage and Supabase storage growth.',
}

// ───────────────────────────────────────────────────────────────────────────
// Logs page
// ───────────────────────────────────────────────────────────────────────────

export interface LogRow {
  id: string
  time: string
  provider: string
  event: string
  status: StatusKind
  statusLabel: string
  severity: StatusKind
  severityLabel: string
  latency: string
  cost: string
  requestId: string
}

export interface LogDetail {
  provider: string
  event: string
  status: StatusKind
  statusLabel: string
  requestId: string
  relatedMetric: string
  relatedUser: string
  recordingId: string
  retryCount: number
  message: string
  suggestedAction: string
}

export interface SystemHealthItem {
  id: string
  label: string
  state: string
  status: StatusKind
}

/** Filter control options (presentational mock — no filtering wired yet). */
export interface LogFilterOption {
  id: string
  label: string
  value: string
}

export const logMetrics: MetricDatum[] = [
  { id: 'total-events', label: 'Total Events', icon: 'logs', value: '1,284', description: 'Last 30 days' },
  { id: 'success-rate', label: 'Success Rate', icon: 'check-circle', value: '99.4%', description: 'Across all providers' },
  { id: 'failed-requests', label: 'Failed Requests', icon: 'alert', value: '18', description: 'Needs review' },
  { id: 'avg-latency', label: 'Avg Latency', icon: 'clock', value: '242ms', description: 'API response time' },
]

export const logFilters: LogFilterOption[] = [
  { id: 'provider', label: 'Provider', value: 'All providers' },
  { id: 'status', label: 'Status', value: 'All statuses' },
  { id: 'severity', label: 'Severity', value: 'All severities' },
  { id: 'range', label: 'Date range', value: 'Last 30 days' },
]

export const logRows: LogRow[] = [
  { id: 'l1', time: '09:42', provider: 'Deepgram', event: 'Live transcription session completed', status: 'success', statusLabel: 'Success', severity: 'info', severityLabel: 'Info', latency: '218ms', cost: '$0.14', requestId: 'req_dg_8472' },
  { id: 'l2', time: '09:17', provider: 'Brevo', event: 'Verification email sent', status: 'success', statusLabel: 'Success', severity: 'info', severityLabel: 'Info', latency: '182ms', cost: '$0.01', requestId: 'req_br_1298' },
  { id: 'l3', time: '08:55', provider: 'DashScope', event: 'Summary request completed', status: 'success', statusLabel: 'Success', severity: 'info', severityLabel: 'Info', latency: '640ms', cost: '$0.32', requestId: 'req_ds_3371' },
  { id: 'l4', time: '08:31', provider: 'Railway', event: 'Deployment main-v2.1 live', status: 'deployed', statusLabel: 'Deployed', severity: 'info', severityLabel: 'Info', latency: '—', cost: '$0.00', requestId: 'dep_rw_4412' },
  { id: 'l5', time: '08:10', provider: 'Supabase', event: 'Storage usage checked', status: 'warning', statusLabel: 'Warning', severity: 'warning', severityLabel: 'Warning', latency: '162ms', cost: '$0.03', requestId: 'req_sb_7740' },
  { id: 'l6', time: '07:48', provider: 'DashScope', event: 'Token usage spike detected', status: 'warning', statusLabel: 'Warning', severity: 'warning', severityLabel: 'Warning', latency: '712ms', cost: '$0.88', requestId: 'req_ds_8841' },
  { id: 'l7', time: '07:25', provider: 'Deepgram', event: 'Live session retry completed', status: 'success', statusLabel: 'Success', severity: 'info', severityLabel: 'Info', latency: '241ms', cost: '$0.11', requestId: 'req_dg_5521' },
  { id: 'l8', time: '06:58', provider: 'Brevo', event: 'Transactional email delivery delayed', status: 'error', statusLabel: 'Failed', severity: 'warning', severityLabel: 'Warning', latency: '920ms', cost: '$0.01', requestId: 'req_br_9021' },
]

export const selectedLogDetail: LogDetail = {
  provider: 'Supabase',
  event: 'Storage usage checked',
  status: 'warning',
  statusLabel: 'Warning',
  requestId: 'req_sb_7740',
  relatedMetric: 'storage_used = 78%',
  relatedUser: 'system',
  recordingId: '—',
  retryCount: 0,
  message: 'Storage usage is approaching the configured warning threshold.',
  suggestedAction: 'Review lecture-audio storage and remove unused files.',
}

export const systemHealth: SystemHealthItem[] = [
  { id: 'api-logging', label: 'API logging', state: 'Active', status: 'operational' },
  { id: 'cost-estimation', label: 'Cost estimation', state: 'Active', status: 'operational' },
  { id: 'alert-engine', label: 'Alert engine', state: 'Mock mode', status: 'neutral' },
  { id: 'provider-sync', label: 'Provider sync', state: 'Mock mode', status: 'neutral' },
]

// ───────────────────────────────────────────────────────────────────────────
// Settings page
//
// SECURITY: UI-only. No real secrets, API keys, or provider credentials live
// here. Credential fields are fixed masked placeholders ("••••••••") explicitly
// labelled as mock — never sourced from, or written to, any real key store.
// ───────────────────────────────────────────────────────────────────────────

/** Fixed masked placeholder. Never a real secret — display only. */
export const MASKED_KEY = '••••••••'

export interface ProviderConnectionRow {
  id: string
  name: string
  kind: string
  icon: string
  status: StatusKind
  statusLabel: string
  lastChecked: string
  /** Masked mock credential summary — display only, no real values. */
  keyMasked: string
  region: string
  mode: string
  dataState?: RowDataState
}

export interface ThresholdRow {
  id: string
  label: string
  threshold: string
  enabled: boolean
}

export interface NotificationRow {
  id: string
  channel: string
  detail: string
  /** true/false = toggle state; null = not connectable yet (shows a badge). */
  enabled: boolean | null
}

export interface SecurityItem {
  id: string
  label: string
  value: string
}

export interface AppearanceOption {
  id: string
  label: string
  enabled: boolean
}

export const settingsMetrics: MetricDatum[] = [
  { id: 'connected-providers', label: 'Connected Providers', icon: 'providers', value: '5', description: 'Mock connections' },
  { id: 'alert-rules', label: 'Alert Rules', icon: 'alert', value: '5', description: 'Enabled thresholds' },
  { id: 'notif-channels', label: 'Notification Channels', icon: 'bell', value: '2', description: 'Email and desktop' },
  { id: 'security-mode', label: 'Security Mode', icon: 'shield', value: 'Mock', description: 'AdminGate placeholder' },
]

export const providerConnections: ProviderConnectionRow[] = [
  { id: 'deepgram', name: 'Deepgram', kind: 'Speech API', icon: 'mic', status: 'success', statusLabel: 'Connected', lastChecked: 'Last checked 2 min ago', keyMasked: MASKED_KEY, region: 'Mock', mode: 'Read-only mock' },
  { id: 'dashscope', name: 'DashScope', kind: 'LLM API', icon: 'sparkles', status: 'success', statusLabel: 'Connected', lastChecked: 'Last checked 5 min ago', keyMasked: MASKED_KEY, region: 'Mock', mode: 'Read-only mock' },
  { id: 'brevo', name: 'Brevo', kind: 'Email API', icon: 'mail', status: 'success', statusLabel: 'Connected', lastChecked: 'Last checked 8 min ago', keyMasked: MASKED_KEY, region: 'Mock', mode: 'Read-only mock' },
  { id: 'railway', name: 'Railway', kind: 'Hosting', icon: 'server', status: 'success', statusLabel: 'Connected', lastChecked: 'Last checked 1 min ago', keyMasked: MASKED_KEY, region: 'Mock', mode: 'Read-only mock' },
  { id: 'supabase', name: 'Supabase', kind: 'Database & Storage', icon: 'database', status: 'warning', statusLabel: 'Warning', lastChecked: 'Last checked 3 min ago', keyMasked: MASKED_KEY, region: 'Mock', mode: 'Read-only mock' },
]

export const alertThresholds: ThresholdRow[] = [
  { id: 'deepgram-minutes', label: 'Deepgram monthly minutes warning', threshold: '80%', enabled: true },
  { id: 'dashscope-cost', label: 'DashScope daily cost limit', threshold: '$3', enabled: true },
  { id: 'supabase-storage', label: 'Supabase storage warning', threshold: '75%', enabled: true },
  { id: 'brevo-credits', label: 'Brevo credit minimum', threshold: '500', enabled: true },
  { id: 'railway-health', label: 'Railway service health', threshold: 'Offline', enabled: true },
]

export const notificationSettings: NotificationRow[] = [
  { id: 'email', channel: 'Email alerts', detail: 'Developer email', enabled: true },
  { id: 'desktop', channel: 'Desktop notifications', detail: 'Local device', enabled: true },
  { id: 'slack', channel: 'Slack', detail: 'Coming later', enabled: null },
  { id: 'discord', channel: 'Discord', detail: 'Coming later', enabled: null },
]

export const securitySettings: SecurityItem[] = [
  { id: 'admin-only', label: 'Admin-only dashboard', value: 'Enabled' },
  { id: 'server-check', label: 'Server-verified admin check', value: 'Active' },
  { id: 'api-keys', label: 'API keys', value: 'Server-side only required' },
  { id: 'audit-log', label: 'Audit log', value: 'Mock mode' },
  { id: 'public-entry', label: 'Public entry point', value: 'Disabled' },
  { id: 'data-mode', label: 'Data mode', value: 'Mock data only' },
]

export const securityNote =
  'AdminGate is now server-verified. Before real provider data is connected, provider API keys must remain server-side and Watch data should only come from trusted backend endpoints.'

export const appearanceSettings: AppearanceOption[] = [
  { id: 'liquid-glass', label: 'Liquid Glass theme', enabled: true },
  { id: 'dark-sidebar', label: 'Dark glass sidebar', enabled: true },
  { id: 'compact-cards', label: 'Compact cards', enabled: false },
  { id: 'reduce-motion', label: 'Reduce motion', enabled: false },
]
