import { describe, expect, it } from 'vitest'
import { validateTaskInput, type TaskInput } from './tasks'

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
