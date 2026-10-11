import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

export type PayrollEmployee = {
  id: string
  name: string
  dailyRate: number
  active: boolean
}

export type PayrollAdvance = {
  id: string
  employeeId: string
  amount: number
  date: string
  note: string
}

export type PayrollWeeklyEntry = {
  id: string
  employeeId: string
  weekStart: string
  finalizedAt: string | null
  projectId: string | null
  presentDays: number
  dailyRate: number
  overtimeAmount: number
  grossPay: number
  advanceDeduction: number
}

export type PayrollAttendance = {
  entryId: string
  date: string
  present: 0 | 1
}

export type PayrollData = {
  employees: PayrollEmployee[]
  advances: PayrollAdvance[]
  entries: PayrollWeeklyEntry[]
  attendance: PayrollAttendance[]
}

export type PayrollProjectOption = {
  id: string
  name: string
  status: string
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function isValidDateText(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

export async function loadPayrollProjectOptions(): Promise<PayrollProjectOption[]> {
  const { data, error } = await requireSupabase().rpc('list_payroll_projects')
  throwIfError(error)
  if (!Array.isArray(data) || !data.every((project: unknown): project is {
    project_id: string
    project_name: string
    project_status: string
  } => typeof project === 'object' && project !== null
    && 'project_id' in project && typeof project.project_id === 'string'
    && 'project_name' in project && typeof project.project_name === 'string'
    && 'project_status' in project && typeof project.project_status === 'string')) {
    throw new Error('The payroll project list returned an invalid response.')
  }
  return data.map((project) => ({
    id: project.project_id,
    name: project.project_name,
    status: project.project_status,
  }))
}

export async function loadPayroll(): Promise<PayrollData> {
  const client = requireSupabase()
  const [employeeResult, advanceResult, entryResult, attendanceResult] = await Promise.all([
    client.from('payroll_employees')
      .select('id, full_name, daily_rate, active')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('full_name', { ascending: true }),
    client.from('payroll_cash_advances')
      .select('id, employee_id, amount, advance_date, note')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('advance_date', { ascending: false }),
    client.from('payroll_weekly_entries')
      .select('id, employee_id, week_start, finalized_at, project_id, present_days, daily_rate, overtime_amount, gross_pay, advance_deduction')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('week_start', { ascending: false }),
    client.from('payroll_attendance')
      .select('entry_id, work_date, present')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('work_date', { ascending: true }),
  ])

  for (const result of [employeeResult, advanceResult, entryResult, attendanceResult]) throwIfError(result.error)

  return {
    employees: (employeeResult.data ?? []).map((employee) => ({
      id: employee.id,
      name: employee.full_name,
      dailyRate: Number(employee.daily_rate),
      active: employee.active,
    })),
    advances: (advanceResult.data ?? []).map((advance) => ({
      id: advance.id,
      employeeId: advance.employee_id,
      amount: Number(advance.amount),
      date: advance.advance_date,
      note: advance.note ?? '',
    })),
    entries: (entryResult.data ?? []).map((entry) => ({
      id: entry.id,
      employeeId: entry.employee_id,
      weekStart: entry.week_start,
      finalizedAt: entry.finalized_at,
      projectId: entry.project_id,
      presentDays: entry.present_days,
      dailyRate: Number(entry.daily_rate),
      overtimeAmount: Number(entry.overtime_amount),
      grossPay: Number(entry.gross_pay),
      advanceDeduction: Number(entry.advance_deduction),
    })),
    attendance: (attendanceResult.data ?? []).map((day) => ({
      entryId: day.entry_id,
      date: day.work_date,
      present: day.present as 0 | 1,
    })),
  }
}

export async function createPayrollEmployee(input: { name: string; dailyRate: number }) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 120) throw new Error('Enter a name between 2 and 120 characters.')
  if (!Number.isFinite(input.dailyRate) || input.dailyRate <= 0) throw new Error('Daily rate must be greater than zero.')

  const { error } = await requireSupabase().from('payroll_employees').insert({
    organization_id: SAGACT_ORGANIZATION_ID,
    full_name: name,
    daily_rate: input.dailyRate,
  })
  throwIfError(error)
}

export async function updatePayrollEmployee(input: PayrollEmployee) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 120) throw new Error('Enter a name between 2 and 120 characters.')
  if (!Number.isFinite(input.dailyRate) || input.dailyRate <= 0) throw new Error('Daily rate must be greater than zero.')

  const { error } = await requireSupabase().from('payroll_employees')
    .update({ full_name: name, daily_rate: input.dailyRate, active: input.active })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('id', input.id)
  throwIfError(error)
}

