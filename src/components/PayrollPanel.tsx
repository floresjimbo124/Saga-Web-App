import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, BadgeCheck, History, Pencil, Plus, Save, Users, WalletCards, X } from 'lucide-react'
import {
  createPayrollEmployee,
  finalizePayrollWeek,
  getWeekDates,
  getWeekStart,
  loadPayroll,
  recordPayrollAdvance,
  savePayrollWeekEntry,
  updatePayrollAdvance,
  updatePayrollEmployee,
  type PayrollAdvance,
  type PayrollAttendance,
  type PayrollEmployee,
  type PayrollProjectOption,
  type PayrollWeeklyEntry,
} from '../data/payroll'
import { MoneyInput } from './MoneyInput'
import { useToast } from './toast-context'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })
const shortDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

function localToday() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftDate(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function displayDate(dateText: string, formatter = shortDate) {
  return formatter.format(new Date(`${dateText}T12:00:00`))
}

function EmployeeEditor({ employee, onSaved }: {
  employee: PayrollEmployee
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [name, setName] = useState(employee.name)
  const [dailyRate, setDailyRate] = useState(String(employee.dailyRate))
  const [active, setActive] = useState(employee.active)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await updatePayrollEmployee({ id: employee.id, name, dailyRate: Number(dailyRate), active })
      showToast('Employee updated.', 'update')
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update this employee.')
    } finally {
      setBusy(false)
    }
  }

  return <form className="payroll-employee-row" onSubmit={(event) => { void submit(event) }}>
    <label className="form-field">Employee name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <label className="form-field">Daily rate<MoneyInput min="0.01" step="0.01" value={dailyRate} onChange={setDailyRate} required /></label>
    <label className="payroll-active-control"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Active</label>
    <button className="button button-secondary" type="submit" disabled={busy}><Save size={14} />{busy ? 'Saving…' : 'Save'}</button>
    {error && <p className="form-error payroll-form-error" role="alert">{error}</p>}
  </form>
}

