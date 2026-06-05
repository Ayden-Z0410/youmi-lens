/**
 * Youmi Watch — frontend API types (Phase 4).
 *
 * Payload shapes for the internal /api/admin/watch/* read endpoints. They reuse
 * the existing page data types so the live response and the local mock fallback
 * are structurally identical (the UI renders either with no shape changes).
 */
import type {
  MetricDatum,
  TrendChartData,
  AlertDatum,
  ActivityDatum,
  ProviderDatum,
  ConnectionHealthDatum,
  AlertRow,
  AlertRule,
  AlertDetail,
  CostDistributionSlice,
  BudgetSummary,
  CostBreakdownRow,
  CostForecast,
  LogRow,
  LogDetail,
  SystemHealthItem,
  LogFilterOption,
  ProviderConnectionRow,
  ThresholdRow,
  NotificationRow,
  SecurityItem,
  AppearanceOption,
} from '../data/mockData'

/** Source as reported by the server. The client adds a third 'local-fallback'. */
export type WatchSource = 'live' | 'mock'

export type WatchEndpoint =
  | 'overview'
  | 'providers'
  | 'alerts'
  | 'costs'
  | 'logs'
  | 'settings'

export interface OverviewPayload {
  metrics: MetricDatum[]
  usageTrend: TrendChartData
  alerts: AlertDatum[]
  activity: ActivityDatum[]
}

export interface ProvidersPayload {
  metrics: MetricDatum[]
  providers: ProviderDatum[]
  usageTrend: TrendChartData
  connectionHealth: ConnectionHealthDatum[]
}

export interface AlertsPayload {
  metrics: MetricDatum[]
  rows: AlertRow[]
  rules: AlertRule[]
  selectedDetail: AlertDetail
}

export interface CostsPayload {
  metrics: MetricDatum[]
  trend: TrendChartData
  distribution: CostDistributionSlice[]
  budget: BudgetSummary
  breakdown: CostBreakdownRow[]
  forecast: CostForecast
}

export interface LogsPayload {
  metrics: MetricDatum[]
  filters: LogFilterOption[]
  rows: LogRow[]
  selectedDetail: LogDetail
  systemHealth: SystemHealthItem[]
}

export interface SettingsPayload {
  metrics: MetricDatum[]
  providerConnections: ProviderConnectionRow[]
  alertThresholds: ThresholdRow[]
  notifications: NotificationRow[]
  security: SecurityItem[]
  securityNote: string
  appearance: AppearanceOption[]
}

/** Discriminated result returned by the API client. */
export type WatchApiResult<T> =
  | { status: 'ok'; source: WatchSource; data: T }
  | { status: 'unauthorized'; reason: 'not_signed_in' | 'forbidden' }
  | { status: 'error'; error: string }
