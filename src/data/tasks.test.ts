import { describe, expect, it } from 'vitest'
import { summarizeStaffTasksForWeek, validateTaskInput, type ProjectTask, type TaskInput } from './tasks'

const validTask: TaskInput = {
  projectId: 'project-1',
  assignedTo: 'staff-1',
  title: 'Prepare permit drawings',
  description: 'Complete the first review set.',
  dueDate: '2026-10-21',
  priority: 'normal',
}

describe('validateTaskInput', () => {
  it('accepts a complete task assignment', () => {
    expect(() => validateTaskInput(validTask)).not.toThrow()
  })

  describe('summarizeStaffTasksForWeek', () => {
    const task = (overrides: Partial<ProjectTask>): ProjectTask => ({
      id: 'task-1',
      projectId: 'project-1',
      projectName: 'Salo Spot',
      assignedTo: 'staff-1',
      title: 'Prepare permit drawings',
      description: '',
      dueDate: '2026-10-14',
      priority: 'normal',
      status: 'todo',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      ...overrides,
    })

    it('counts weekly task statuses and the current overdue backlog per staff member', () => {
      const result = summarizeStaffTasksForWeek([
        task({ id: 'complete', status: 'done' }),
        task({ id: 'pending', status: 'todo' }),
        task({ id: 'in-progress', status: 'in_progress' }),
        task({ id: 'blocked', status: 'blocked', dueDate: '2026-10-16' }),
        task({ id: 'late', dueDate: '2026-10-10' }),
        task({ id: 'late-complete', status: 'done', dueDate: '2026-10-09' }),
        task({ id: 'other-week', dueDate: '2026-10-19' }),
      ], [
        { userId: 'staff-1', name: 'Alex' },
        { userId: 'staff-2', name: 'Lee' },
      ], '2026-10-12', '2026-10-15')

      expect(result).toEqual([
        {
          userId: 'staff-1',
          staffName: 'Alex',
          dueThisWeek: 4,
          complete: 1,
          pending: 1,
          inProgress: 1,
          blocked: 1,
          overdue: 3,
        },
        {
          userId: 'staff-2',
          staffName: 'Lee',
          dueThisWeek: 0,
          complete: 0,
          pending: 0,
          inProgress: 0,
          blocked: 0,
          overdue: 0,
        },
      ])
    })

    it('includes tasks due at the start and end of the selected week', () => {
      const result = summarizeStaffTasksForWeek([
        task({ id: 'start', dueDate: '2026-10-12' }),
        task({ id: 'end', dueDate: '2026-10-18', status: 'done' }),
      ], [{ userId: 'staff-1', name: 'Alex' }], '2026-10-12', '2026-10-15')

      expect(result[0]).toMatchObject({ dueThisWeek: 2, pending: 1, complete: 1 })
    })
  })

  it('requires a project, assignee, and useful title', () => {
    expect(() => validateTaskInput({ ...validTask, projectId: '' })).toThrow('Choose a project')
    expect(() => validateTaskInput({ ...validTask, assignedTo: '' })).toThrow('Assign the task')
    expect(() => validateTaskInput({ ...validTask, title: ' ' })).toThrow('Task title')
  })

  it('rejects invalid calendar dates and oversized descriptions', () => {
    expect(() => validateTaskInput({ ...validTask, dueDate: '2026-02-30' })).toThrow('valid task deadline')
    expect(() => validateTaskInput({ ...validTask, description: 'x'.repeat(4001) })).toThrow('4,000 characters')
  })
})
