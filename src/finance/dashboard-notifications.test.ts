import { describe, expect, it } from 'vitest'
import { buildDashboardNotifications } from './dashboard-notifications'

describe('buildDashboardNotifications', () => {
  it('surfaces overdue and due-soon project deadlines but ignores completed projects', () => {
    const notifications = buildDashboardNotifications([
      { ...project, id: 'late', name: 'Late project', status: 'active', deadline: '2026-10-02' },
      { ...project, id: 'soon', name: 'Soon project', status: 'planning', deadline: '2026-10-20' },
      { ...project, id: 'done', name: 'Finished project', status: 'completed', deadline: '2026-10-02' },
      { ...project, id: 'none', name: 'No deadline', status: 'active', deadline: null },
    ], [], '2026-10-03')

    expect(notifications).toMatchObject([
      { id: 'deadline:late', priority: 'urgent', title: 'Overdue project deadline' },
      { id: 'deadline:soon', priority: 'soon', title: 'Due soon project deadline' },
    ])
  })

  it('groups overdue billing balances by project and ignores settled or not-due bills', () => {
    const notifications = buildDashboardNotifications([{ ...project, id: 'project-1', name: 'Harbor Office' }], [
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 1, outstandingAmount: 120_000, daysOverdue: 9, daysUntilDue: -9 },
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 2, outstandingAmount: 80_000, daysOverdue: 3, daysUntilDue: -3 },
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 3, outstandingAmount: 0, daysOverdue: 50, daysUntilDue: -50 },
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 4, outstandingAmount: 90_000, daysOverdue: 0, daysUntilDue: 2 },
    ], '2026-10-03')

    expect(notifications).toMatchObject([{
      id: 'receivable:project-1',
      title: '2 overdue billings',
      detail: '₱200,000 outstanding · oldest 9 days overdue',
    }])
  })

  it('notifies separately when retained funds become overdue', () => {
    const notifications = buildDashboardNotifications([
      { ...project, id: 'project-1', name: 'Harbor Office', status: 'completed' },
    ], [{
      projectId: 'project-1',
      projectName: 'Harbor Office',
      billingNumber: 0,
      outstandingAmount: 50_000,
      daysOverdue: 4,
      daysUntilDue: -4,
      kind: 'retention',
    }], '2026-10-03')

    expect(notifications).toMatchObject([{
      id: 'retention:project-1',
      title: 'Retention release overdue',
      detail: '₱50,000 outstanding · 4 days overdue',
    }])
  })

  it('alerts on high profit risk and actual project budget overruns', () => {
    const notifications = buildDashboardNotifications([{
      ...project,
      id: 'project-1',
      name: 'Harbor Office',
      contract: 1_000_000,
      costBudget: 500_000,
      estimatedCostToComplete: 450_000,
      outflow: 550_000,
    }], [], '2026-10-03')

    expect(notifications.map(({ id }) => id)).toEqual(['profit-risk:project-1', 'budget-overrun:project-1'])
    expect(notifications.every(({ category, priority }) => category === 'financial' && priority === 'urgent')).toBe(true)
  })

  it('alerts when unpaid retention is due within 30 days, but not after it is paid', () => {
    const notifications = buildDashboardNotifications([
      { ...project, id: 'due', status: 'completed', completedAt: '2026-09-20', retention: 50_000 },
      { ...project, id: 'paid', status: 'completed', completedAt: '2026-09-20', retention: 50_000, retentionPaid: 50_000 },
      { ...project, id: 'later', status: 'completed', completedAt: '2026-08-01', retention: 50_000 },
    ], [], '2026-10-03')

    expect(notifications).toMatchObject([{
      id: 'retention-due-soon:due',
      priority: 'soon',
      title: 'Retention release due soon',
      detail: '₱50,000 due in 17 days · 2026-10-20',
    }])
    expect(notifications).toHaveLength(1)
  })
})

const project = {
  id: 'base',
  name: 'Base project',
  status: 'active' as const,
  deadline: null,
  contract: 0,
  specialDiscount: 0,
  approvedChangeOrders: [] as { amount: number; approved: boolean }[],
  outflow: 0,
  costBudget: null,
  estimatedCostToComplete: null,
  completedAt: null,
  retention: 0,
  retentionPaid: 0,
}