import type { ProjectHealthStatus, ProjectStatus } from '../data/portfolio'
import type { ProfitRiskSummary } from '../finance/profit-risk'
import type { ProjectDeadlineStatus } from '../finance/project-deadline'

const projectStatusOptions: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
]

export function Metric({ icon, label, value, foot, tone }: { icon: React.ReactNode; label: string; value: string; foot: string; tone: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span className="metric-icon">{icon}</span><span>{label}</span></div><strong className="metric-value">{value}</strong><small>{foot}</small></div>
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const label = projectStatusOptions.find((option) => option.value === status)?.label ?? 'Planning'
  return <span className={`status-badge status-${status.replaceAll('_', '-')}`}><span />{label}</span>
}

export function HealthBadge({ status }: { status: ProjectHealthStatus }) {
  const label = status === 'needs_attention' ? 'Needs attention' : 'On track'
  return <span className={`status-badge health-${status.replaceAll('_', '-')}`}><span />{label}</span>
}

export function ProfitRiskBadge({ risk }: { risk: ProfitRiskSummary }) {
  return <span className={`status-badge profit-risk-${risk.level}`} title={risk.detail}><span />{risk.label}</span>
}

export function ProjectDeadlineBadge({ deadline }: { deadline: ProjectDeadlineStatus }) {
  return <span className={`status-badge deadline-${deadline.level}`} title={deadline.detail}><span />{deadline.label}</span>
}
