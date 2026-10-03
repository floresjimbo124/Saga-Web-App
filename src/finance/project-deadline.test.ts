import { describe, expect, it } from 'vitest'
import { getProjectDeadlineStatus } from './project-deadline'

describe('getProjectDeadlineStatus', () => {
  it('marks past deadlines overdue with the days late', () => {
    expect(getProjectDeadlineStatus('2026-10-02', 'active', '2026-10-03')).toMatchObject({
      level: 'overdue', label: 'Overdue', daysRemaining: -1, detail: '1 day overdue · due 2026-10-02',
    })
  })

  it('marks deadlines on today and through 30 days as due soon', () => {
    expect(getProjectDeadlineStatus('2026-10-03', 'active', '2026-10-03')).toMatchObject({ level: 'due-soon', label: 'Due soon', detail: 'Due today · 2026-10-03' })
    expect(getProjectDeadlineStatus('2026-11-02', 'active', '2026-10-03')).toMatchObject({ level: 'due-soon', daysRemaining: 30 })
  })

  it('marks deadlines more than 30 days away on track', () => {
    expect(getProjectDeadlineStatus('2026-11-03', 'active', '2026-10-03')).toMatchObject({ level: 'on-track', label: 'On track', daysRemaining: 31 })
  })

  it('handles absent deadlines and exempts completed projects from overdue', () => {
    expect(getProjectDeadlineStatus(null, 'active', '2026-10-03').level).toBe('none')
    expect(getProjectDeadlineStatus('2026-09-01', 'completed', '2026-10-03').level).toBe('completed')
    expect(getProjectDeadlineStatus('2026-09-01', 'closed', '2026-10-03').level).toBe('completed')
  })
})