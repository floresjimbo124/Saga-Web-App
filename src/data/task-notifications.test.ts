import { describe, expect, it } from 'vitest'
import { buildTaskNotifications } from './task-notifications'
import type { ProjectTask } from './tasks'

const task = (overrides: Partial<ProjectTask>): ProjectTask => ({
  id: 'task-1',
  projectId: 'project-1',
  projectName: 'Salo Spot',
  assignedTo: 'staff-1',
  title: 'Prepare permit drawings',
  description: '',
  dueDate: '2026-10-12',
  priority: 'normal',
  status: 'todo',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
})

describe('buildTaskNotifications', () => {
  it('shows reminders one day before and overdue notices starting the day after', () => {
    const notifications = buildTaskNotifications([
      task({ id: 'tomorrow', dueDate: '2026-10-12' }),
      task({ id: 'today', dueDate: '2026-10-11' }),
      task({ id: 'overdue', dueDate: '2026-10-10' }),
      task({ id: 'completed', dueDate: '2026-10-10', status: 'done' }),
    ], '2026-10-11')

    expect(notifications).toEqual([
      {
        id: 'task:overdue:overdue:2026-10-10',
        taskId: 'overdue',
        title: 'Overdue task',
        detail: 'Prepare permit drawings · Salo Spot',
        kind: 'overdue',
        dueDate: '2026-10-10',
      },
      {
        id: 'task:tomorrow:due-soon:2026-10-12',
        taskId: 'tomorrow',
        title: 'Due tomorrow',
        detail: 'Prepare permit drawings · Salo Spot',
        kind: 'due-soon',
        dueDate: '2026-10-12',
      },
    ])
  })

  it('orders overdue tasks before due-soon reminders', () => {
    const notifications = buildTaskNotifications([
      task({ id: 'due-soon', dueDate: '2026-10-12' }),
      task({ id: 'overdue-later', dueDate: '2026-10-10' }),
      task({ id: 'overdue-earlier', dueDate: '2026-10-09' }),
    ], '2026-10-11')

    expect(notifications.map(({ taskId }) => taskId)).toEqual([
      'overdue-earlier',
      'overdue-later',
      'due-soon',
    ])
  })
})
