import { useEffect, useState } from 'react'
import { CalendarDays, ClipboardList, LogOut, WalletCards } from 'lucide-react'
import { TaskManagementPanel } from './TaskManagementPanel'
import { supabase } from '../lib/supabase'
import { loadPayrollProjectOptions, type PayrollProjectOption } from '../data/payroll'
import { PayrollPanel } from './PayrollPanel'

const roleLabels: Record<string, string> = {
  liaison_officer: 'Liaison officer',
  engineer: 'Engineer',
  architect: 'Architect',
}

export function StaffTaskApp({ userId, displayName, staffTitle }: {
  userId: string
  displayName: string
  staffTitle: string
}) {
  const name = displayName.trim() || 'Team member'
  const firstName = name.split(/\s+/)[0]
  const [today] = useState(() => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()))
  const canManagePayroll = staffTitle === 'liaison_officer'
  const [view, setView] = useState<'tasks' | 'payroll'>('tasks')
  const [payrollProjects, setPayrollProjects] = useState<PayrollProjectOption[]>([])
  const [payrollProjectsError, setPayrollProjectsError] = useState('')
  const [isLoadingPayrollAccess, setIsLoadingPayrollAccess] = useState(canManagePayroll)
  const [payrollAccessReloadKey, setPayrollAccessReloadKey] = useState(0)

  useEffect(() => {
    if (!canManagePayroll) return
    let active = true
    void loadPayrollProjectOptions()
      .then((projects) => {
        if (active) {
          setPayrollProjects(projects)
          setPayrollProjectsError('')
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Could not load payroll projects.'
        setPayrollProjectsError(message.includes('list_payroll_projects')
          && (message.includes('schema cache') || message.includes('Could not find the function'))
          ? 'Payroll access is not enabled in the database yet. Apply the liaison payroll access migration, then retry.'
          : message)
      })
      .finally(() => {
        if (active) setIsLoadingPayrollAccess(false)
      })
    return () => { active = false }
  }, [canManagePayroll, payrollAccessReloadKey])

  const retryPayrollAccess = () => {
    setPayrollProjectsError('')
    setIsLoadingPayrollAccess(true)
    setPayrollAccessReloadKey((key) => key + 1)
  }

  return <div className="app-shell staff-app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-mark"><img src="/sagact-mark.svg" alt="" /></span><span>SAGACT<span className="brand-period">.</span></span></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={`nav-item ${view === 'tasks' ? 'is-active' : ''}`} type="button" aria-current={view === 'tasks' ? 'page' : undefined} onClick={() => setView('tasks')}><ClipboardList size={17} /><span>My tasks</span></button>
        {canManagePayroll && <button className={`nav-item ${view === 'payroll' ? 'is-active' : ''}`} type="button" aria-current={view === 'payroll' ? 'page' : undefined} onClick={() => setView('payroll')}><WalletCards size={17} /><span>Payroll</span></button>}
      </nav>
      <div className="sidebar-bottom">
        <div className="workspace-state"><span className="live-dot" />Team workspace</div>
        <div className="owner-profile">
          <span className="owner-avatar">{firstName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{firstName}</strong><span>{roleLabels[staffTitle] ?? 'Staff'}</span></div>
          <button className="sign-out-button" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumbs"><span>SAGACT</span><span className="staff-breadcrumb-separator">›</span><strong>{view === 'payroll' ? 'Payroll' : 'My tasks'}</strong></div>
        <div className="topbar-right"><span className="topbar-date"><CalendarDays size={14} />{today}</span><button className="icon-button topbar-sign-out" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={16} /></button></div>
      </header>
      <main className="page-content">
        {view === 'payroll' && canManagePayroll
          ? <div className="payroll-page">
            {payrollProjectsError
              ? <p className="task-error" role="alert">{payrollProjectsError} <button type="button" className="text-button" onClick={retryPayrollAccess}>Retry</button></p>
              : isLoadingPayrollAccess
                ? <p className="payroll-empty" role="status">Checking payroll access…</p>
                : <PayrollPanel projects={payrollProjects} onChanged={() => undefined} />}
          </div>
          : <TaskManagementPanel isOwner={false} currentUserId={userId} />}
      </main>
      <footer className="page-footer" aria-hidden="true" />
    </div>
  </div>
}
