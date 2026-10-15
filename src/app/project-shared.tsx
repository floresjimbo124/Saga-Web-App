// Helpers shared by the owner app screens.
import { calculateProjectFinance } from '../finance/project-finance'
import { isRetentionDue } from '../finance/retention-due'
import { type PortfolioPayment, type PortfolioProject, type ProjectHealthStatus, type ProjectStatus } from '../data/portfolio'
import { type StatusMenuOption } from '../components/StatusMenu'

export type Project = PortfolioProject
export type Payment = PortfolioPayment
export type ProjectDetailTab = 'Overview' | 'Milestones' | 'Change orders' | 'Billings' | 'Payments' | 'Expenses' | 'Forecast' | 'Documents'
export const projectDetailTabs: ProjectDetailTab[] = ['Overview', 'Milestones', 'Change orders', 'Billings', 'Payments', 'Expenses', 'Forecast', 'Documents']

export const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
export const projectStatusMenuOptions: StatusMenuOption<ProjectStatus>[] = [
  { value: 'planning', label: 'Planning', description: 'Not started on site yet', tone: 'blue' },
  { value: 'active', label: 'Active', description: 'Work is under way', tone: 'green' },
  { value: 'on_hold', label: 'On hold', description: 'Paused for now', tone: 'amber' },
  { value: 'completed', label: 'Completed', description: 'Work finished, closing out', tone: 'green' },
  { value: 'closed', label: 'Closed', description: 'Fully settled and archived', tone: 'grey' },
]
export const projectHealthMenuOptions: StatusMenuOption<ProjectHealthStatus>[] = [
  { value: 'on_track', label: 'On track', description: 'No issues right now', tone: 'green' },
  { value: 'needs_attention', label: 'Needs attention', description: 'Something needs follow-up', tone: 'red' },
]
export const setupMoney = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
export const shortDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
export const projectDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
export const financeForProject = (project: Project) => calculateProjectFinance({
  contractAmount: project.contract,
  specialDiscount: project.specialDiscount,
  approvedChangeOrders: project.approvedChangeOrders,
  progressPercent: project.progress,
  retentionRatePercent: project.retentionRate,
  retentionMethod: project.retentionMethod,
  billedToDate: project.billed,
  paymentsReceived: Math.max(0, project.collected - project.retentionPaid),
  retentionHeld: project.retention,
})
export const todayLocal = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const retentionDueForProject = (project: Project) =>
  (project.status === 'completed' || project.status === 'closed')
    && isRetentionDue(project.completedAt, todayLocal())
    ? project.retention
    : 0
