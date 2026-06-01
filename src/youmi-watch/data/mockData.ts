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
}

export interface ConnectionHealthDatum {
  id: string
  name: string
  icon: string
  latency: string
  status: StatusKind
  statusLabel: string
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
