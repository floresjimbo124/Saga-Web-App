import { describe, expect, it } from 'vitest'
import { getRetentionDueDate, isRetentionDue } from './retention-due'

describe('retention due date', () => {
  it('becomes due one calendar month after completion', () => {
    expect(getRetentionDueDate('2026-10-03')).toBe('2026-11-03')
    expect(isRetentionDue('2026-10-03', '2026-11-02')).toBe(false)
    expect(isRetentionDue('2026-10-03', '2026-11-03')).toBe(true)
  })

  it('clamps month-end completion dates to the final day of the next month', () => {
    expect(getRetentionDueDate('2026-01-31')).toBe('2026-02-28')
    expect(getRetentionDueDate('2024-01-31')).toBe('2024-02-29')
  })

  it('does not create a due date without a valid completion date', () => {
    expect(getRetentionDueDate(null)).toBeNull()
    expect(getRetentionDueDate('not-a-date')).toBeNull()
    expect(isRetentionDue(null, '2026-11-03')).toBe(false)
  })
})
