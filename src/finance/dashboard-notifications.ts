import type { PortfolioProject } from '../data/portfolio'
import type { ReceivableAgingItem } from './receivables-aging'
import { getProjectDeadlineStatus } from './project-deadline'

export type DashboardNotification = {
  id: string
  projectId: string
  projectName: string
  category: 'deadline' | 'receivable'
  priority: 'urgent' | 'soon'
  title: string
  detail: string
}

export function buildDashboardNotifications(
  projects: readonly Pick<PortfolioProject, 'id' | 'name' | 'status' | 'deadline'>[],
  receivables: readonly Pick<ReceivableAgingItem, 'projectId' | 'projectName' | 'billingNumber' | 'outstandingAmount' | 'daysOverdue' | 'kind'>[],
  asOfDate?: string,
): DashboardNotification[] {
  const notifications: DashboardNotification[] = []
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))

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
  }

  const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
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

  return notifications.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === 'urgent' ? -1 : 1
    if (left.category !== right.category) return left.category === 'deadline' ? -1 : 1
    return left.projectName.localeCompare(right.projectName)
  })
}