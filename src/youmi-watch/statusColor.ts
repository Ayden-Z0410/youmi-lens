/**
 * Map a status kind to its semantic CSS colour token. Kept separate from the
 * StatusBadge component so it can be imported without tripping React fast-refresh
 * (component files should export components only).
 */
import type { StatusKind } from './data/mockData'

export function statusColor(status: StatusKind): string {
  switch (status) {
    case 'healthy':
    case 'normal':
    case 'operational':
    case 'resolved':
      return 'var(--yw-success)'
    case 'warning':
    case 'watch':
    case 'degraded':
      return 'var(--yw-warning)'
    case 'offline':
    case 'error':
    case 'critical':
      return 'var(--yw-danger)'
    case 'info':
    case 'active':
      return 'var(--yw-accent)'
    default:
      return 'var(--yw-neutral)'
  }
}
