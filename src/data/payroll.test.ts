import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

import {
  getWeekDates,
  getWeekStart,
  finalizePayrollWeek,
  loadPayrollProjectOptions,
  recordPayrollAdvance,
  updatePayrollAdvance,
  savePayrollWeekEntry,
  validatePayrollWeekEntry,
} from './payroll'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: 'saved-id', error: null })
})

describe('payroll date helpers', () => {
  it('returns the Monday and dates for the selected week', () => {
    expect(getWeekStart(new Date(2026, 9, 7))).toBe('2026-10-05')
    expect(getWeekDates('2026-10-05')).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
      '2026-10-09', '2026-10-10', '2026-10-11',
    ])
  })
})

describe('payroll data validation and writes', () => {
  it('loads only the project fields needed by payroll', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ project_id: 'project-1', project_name: 'North site', project_status: 'active' }],
      error: null,
    })

    await expect(loadPayrollProjectOptions()).resolves.toEqual([
      { id: 'project-1', name: 'North site', status: 'active' },
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('list_payroll_projects')
  })

  it('rejects malformed payroll project responses', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ project_id: 'project-1' }], error: null })

    await expect(loadPayrollProjectOptions()).rejects.toThrow('The payroll project list returned an invalid response.')
  })

  it('rejects an impossible cash advance date before calling the database', async () => {
    await expect(recordPayrollAdvance({
      employeeId: 'employee-1',
      amount: 1_000,
      date: '2026-02-30',
      note: '',
    })).rejects.toThrow('Enter a valid advance date.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('trims advance notes and sends the selected date', async () => {
    await recordPayrollAdvance({
      employeeId: 'employee-1',
      amount: 1_000,
      date: '2026-10-07',
      note: '  Emergency  ',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('record_payroll_cash_advance', {
      p_employee_id: 'employee-1',
      p_amount: 1_000,
      p_advance_date: '2026-10-07',
      p_note: 'Emergency',
    })
  })

  it('updates a cash advance with a trimmed note and selected date', async () => {
    await updatePayrollAdvance({
      id: 'advance-1',
      amount: 1_250,
      date: '2026-10-08',
      note: '  Tools  ',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('update_payroll_cash_advance', {
      p_advance_id: 'advance-1',
      p_amount: 1_250,
      p_advance_date: '2026-10-08',
      p_note: 'Tools',
    })
  })

  it('rejects an invalid cash advance update before calling the database', async () => {
    await expect(updatePayrollAdvance({
      id: 'advance-1',
      amount: 1_250,
      date: '2026-02-30',
      note: '',
    })).rejects.toThrow('Enter a valid advance date.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects impossible and non-Monday payroll week dates', async () => {
    const attendance = getWeekDates('2026-10-05').map((date) => ({ date, present: 1 as const }))
    for (const weekStart of ['2026-02-30', '2026-10-06']) {
      await expect(savePayrollWeekEntry({
        employeeId: 'employee-1',
        weekStart,
        projectId: null,
        attendance,
        advanceDeduction: 0,
        dailyRate: 1_000,
      })).rejects.toThrow('Payroll week must start on a Monday.')
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('requires one attendance value for every day', async () => {
    await expect(savePayrollWeekEntry({
      employeeId: 'employee-1',
      weekStart: '2026-10-05',
      projectId: null,
      attendance: getWeekDates('2026-10-05').slice(0, 6).map((date) => ({ date, present: 1 as const })),
      advanceDeduction: 0,
      dailyRate: 1_000,
    })).rejects.toThrow('Record attendance for all seven days')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects duplicated or missing attendance dates', () => {
    const dates = getWeekDates('2026-10-05')
    expect(() => validatePayrollWeekEntry({
      weekStart: '2026-10-05',
      attendance: [
        ...dates.slice(0, 6).map((date) => ({ date, present: 0 as const })),
        { date: dates[5], present: 1 },
      ],
      advanceDeduction: 0,
      dailyRate: 1_000,
    })).toThrow('Attendance must have exactly one 1 or 0 value for each day')
  })

  it('rejects deductions greater than gross pay', async () => {
    await expect(savePayrollWeekEntry({
      employeeId: 'employee-1',
      weekStart: '2026-10-05',
      projectId: null,
      attendance: getWeekDates('2026-10-05').map((date) => ({ date, present: 1 as const })),
      advanceDeduction: 7_001,
      dailyRate: 1_000,
    })).rejects.toThrow('Cash advance deduction cannot exceed gross pay.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('includes manually entered overtime in gross pay and deduction validation', () => {
    const attendance = getWeekDates('2026-10-05').map((date, index) => ({
      date,
      present: index === 0 ? 1 as const : 0 as const,
    }))
    expect(() => validatePayrollWeekEntry({
      weekStart: '2026-10-05',
      attendance,
      advanceDeduction: 1_100,
      dailyRate: 1_000,
      overtimeAmount: 200,
    })).not.toThrow()
    expect(() => validatePayrollWeekEntry({
      weekStart: '2026-10-05',
      attendance,
      advanceDeduction: 1_201,
      dailyRate: 1_000,
      overtimeAmount: 200,
    })).toThrow('Cash advance deduction cannot exceed gross pay.')
  })

  it('rejects a negative overtime amount', async () => {
    await expect(savePayrollWeekEntry({
      employeeId: 'employee-1',
      weekStart: '2026-10-05',
      projectId: null,
      attendance: getWeekDates('2026-10-05').map((date) => ({ date, present: 0 as const })),
      advanceDeduction: 0,
      dailyRate: 1_000,
      overtimeAmount: -1,
    })).rejects.toThrow('Overtime amount cannot be negative.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('saves attendance and the optional project assignment through the payroll RPC', async () => {
    const attendance = getWeekDates('2026-10-05').map((date, index) => ({
      date,
      present: index < 5 ? 1 as const : 0 as const,
    }))
    await savePayrollWeekEntry({
      employeeId: 'employee-1',
      weekStart: '2026-10-05',
      projectId: 'project-1',
      attendance,
      advanceDeduction: 500,
      dailyRate: 1_000,
      overtimeAmount: 750,
    })

    expect(mocks.rpc).toHaveBeenCalledWith('save_payroll_week_entry', {
      p_employee_id: 'employee-1',
      p_week_start: '2026-10-05',
      p_project_id: 'project-1',
      p_attendance: attendance.map(({ date, present }) => ({ work_date: date, present })),
      p_advance_deduction: 500,
      p_overtime_amount: 750,
    })
  })

  it('manually finalizes the selected payroll week through the owner RPC', async () => {
    await finalizePayrollWeek('2026-10-05')

    expect(mocks.rpc).toHaveBeenCalledWith('finalize_payroll_week', {
      p_week_start: '2026-10-05',
    })
  })

  it('rejects a non-Monday manual finalization date', async () => {
    await expect(finalizePayrollWeek('2026-10-06')).rejects.toThrow('Payroll week must start on a Monday.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
