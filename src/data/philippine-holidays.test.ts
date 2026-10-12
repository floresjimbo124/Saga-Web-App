import { describe, expect, it } from 'vitest'
import { getPhilippineHoliday, philippineHolidays2026 } from './philippine-holidays'

describe('Philippine 2026 holidays', () => {
  it('includes regular and special non-working holidays', () => {
    expect(philippineHolidays2026.some((holiday) => holiday.type === 'Regular holiday')).toBe(true)
    expect(philippineHolidays2026.some((holiday) => holiday.type === 'Special non-working day')).toBe(true)
  })

  it('returns holiday details for calendar dates', () => {
    expect(getPhilippineHoliday('2026-04-03')).toEqual({
      date: '2026-04-03',
      name: 'Good Friday',
      type: 'Regular holiday',
    })
    expect(getPhilippineHoliday('2026-10-11')).toBeNull()
  })

  it('keeps each holiday date unique and uses ISO date values', () => {
    const dates = philippineHolidays2026.map((holiday) => holiday.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true)
  })
})
