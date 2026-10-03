import { describe, expect, it } from 'vitest'
import { buildDashboardNotifications } from './dashboard-notifications'

describe('buildDashboardNotifications', () => {
  it('surfaces overdue and due-soon project deadlines but ignores completed projects', () => {
    const notifications = buildDashboardNotifications([
      { id: 'late', name: 'Late project', status: 'active', deadline: '2026-10-02' },
      { id: 'soon', name: 'Soon project', status: 'planning', deadline: '2026-10-20' },
      { id: 'done', name: 'Finished project', status: 'completed', deadline: '2026-10-02' },
      { id: 'none', name: 'No deadline', status: 'active', deadline: null },
    ], [], '2026-10-03')

    expect(notifications).toMatchObject([
      { id: 'deadline:late', priority: 'urgent', title: 'Overdue project deadline' },
      { id: 'deadline:soon', priority: 'soon', title: 'Due soon project deadline' },
    ])
  })

  it('groups overdue billing balances by project and ignores settled or not-due bills', () => {
    const notifications = buildDashboardNotifications([{ id: 'project-1', name: 'Harbor Office', status: 'active', deadline: null }], [
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 1, outstandingAmount: 120_000, daysOverdue: 9 },
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 2, outstandingAmount: 80_000, daysOverdue: 3 },
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 3, outstandingAmount: 0, daysOverdue: 50 },
      { projectId: 'project-1', projectName: 'Harbor Office', billingNumber: 4, outstandingAmount: 90_000, daysOverdue: 0 },
    ], '2026-10-03')

    expect(notifications).toMatchObject([{
      id: 'receivable:project-1',
      title: '2 overdue billings',
      detail: '₱200,000 outstanding · oldest 9 days overdue',
    }])
  })

  it('notifies separately when retained funds become overdue', () => {
    const notifications = buildDashboardNotifications([
      { id: 'project-1', name: 'Harbor Office', status: 'completed', deadline: null },
    ], [{
      projectId: 'project-1',
      projectName: 'Harbor Office',
      billingNumber: 0,
      outstandingAmount: 50_000,
      daysOverdue: 4,
      kind: 'retention',
    }], '2026-10-03')

    expect(notifications).toMatchObject([{
      id: 'retention:project-1',
      title: 'Retention release overdue',
      detail: '₱50,000 outstanding · 4 days overdue',
    }])
  })
})