function WeeklyPayrollRow({ employee, weekStart, dates, entry, attendance, projects, advances, entries, onSaved, onDraftSaving, onManageAdvances }: {
  employee: PayrollEmployee
  weekStart: string
  dates: string[]
  entry: PayrollWeeklyEntry | undefined
  attendance: PayrollAttendance[]
  projects: PayrollProjectOption[]
  advances: PayrollAdvance[]
  entries: PayrollWeeklyEntry[]
  onSaved: () => void
  onDraftSaving: (employeeId: string, saving: boolean) => void
  onManageAdvances: () => void
}) {
  const { showToast } = useToast()
  const savedAttendance = new Map(attendance.filter((day) => day.entryId === entry?.id).map((day) => [day.date, day.present]))
  const [days, setDays] = useState(() => dates.map((date) => savedAttendance.get(date) ?? 0 as 0 | 1))
  const [projectId, setProjectId] = useState(() => {
    if (entry?.projectId) return entry.projectId
    return projects.find((project) => project.status === 'active')?.id ?? ''
  })
  const [advanceDeduction, setAdvanceDeduction] = useState(String(entry?.advanceDeduction ?? 0))
  const [overtimeAmount, setOvertimeAmount] = useState(String(entry?.overtimeAmount ?? 0))
  const dailyRate = entry?.dailyRate ?? employee.dailyRate
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  const [isEditingFinalized, setIsEditingFinalized] = useState(false)
  const firstRender = useRef(true)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const onSavedRef = useRef(onSaved)
  const presentDays = days.reduce<number>((total, present) => total + present, 0)
  const overtimePay = Number(overtimeAmount) || 0
  const grossPay = presentDays * dailyRate + overtimePay
  const finalized = Boolean(entry?.finalizedAt) || localToday() > getWeekDates(weekStart)[6]
  const isLocked = Boolean(entry) && finalized
  const isEditable = !isLocked || isEditingFinalized
  const previousDeductions = entries
    .filter((item) => item.employeeId === employee.id && item.id !== entry?.id)
    .reduce((total, item) => total + item.advanceDeduction, 0)
  const advanceBalance = Math.max(0, advances
    .filter((item) => item.employeeId === employee.id)
    .reduce((total, item) => total + item.amount, 0) - previousDeductions)
  const deduction = Number(advanceDeduction) || 0

  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  useEffect(() => () => {
    onDraftSaving(employee.id, false)
  }, [employee.id, onDraftSaving])

  const persistDraft = useCallback(() => {
    const savePromise = saveQueue.current.then(() => savePayrollWeekEntry({
      employeeId: employee.id,
      weekStart,
      projectId: projectId || null,
      attendance: getWeekDates(weekStart).map((date, index) => ({ date, present: days[index] as 0 | 1 })),
      advanceDeduction: deduction,
      dailyRate,
      overtimeAmount: overtimePay,
    }))
    saveQueue.current = savePromise.then(() => undefined, () => undefined)
    return savePromise
  }, [dailyRate, days, deduction, employee.id, overtimePay, projectId, weekStart])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (isLocked) return
    onDraftSaving(employee.id, true)
    let current = true
    const timer = window.setTimeout(() => {
      void persistDraft()
        .then(() => {
          if (current) {
            setError('')
            setDraftStatus(finalized ? 'Correction saved.' : 'Draft saved · posts to project Sunday at 11:59 PM.')
            onDraftSaving(employee.id, false)
            onSavedRef.current()
          }
        })
        .catch((saveError: unknown) => {
          if (current) {
            setError(saveError instanceof Error ? saveError.message : 'Could not save this payroll draft.')
            setDraftStatus('')
            onDraftSaving(employee.id, false)
          }
        })
    }, 700)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [advanceDeduction, days, employee.id, isLocked, finalized, onDraftSaving, overtimePay, persistDraft, projectId])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    setDraftStatus('Saving…')
    onDraftSaving(employee.id, true)
    try {
      await persistDraft()
      showToast(finalized ? 'Payroll correction saved.' : 'Payroll draft saved.', entry ? 'update' : 'create')
      setDraftStatus(finalized ? 'Correction saved.' : 'Draft saved · posts to project Sunday at 11:59 PM.')
      onDraftSaving(employee.id, false)
      if (isLocked) setIsEditingFinalized(false)
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this payroll entry.')
      setDraftStatus('')
      onDraftSaving(employee.id, false)
    } finally {
      setBusy(false)
    }
  }

  const cancelFinalizedEdit = () => {
    setDays(dates.map((date) => savedAttendance.get(date) ?? 0))
    setProjectId(entry?.projectId ?? projects.find((project) => project.status === 'active')?.id ?? '')
    setAdvanceDeduction(String(entry?.advanceDeduction ?? 0))
    setOvertimeAmount(String(entry?.overtimeAmount ?? 0))
    setError('')
    setDraftStatus('')
    setIsEditingFinalized(false)
  }

  return <form className={`payroll-week-row${isLocked && !isEditingFinalized ? ' payroll-week-row-locked' : ''}`} onSubmit={(event) => { void save(event) }}>
    <div className="payroll-attendance-grid" role="group" aria-label={`${employee.name} attendance`}>
      {dates.map((date, index) => <label className="payroll-day" key={date}>
        <span>{displayDate(date)}</span>
        <select aria-label={`${employee.name} attendance ${displayDate(date, fullDate)}`} value={days[index]} disabled={!isEditable || busy} onChange={(event) => {
          const next = [...days]
          next[index] = Number(event.target.value) as 0 | 1
          setDays(next)
        }}>
          <option value="1">1</option>
          <option value="0">0</option>
        </select>
      </label>)}
    </div>
    <label className="form-field payroll-project-field">Assign cost to project
      <select value={projectId} disabled={!isEditable || busy} onChange={(event) => setProjectId(event.target.value)}>
        <option value="">Company-wide / unassigned</option>
        {projects.filter((project) => project.status === 'active').map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
      </select>
    </label>
    <div className="form-field payroll-deduction-field">
      <label htmlFor={`advance-deduction-${employee.id}`}>Cash advance deduction</label>
      <MoneyInput id={`advance-deduction-${employee.id}`} min="0" max={Math.min(grossPay, advanceBalance)} step="0.01" value={advanceDeduction} disabled={!isEditable || busy} onChange={setAdvanceDeduction} />
      <small>{money.format(advanceBalance)} available</small>
    </div>
    <label className="form-field payroll-overtime-field">Overtime amount (this week)
      <MoneyInput min="0" step="0.01" value={overtimeAmount} disabled={!isEditable || busy} onChange={setOvertimeAmount} placeholder="0.00" />
    </label>
    <div className="payroll-pay-summary">
      <span>Regular pay <strong>{money.format(presentDays * dailyRate)}</strong></span>
      <span>Overtime <strong>{money.format(overtimePay)}</strong></span>
      <span>Gross <strong>{money.format(grossPay)}</strong></span>
      <span>Advance deduction <strong>− {money.format(deduction)}</strong></span>
      <span>Net pay <strong>{money.format(grossPay - deduction)}</strong></span>
      <span className="payroll-draft-status" role="status">{draftStatus || (isLocked ? isEditingFinalized ? 'Editing finalized payroll. Save changes to update project cost.' : 'Finalized · corrections update project cost.' : 'Changes save automatically.')}</span>
      {isLocked ? isEditingFinalized
        ? <div className="payroll-edit-actions">
          <button type="button" className="button button-secondary" disabled={busy} onClick={cancelFinalizedEdit}><X size={14} />Cancel</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={onManageAdvances}><WalletCards size={14} />Manage advances</button>
          <button type="submit" className="button button-primary" disabled={busy}><Save size={14} />{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
        : <button type="button" className="button button-muted" disabled={busy} onClick={() => { setDraftStatus(''); setError(''); setIsEditingFinalized(true) }}><Pencil size={14} />Edit</button>
        : <div className="payroll-edit-actions">
          <button type="button" className="button button-secondary" disabled={busy} onClick={onManageAdvances}><WalletCards size={14} />Manage advances</button>
          <button type="submit" className="button button-primary" disabled={busy}><Save size={14} />{busy ? 'Saving…' : 'Save draft now'}</button>
        </div>}
    </div>
    {error && <p className="form-error payroll-form-error" role="alert">{error}</p>}
  </form>
}

export function PayrollPanel({ projects, onChanged }: {
  projects: PayrollProjectOption[]
  onChanged: () => void
}) {
  const { showToast, confirmToast } = useToast()
  const [data, setData] = useState<Awaited<ReturnType<typeof loadPayroll>>>({ employees: [], advances: [], entries: [], attendance: [] })
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [currentWeekStart] = useState(() => getWeekStart(new Date()))
  const [reloadKey, setReloadKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [employeeRate, setEmployeeRate] = useState('')
  const [employeeError, setEmployeeError] = useState('')
  const [isPayrollHistoryOpen, setIsPayrollHistoryOpen] = useState(false)
  const [historyWeekFilter, setHistoryWeekFilter] = useState('all')
  const [isViewEmployeesOpen, setIsViewEmployeesOpen] = useState(false)
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false)
  const [selectedPayrollEmployeeId, setSelectedPayrollEmployeeId] = useState<string | null>(null)
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceDate, setAdvanceDate] = useState(localToday)
  const [advanceNote, setAdvanceNote] = useState('')
  const [advanceError, setAdvanceError] = useState('')
  const [isAddAdvanceOpen, setIsAddAdvanceOpen] = useState(false)
  const [advanceHistoryEmployeeId, setAdvanceHistoryEmployeeId] = useState<string | null>(null)
  const [editingAdvanceId, setEditingAdvanceId] = useState<string | null>(null)
  const [editingAdvanceAmount, setEditingAdvanceAmount] = useState('')
  const [editingAdvanceDate, setEditingAdvanceDate] = useState('')
  const [editingAdvanceNote, setEditingAdvanceNote] = useState('')
  const [advanceEditError, setAdvanceEditError] = useState('')
  const [isSavingAdvanceEdit, setIsSavingAdvanceEdit] = useState(false)
  const [isSavingEmployee, setIsSavingEmployee] = useState(false)
  const [isSavingAdvance, setIsSavingAdvance] = useState(false)
  const [isCheckingFinalize, setIsCheckingFinalize] = useState(false)
  const [isConfirmingWeek, setIsConfirmingWeek] = useState(false)
  const [isFinalizingWeek, setIsFinalizingWeek] = useState(false)
  const [weekFinalizeError, setWeekFinalizeError] = useState('')
  const [pendingDraftSaves, setPendingDraftSaves] = useState<Set<string>>(() => new Set())
  const refresh = (background = false) => {
    if (!background) setIsLoading(true)
    setReloadKey((key) => key + 1)
  }

  useEffect(() => {
    let active = true
    void loadPayroll()
      .then((result) => {
        if (active) {
          setData(result)
          setLoadError('')
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Could not load payroll.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [reloadKey])

  const activeEmployees = data.employees.filter((employee) => employee.active)
  const weekDates = getWeekDates(weekStart)
  const currentEntries = data.entries.filter((entry) => entry.weekStart === weekStart)
  const finalizedEntries = data.entries
    .filter((entry) => entry.finalizedAt)
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart)
      || (data.employees.find((employee) => employee.id === left.employeeId)?.name ?? '')
        .localeCompare(data.employees.find((employee) => employee.id === right.employeeId)?.name ?? ''))
  const historyWeeks = [...new Set(finalizedEntries.map((entry) => entry.weekStart))]
  const visibleHistoryEntries = historyWeekFilter === 'all'
    ? finalizedEntries
    : finalizedEntries.filter((entry) => entry.weekStart === historyWeekFilter)
  const savedGross = currentEntries.reduce((sum, entry) => sum + entry.grossPay, 0)
  const savedDeductions = currentEntries.reduce((sum, entry) => sum + entry.advanceDeduction, 0)
  const draftEntries = currentEntries.filter((entry) => !entry.finalizedAt)
  const canFinalizeWeek = weekStart <= currentWeekStart
  const updateDraftSaving = useCallback((employeeId: string, saving: boolean) => {
    setPendingDraftSaves((current) => {
      const next = new Set(current)
      if (saving) next.add(employeeId)
      else next.delete(employeeId)
      return next
    })
  }, [])

  const finalizeWeek = async () => {
    setWeekFinalizeError('')
    setIsFinalizingWeek(true)
    try {
      await finalizePayrollWeek(weekStart)
      showToast('Payroll finalized and assigned project costs updated.', 'update')
      setPendingDraftSaves(new Set())
      refresh()
      onChanged()
    } catch (finalizeError) {
      const message = finalizeError instanceof Error ? finalizeError.message : 'Could not finalize this payroll week.'
      setWeekFinalizeError(message)
      showToast(message, 'update')
    } finally {
      setIsFinalizingWeek(false)
    }
  }
  const confirmAndFinalizeWeek = async () => {
    setIsConfirmingWeek(true)
    const weekEnd = shiftDate(weekStart, 6)
    try {
      const confirmed = await confirmToast(`Are you sure you want to finalize payroll for ${displayDate(weekStart, fullDate)} – ${displayDate(weekEnd, fullDate)}?`)
      if (!confirmed) return

      if (pendingDraftSaves.size > 0) {
        showToast('Wait for payroll changes to finish saving, then try again.', 'update')
        return
      }

      setIsCheckingFinalize(true)
      const latestPayroll = await loadPayroll()
      setData(latestPayroll)
      const latestDraftEntries = latestPayroll.entries.filter((entry) => entry.weekStart === weekStart && !entry.finalizedAt)
      if (!latestDraftEntries.length) {
        showToast('No saved payroll entries are ready for this week. Save attendance first.', 'update')
        return
      }

      await finalizeWeek()
    } catch (checkError) {
      const message = checkError instanceof Error ? checkError.message : 'Could not check saved payroll entries.'
      setWeekFinalizeError(message)
      showToast(message, 'update')
    } finally {
      setIsCheckingFinalize(false)
      setIsConfirmingWeek(false)
    }
  }
  const addEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setEmployeeError('')
    setIsSavingEmployee(true)
    try {
      await createPayrollEmployee({ name: employeeName, dailyRate: Number(employeeRate) })
      setEmployeeName('')
      setEmployeeRate('')
      setIsCreatingEmployee(false)
      showToast('Employee added.')
      refresh(true)
    } catch (saveError) {
      setEmployeeError(saveError instanceof Error ? saveError.message : 'Could not add this employee.')
    } finally {
      setIsSavingEmployee(false)
    }
  }

  const addAdvance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAdvanceError('')
    setIsSavingAdvance(true)
    try {
      if (!advanceHistoryEmployeeId) throw new Error('Select an employee before recording an advance.')
      await recordPayrollAdvance({
        employeeId: advanceHistoryEmployeeId,
        amount: Number(advanceAmount),
        date: advanceDate,
        note: advanceNote,
      })
      setAdvanceAmount('')
      setAdvanceNote('')
      setAdvanceDate(localToday())
      showToast('Cash advance recorded.')
      setIsAddAdvanceOpen(false)
      refresh(true)
    } catch (saveError) {
      setAdvanceError(saveError instanceof Error ? saveError.message : 'Could not record this cash advance.')
    } finally {
      setIsSavingAdvance(false)
    }
  }

  const startAdvanceEdit = (advance: PayrollAdvance) => {
    setEditingAdvanceId(advance.id)
    setEditingAdvanceAmount(String(advance.amount))
    setEditingAdvanceDate(advance.date)
    setEditingAdvanceNote(advance.note)
    setAdvanceEditError('')
  }

  const saveAdvanceEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingAdvanceId) return
    setAdvanceEditError('')
    setIsSavingAdvanceEdit(true)
    try {
      await updatePayrollAdvance({
        id: editingAdvanceId,
        amount: Number(editingAdvanceAmount),
        date: editingAdvanceDate,
        note: editingAdvanceNote,
      })
      setEditingAdvanceId(null)
      showToast('Cash advance updated.', 'update')
      refresh(true)
    } catch (saveError) {
      setAdvanceEditError(saveError instanceof Error ? saveError.message : 'Could not update this cash advance.')
    } finally {
      setIsSavingAdvanceEdit(false)
    }
  }

  return <div className="payroll-page">
    <section className="surface-card tab-content payroll-weekly-section pr-card">
      <header className="pr-header">
        <div className="pr-title"><h2>Weekly payroll</h2><p>Mark attendance per day. Payroll auto-finalizes Sunday 11:59 PM (Manila).</p></div>
        <div className="pr-header-actions">
          <button type="button" className="button button-secondary" onClick={() => { setIsCreatingEmployee(false); setIsViewEmployeesOpen(true) }}><Users size={15} />Employees</button>
          <button type="button" className="button button-secondary" onClick={() => setIsPayrollHistoryOpen(true)}><History size={15} />History</button>
        </div>
      </header>
      <div className="pr-week">
        <button type="button" className="pr-week-step" onClick={() => setWeekStart(shiftDate(weekStart, -7))} aria-label="Previous payroll week"><ArrowLeft size={16} /></button>
        <div className="pr-week-label"><small>Pay week</small><strong>{displayDate(weekStart, fullDate)} – {displayDate(shiftDate(weekStart, 6), fullDate)}</strong></div>
        <button type="button" className="pr-week-step" onClick={() => setWeekStart(shiftDate(weekStart, 7))} aria-label="Next payroll week"><ArrowRight size={16} /></button>
      </div>
      <div className="pr-stats">
        <div><small>Gross pay</small><strong>{money.format(savedGross)}</strong></div>
        <div><small>Deductions</small><strong>{money.format(savedDeductions)}</strong></div>
        <div className="is-net"><small>Net pay</small><strong>{money.format(savedGross - savedDeductions)}</strong></div>
      </div>
      {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="text-button" onClick={() => refresh()}>Retry</button></p>}
      {isLoading ? <p className="payroll-empty">Loading payroll…</p> : activeEmployees.length ? <div className="payroll-week-list">{activeEmployees.map((employee) => {
        const entry = currentEntries.find((item) => item.employeeId === employee.id)
        const netPay = entry ? entry.grossPay - entry.advanceDeduction : null
        const status = entry ? entry.finalizedAt ? 'Finalized' : 'Draft saved' : 'Not entered'
        return <button
          type="button"
          className="payroll-worker-row"
          key={employee.id}
          onClick={() => setSelectedPayrollEmployeeId(employee.id)}
          aria-label={`Edit payroll for ${employee.name}`}
        >
          <span className="payroll-worker-avatar" aria-hidden="true">{employee.name.trim().charAt(0).toUpperCase() || '?'}</span>
          <span className="payroll-worker-name"><strong>{employee.name}</strong><small>{money.format(entry?.dailyRate ?? employee.dailyRate)} per day · {entry ? `${entry.presentDays} days present` : 'Attendance not entered'}</small></span>
          <span className={`payroll-worker-status${entry?.finalizedAt ? ' is-finalized' : ''}${!entry ? ' is-empty' : ''}`}>{status}</span>
          <span className="payroll-worker-pay"><strong>{netPay === null ? '—' : money.format(netPay)}</strong><small>Net pay</small></span>
          <span className="payroll-worker-open" aria-hidden="true">›</span>
        </button>
      })}</div> : <div className="pr-empty">
        <span className="pr-empty-icon" aria-hidden="true"><Users size={20} /></span>
        <strong>No active employees yet</strong>
        <p>Add your crew to start tracking attendance and weekly pay.</p>
        <button type="button" className="button button-primary" onClick={() => { setIsCreatingEmployee(true); setIsViewEmployeesOpen(true) }}><Plus size={15} />Add employee</button>
      </div>}
      <footer className="pr-finalize">
        <div className="pr-finalize-copy">
          <strong>{draftEntries.length > 0 ? `${draftEntries.length} saved ${draftEntries.length === 1 ? 'entry' : 'entries'} ready to finalize` : 'Nothing to finalize yet'}</strong>
          <small>{pendingDraftSaves.size > 0 ? 'Waiting for payroll changes to finish saving…' : draftEntries.length > 0 ? 'Finalizing now posts payroll and charges each assigned project.' : 'Save at least one employee’s attendance first.'}</small>
        </div>
        <button type="button" className="button button-primary" disabled={!canFinalizeWeek || isCheckingFinalize || isConfirmingWeek || isFinalizingWeek} onClick={() => { void confirmAndFinalizeWeek() }}><BadgeCheck size={15} />{isCheckingFinalize ? 'Checking…' : isConfirmingWeek ? 'Confirming…' : isFinalizingWeek ? 'Finalizing…' : 'Finalize week'}</button>
      </footer>
      {weekFinalizeError && <p className="form-error" role="alert">{weekFinalizeError}</p>}
      {!isLoading && currentEntries.length > 0 && <div className="payroll-history-heading">
        <div className="payroll-history-title">Weekly payroll by employee</div>
        <div className="payroll-history-list">{currentEntries.map((entry) => {
        const employee = data.employees.find((item) => item.id === entry.employeeId)
        const project = projects.find((item) => item.id === entry.projectId)
        return <div className="payroll-history-row" key={entry.id}>
          <span><strong>{employee?.name ?? 'Employee'}</strong><small>{project?.name ?? 'Company-wide'} · {entry.presentDays} days present{entry.overtimeAmount > 0 ? ` · ${money.format(entry.overtimeAmount)} overtime` : ''}</small></span>
          <span><strong>{money.format(entry.grossPay)}</strong><small>Gross pay</small></span>
          <span><strong>− {money.format(entry.advanceDeduction)}</strong><small>Advance</small></span>
          <span><strong>{money.format(entry.grossPay - entry.advanceDeduction)}</strong><small>Net pay</small></span>
        </div>
        })}</div>
      </div>}
    </section>

    {selectedPayrollEmployeeId && (() => {
      const employee = activeEmployees.find((item) => item.id === selectedPayrollEmployeeId)
      if (!employee) return null
      const entry = currentEntries.find((item) => item.employeeId === employee.id)
      const isSaving = pendingDraftSaves.has(employee.id)
      const closePayrollDrawer = () => {
        if (isSaving) {
          showToast('Wait for payroll changes to finish saving before closing.', 'update')
          return
        }
        setSelectedPayrollEmployeeId(null)
      }
      return createPortal(<div className="modal-backdrop payroll-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePayrollDrawer() }}>
        <section className="project-modal payroll-worker-drawer" role="dialog" aria-modal="true" aria-labelledby="payroll-worker-drawer-title">
          <div className="modal-heading">
            <div><div className="section-kicker">Weekly payroll · {displayDate(weekStart, fullDate)} – {displayDate(shiftDate(weekStart, 6), fullDate)}</div><h2 id="payroll-worker-drawer-title">{employee.name}</h2></div>
            <button className="icon-button" type="button" onClick={closePayrollDrawer} aria-label={`Close payroll for ${employee.name}`} disabled={isSaving}><X size={18} /></button>
          </div>
          <p className="payroll-drawer-intro">{money.format(entry?.dailyRate ?? employee.dailyRate)} per day{isSaving ? ' · Saving changes…' : ''}</p>
          <WeeklyPayrollRow
            key={`${employee.id}:${weekStart}`}
            employee={employee}
            weekStart={weekStart}
            dates={weekDates}
            entry={entry}
            attendance={data.attendance}
            projects={projects}
            advances={data.advances}
            entries={data.entries}
            onSaved={() => { refresh(true); onChanged() }}
            onDraftSaving={updateDraftSaving}
            onManageAdvances={() => { setAdvanceHistoryEmployeeId(employee.id); setEditingAdvanceId(null); setIsAddAdvanceOpen(false); setAdvanceEditError(''); setAdvanceError('') }}
          />
        </section>
      </div>, document.body)
    })()}

    {isPayrollHistoryOpen && createPortal(<div className="modal-backdrop payroll-history-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsPayrollHistoryOpen(false) }}>
      <section className="project-modal payroll-history-dialog" role="dialog" aria-modal="true" aria-labelledby="payroll-history-title">
        <div className="modal-heading">
          <div><div className="section-kicker">All weeks</div><h2 id="payroll-history-title">Payroll history</h2></div>
          <button className="icon-button" type="button" onClick={() => setIsPayrollHistoryOpen(false)} aria-label="Close payroll history"><X size={18} /></button>
        </div>
        <p className="modal-intro">Finalized payroll entries, newest week first.</p>
        <div className="payroll-history-controls">
          <label className="form-field">Filter by week
            <select value={historyWeekFilter} onChange={(event) => setHistoryWeekFilter(event.target.value)}>
              <option value="all">All weeks</option>
              {historyWeeks.map((start) => <option value={start} key={start}>{displayDate(start, fullDate)} – {displayDate(getWeekDates(start)[6], fullDate)}</option>)}
            </select>
          </label>
          {!isLoading && <span className="project-milestone-count">{visibleHistoryEntries.length} entr{visibleHistoryEntries.length === 1 ? 'y' : 'ies'}</span>}
        </div>
        {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="text-button" onClick={() => refresh()}>Retry</button></p>}
        {isLoading ? <p className="payroll-empty">Loading payroll history…</p> : visibleHistoryEntries.length ? <div className="payroll-all-history-list">
          {visibleHistoryEntries.map((entry) => {
            const employee = data.employees.find((item) => item.id === entry.employeeId)
            const project = projects.find((item) => item.id === entry.projectId)
            const weekEnd = getWeekDates(entry.weekStart)[6]
            return <article className="payroll-history-row payroll-history-all-row" key={entry.id}>
              <span>
                <strong>{employee?.name ?? 'Employee'}</strong>
                <small>{displayDate(entry.weekStart, fullDate)} – {displayDate(weekEnd, fullDate)} · {entry.presentDays} days present</small>
              </span>
              <span>
                <strong>{project?.name ?? 'Company-wide'}</strong>
                <small>{money.format(entry.dailyRate)} per day · Finalized {entry.finalizedAt ? fullDate.format(new Date(entry.finalizedAt)) : ''}</small>
              </span>
              <span><strong>{money.format(entry.grossPay)}</strong><small>Gross pay{entry.overtimeAmount > 0 ? ` · ${money.format(entry.overtimeAmount)} overtime` : ''}</small></span>
              <span><strong>− {money.format(entry.advanceDeduction)}</strong><small>Advance deduction</small></span>
              <span><strong>{money.format(entry.grossPay - entry.advanceDeduction)}</strong><small>Net pay</small></span>
            </article>
          })}
        </div> : <p className="payroll-empty">{finalizedEntries.length ? 'No finalized payroll entries for this week.' : 'No finalized payroll entries yet.'}</p>}
      </section>
    </div>, document.body)}
    {isViewEmployeesOpen && createPortal(<div className="modal-backdrop payroll-employees-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingEmployee) { setIsViewEmployeesOpen(false); setIsCreatingEmployee(false) } }}>
      <section className="project-modal payroll-employees-dialog" role="dialog" aria-modal="true" aria-labelledby="payroll-employees-title">
        <div className="modal-heading">
          <div><div className="section-kicker">Employee management</div><h2 id="payroll-employees-title">Employees</h2></div>
          <button className="icon-button" type="button" onClick={() => { setIsViewEmployeesOpen(false); setIsCreatingEmployee(false) }} aria-label="Close" disabled={isSavingEmployee}><X size={18} /></button>
        </div>
        <p className="modal-intro">Manage employee names, daily pay rates, and active status.</p>
        <div className="payroll-employee-modal-actions">
          <button type="button" className="button button-primary" onClick={() => { setEmployeeError(''); setIsCreatingEmployee((open) => !open) }} disabled={isSavingEmployee}>{isCreatingEmployee ? <X size={15} /> : <Plus size={15} />}{isCreatingEmployee ? 'Cancel new employee' : 'Add employee'}</button>
        </div>
        {isCreatingEmployee && <form className="payroll-add-employee-form" onSubmit={(event) => { void addEmployee(event) }}>
          <label className="form-field">Employee name<input autoFocus value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="e.g. Juan Dela Cruz" maxLength={120} required /></label>
          <label className="form-field">Daily rate<MoneyInput min="0.01" step="0.01" value={employeeRate} onChange={setEmployeeRate} placeholder="0.00" required /></label>
          {employeeError && <p className="form-error" role="alert">{employeeError}</p>}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setIsCreatingEmployee(false)} disabled={isSavingEmployee}>Cancel</button><button className="button button-primary" type="submit" disabled={isSavingEmployee}><Plus size={15} />{isSavingEmployee ? 'Adding…' : 'Save employee'}</button></div>
        </form>}
        {data.employees.length ? <div className="payroll-employee-list">{data.employees.map((employee) => <EmployeeEditor key={employee.id} employee={employee} onSaved={() => refresh(true)} />)}</div> : <p className="payroll-empty">No employees added yet.</p>}
      </section>
    </div>, document.body)}
    {advanceHistoryEmployeeId && createPortal(<div className="modal-backdrop payroll-advances-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingAdvanceEdit && !isSavingAdvance) { setAdvanceHistoryEmployeeId(null); setEditingAdvanceId(null); setIsAddAdvanceOpen(false) } }}>
      <section className="project-modal payroll-advances-dialog" role="dialog" aria-modal="true" aria-labelledby="payroll-advance-history-title">
        <div className="modal-heading">
          <div><div className="section-kicker">Cash advances</div><h2 id="payroll-advance-history-title">{data.employees.find((employee) => employee.id === advanceHistoryEmployeeId)?.name ?? 'Employee'}</h2></div>
          <button className="icon-button" type="button" onClick={() => { setAdvanceHistoryEmployeeId(null); setEditingAdvanceId(null); setIsAddAdvanceOpen(false) }} aria-label="Close" disabled={isSavingAdvanceEdit || isSavingAdvance}><X size={18} /></button>
        </div>
        <button type="button" className="button button-primary payroll-advance-add-button" onClick={() => { setAdvanceError(''); setIsAddAdvanceOpen((open) => !open) }} disabled={isSavingAdvance || isSavingAdvanceEdit}>{isAddAdvanceOpen ? <X size={15} /> : <Plus size={15} />}{isAddAdvanceOpen ? 'Cancel new advance' : 'Create new advance'}</button>
        {isAddAdvanceOpen && <form className="payroll-advance-edit-form payroll-advance-create-form" onSubmit={(event) => { void addAdvance(event) }}>
          <strong>New advance</strong>
          <label className="form-field">Amount<MoneyInput min="0.01" step="0.01" value={advanceAmount} onChange={setAdvanceAmount} placeholder="0.00" required /></label>
          <label className="form-field">Date<input type="date" value={advanceDate} onChange={(event) => setAdvanceDate(event.target.value)} required /></label>
          <label className="form-field payroll-advance-edit-note">Note (optional)<input value={advanceNote} onChange={(event) => setAdvanceNote(event.target.value)} maxLength={500} placeholder="Reason or reference" /></label>
          {advanceError && <p className="form-error payroll-form-error" role="alert">{advanceError}</p>}
          <div className="payroll-advance-edit-actions">
            <button type="button" className="button button-secondary" onClick={() => setIsAddAdvanceOpen(false)} disabled={isSavingAdvance}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={isSavingAdvance}><Plus size={14} />{isSavingAdvance ? 'Recording…' : 'Save advance'}</button>
          </div>
        </form>}
        <div className="payroll-advance-history-list">
          {data.advances.filter((advance) => advance.employeeId === advanceHistoryEmployeeId).map((advance) => {
            const isEditing = editingAdvanceId === advance.id
            return <article className="payroll-advance-record" key={advance.id}>
              {isEditing ? <form className="payroll-advance-edit-form" onSubmit={(event) => { void saveAdvanceEdit(event) }}>
                <strong>Edit advance</strong>
                <label className="form-field">Amount<MoneyInput min="0.01" step="0.01" value={editingAdvanceAmount} onChange={setEditingAdvanceAmount} required /></label>
                <label className="form-field">Date<input type="date" value={editingAdvanceDate} onChange={(event) => setEditingAdvanceDate(event.target.value)} required /></label>
                <label className="form-field payroll-advance-edit-note">Note (optional)<input value={editingAdvanceNote} onChange={(event) => setEditingAdvanceNote(event.target.value)} maxLength={500} /></label>
                {advanceEditError && <p className="form-error payroll-form-error" role="alert">{advanceEditError}</p>}
                <div className="payroll-advance-edit-actions">
                  <button type="button" className="button button-secondary" onClick={() => { setEditingAdvanceId(null); setAdvanceEditError('') }} disabled={isSavingAdvanceEdit}><X size={14} />Cancel</button>
                  <button type="submit" className="button button-primary" disabled={isSavingAdvanceEdit}><Save size={14} />{isSavingAdvanceEdit ? 'Saving…' : 'Save changes'}</button>
                </div>
              </form> : <div className="payroll-advance-record-view">
                <span><strong>{displayDate(advance.date, fullDate)}</strong><small>{advance.note || 'No note'}</small></span>
                <strong>{money.format(advance.amount)}</strong>
                <button type="button" className="button button-secondary" onClick={() => startAdvanceEdit(advance)} disabled={editingAdvanceId !== null}><Pencil size={14} />Edit</button>
              </div>}
            </article>
          })}
          {data.advances.every((advance) => advance.employeeId !== advanceHistoryEmployeeId) && <p className="payroll-empty">No cash advances recorded for this employee.</p>}
        </div>
      </section>
    </div>, document.body)}
  </div>
}
