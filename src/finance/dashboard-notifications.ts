import type { PortfolioProject } from '../data/portfolio'
import type { ReceivableAgingItem } from './receivables-aging'
import { getProjectDeadlineStatus } from './project-deadline'
import { getRetentionDueDate } from './retention-due'
import { calculateProfitRisk } from './profit-risk'

export type DashboardNotification = {
  id: string
  projectId: string
  projectName: string
  category: 'deadline' | 'receivable' | 'financial'
  priority: 'urgent' | 'soon'
  title: string
  detail: string
}

const millisecondsPerDay = 86_400_000
const retentionDueSoonDays = 30

function dateDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / millisecondsPerDay)
}

export function buildDashboardNotifications(
  projects: readonly Pick<PortfolioProject,
    'id' | 'name' | 'status' | 'deadline' | 'contract' | 'specialDiscount' | 'approvedChangeOrders'
    | 'outflow' | 'costBudget' | 'estimatedCostToComplete' | 'completedAt' | 'retention' | 'retentionPaid'
  >[],
  receivables: readonly Pick<ReceivableAgingItem, 'projectId' | 'projectName' | 'billingNumber' | 'outstandingAmount' | 'daysOverdue' | 'daysUntilDue' | 'kind'>[],
  asOfDate?: string,
): DashboardNotification[] {
  const notifications: DashboardNotification[] = []
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const today = asOfDate ?? (() => {
    const date = new Date()
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })()
  const todayDay = dateDay(today)
  const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })

  for (const project of projects) {
    const deadline = getProjectDeadlineStatus(project.deadline, project.status, asOfDate)
    if (deadline.level === 'overdue' || deadline.level === 'due-soon') {
      notifications.push({
        id: `deadline:${project.id}`,
        projectId: project.id,
        projectName: project.name,
        category: 'deadline',
        priority: deadline.level === 'overdue' ? 'urgent' : 'soon',
        title: `${deadline.label} project deadline`,
        detail: deadline.detail,
      })
    }

    const contractValue = Math.max(0, project.contract - project.specialDiscount)
      + project.approvedChangeOrders
        .filter((changeOrder) => changeOrder.approved)
        .reduce((total, changeOrder) => total + changeOrder.amount, 0)
    const profitRisk = calculateProfitRisk({
      contractValue,
      recordedCosts: project.outflow,
      costBudget: project.costBudget,
      estimatedCostToComplete: project.estimatedCostToComplete,
    })
    if (profitRisk.level === 'high' || profitRisk.level === 'critical') {
      notifications.push({
        id: `profit-risk:${project.id}`,
        projectId: project.id,
        projectName: project.name,
        category: 'financial',
        priority: 'urgent',
        title: profitRisk.level === 'critical' ? 'Critical project profitability risk' : 'High project profitability risk',
        detail: profitRisk.detail,
      })
    }

    if (project.costBudget !== null && project.outflow > project.costBudget) {
      const overrun = project.outflow - project.costBudget
      notifications.push({
        id: `budget-overrun:${project.id}`,
        projectId: project.id,
        projectName: project.name,
        category: 'financial',
        priority: 'urgent',
        title: 'Project budget exceeded',
        detail: `${money.format(overrun)} over the ${money.format(project.costBudget)} cost budget`,
      })
    }

    if (project.status === 'completed' || project.status === 'closed') {
      const dueDate = getRetentionDueDate(project.completedAt)
      const daysUntilDue = dueDate ? dateDay(dueDate) - todayDay : Number.NaN
      const outstandingRetention = Math.max(0, project.retention - project.retentionPaid)
      if (Number.isFinite(daysUntilDue) && daysUntilDue >= 0 && daysUntilDue <= retentionDueSoonDays && outstandingRetention > 0) {
        notifications.push({
          id: `retention-due-soon:${project.id}`,
          projectId: project.id,
          projectName: project.name,
          category: 'financial',
          priority: 'soon',
          title: 'Retention release due soon',
          detail: `${money.format(outstandingRetention)} due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} · ${dueDate}`,
        })
      }
    }
  }

  const overdueByProject = new Map<string, { projectName: string; billingCount: number; amount: number; oldestDays: number }>()
  for (const receivable of receivables) {
    if (receivable.daysOverdue <= 0 || receivable.outstandingAmount <= 0) continue
    if (receivable.kind === 'retention') {
      notifications.push({
        id: `retention:${receivable.projectId}`,
        projectId: receivable.projectId,
        projectName: projectNames.get(receivable.projectId) ?? receivable.projectName,
        category: 'receivable',
        priority: 'urgent',
        title: 'Retention release overdue',
        detail: `${money.format(receivable.outstandingAmount)} outstanding · ${receivable.daysOverdue} days overdue`,
      })
      continue
    }
    const group = overdueByProject.get(receivable.projectId) ?? {
      projectName: projectNames.get(receivable.projectId) ?? receivable.projectName,
      billingCount: 0,
      amount: 0,
      oldestDays: 0,
    }
    group.billingCount += 1
    group.amount += receivable.outstandingAmount
    group.oldestDays = Math.max(group.oldestDays, receivable.daysOverdue)
    overdueByProject.set(receivable.projectId, group)
  }

  for (const [projectId, group] of overdueByProject) {
    notifications.push({
      id: `receivable:${projectId}`,
      projectId,
      projectName: group.projectName,
      category: 'receivable',
      priority: 'urgent',
      title: `${group.billingCount} overdue billing${group.billingCount === 1 ? '' : 's'}`,
      detail: `${money.format(group.amount)} outstanding · oldest ${group.oldestDays} days overdue`,
    })
  }

  for (const receivable of receivables) {
    if (receivable.kind !== 'retention' || receivable.outstandingAmount <= 0
      || receivable.daysUntilDue === null || receivable.daysUntilDue < 0
      || receivable.daysUntilDue > retentionDueSoonDays) continue
    if (notifications.some((notification) => notification.id === `retention-due-soon:${receivable.projectId}`)) continue
    notifications.push({
      id: `retention-due-soon:${receivable.projectId}`,
      projectId: receivable.projectId,
      projectName: projectNames.get(receivable.projectId) ?? receivable.projectName,
      category: 'financial',
      priority: 'soon',
      title: 'Retention release due soon',
      detail: `${money.format(receivable.outstandingAmount)} due in ${receivable.daysUntilDue} day${receivable.daysUntilDue === 1 ? '' : 's'}`,
    })
  }

  return notifications.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === 'urgent' ? -1 : 1
    if (left.category !== right.category) {
      const categoryOrder = { financial: 0, receivable: 1, deadline: 2 }
      return categoryOrder[left.category] - categoryOrder[right.category]
    }
    return left.projectName.localeCompare(right.projectName)
  })
}