export async function recordPayrollAdvance(input: {
  employeeId: string
  amount: number
  date: string
  note: string
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Cash advance must be greater than zero.')
  if (!isValidDateText(input.date)) throw new Error('Enter a valid advance date.')
  if (input.note.trim().length > 500) throw new Error('Advance note must not exceed 500 characters.')
  const { error } = await requireSupabase().rpc('record_payroll_cash_advance', {
    p_employee_id: input.employeeId,
    p_amount: input.amount,
    p_advance_date: input.date,
    p_note: input.note.trim(),
  })
  throwIfError(error)
}

export async function updatePayrollAdvance(input: {
  id: string
  amount: number
  date: string
  note: string
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Cash advance must be greater than zero.')
  if (!isValidDateText(input.date)) throw new Error('Enter a valid advance date.')
  if (input.note.trim().length > 500) throw new Error('Advance note must not exceed 500 characters.')
  const { error } = await requireSupabase().rpc('update_payroll_cash_advance', {
    p_advance_id: input.id,
    p_amount: input.amount,
    p_advance_date: input.date,
    p_note: input.note.trim(),
  })
  throwIfError(error)
}

export function validatePayrollWeekEntry(input: {
  weekStart: string
  attendance: { date: string; present: 0 | 1 }[]
  advanceDeduction: number
  dailyRate: number
  overtimeAmount?: number
}) {
  const week = new Date(`${input.weekStart}T00:00:00`)
  const localWeekDate = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`
  if (!isValidDateText(input.weekStart) || Number.isNaN(week.getTime()) || localWeekDate !== input.weekStart || week.getDay() !== 1) {
    throw new Error('Payroll week must start on a Monday.')
  }
  if (!Number.isFinite(input.dailyRate) || input.dailyRate <= 0) throw new Error('Daily rate must be greater than zero.')
  if (input.attendance.length !== 7) throw new Error('Record attendance for all seven days of the payroll week.')
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(week)
    day.setDate(day.getDate() + offset)
    const expectedDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const matchingDates = input.attendance.filter((item) => item.date === expectedDate)
    if (matchingDates.length !== 1 || (matchingDates[0].present !== 0 && matchingDates[0].present !== 1)) {
      throw new Error('Attendance must have exactly one 1 or 0 value for each day of the payroll week.')
    }
  }
  if (!Number.isFinite(input.advanceDeduction) || input.advanceDeduction < 0) {
    throw new Error('Cash advance deduction cannot be negative.')
  }
  const overtimeAmount = input.overtimeAmount ?? 0
  if (!Number.isFinite(overtimeAmount) || overtimeAmount < 0) {
    throw new Error('Overtime amount cannot be negative.')
  }
  const grossPay = input.attendance.reduce((sum, day) => sum + day.present * input.dailyRate, 0) + overtimeAmount
  if (input.advanceDeduction > grossPay) throw new Error('Cash advance deduction cannot exceed gross pay.')
}

export async function savePayrollWeekEntry(input: {
  employeeId: string
  weekStart: string
  projectId: string | null
  attendance: { date: string; present: 0 | 1 }[]
  advanceDeduction: number
  dailyRate: number
  overtimeAmount?: number
}) {
  validatePayrollWeekEntry(input)

  const { error } = await requireSupabase().rpc('save_payroll_week_entry', {
    p_employee_id: input.employeeId,
    p_week_start: input.weekStart,
    p_project_id: input.projectId,
    p_attendance: input.attendance.map(({ date, present }) => ({ work_date: date, present })),
    p_advance_deduction: input.advanceDeduction,
    p_overtime_amount: input.overtimeAmount ?? 0,
  })
  throwIfError(error)
}

export async function finalizePayrollWeek(weekStart: string) {
  const week = new Date(`${weekStart}T00:00:00`)
  const localWeekDate = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`
  if (!isValidDateText(weekStart) || Number.isNaN(week.getTime()) || localWeekDate !== weekStart || week.getDay() !== 1) {
    throw new Error('Payroll week must start on a Monday.')
  }
  const { error } = await requireSupabase().rpc('finalize_payroll_week', {
    p_week_start: weekStart,
  })
  throwIfError(error)
}

export function getWeekStart(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

export function getWeekDates(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00`)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(date.getDate() + index)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
}
