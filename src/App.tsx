import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BriefcaseBusiness, Camera, Download, Eye,
  CalendarDays, Check, ChevronRight, CircleAlert, CircleDollarSign, ClipboardList,
  FileText, House, LayoutDashboard, LogOut, Plus, RefreshCw, Settings2, Trash2, UserPlus, Users, WalletCards, X,
  UserRound,
} from 'lucide-react'
import { calculateProjectFinance } from './finance/project-finance'
import { calculateProfitRisk } from './finance/profit-risk'
import { getProjectDeadlineStatus } from './finance/project-deadline'
import { isRetentionDue } from './finance/retention-due'
import type { ReceivableAgingItem } from './finance/receivables-aging'
import { createProject as createProjectRecord, loadPortfolio, updateProjectSetup as saveProjectSetupRecord, updateProjectState, type PortfolioPayment, type PortfolioProject, type ProjectHealthStatus, type ProjectStatus } from './data/portfolio'
import { supabase } from './lib/supabase'
import { PaymentEntryDialog } from './components/PaymentEntryDialog'
import { BillingPanel } from './components/BillingPanel'
import { ExpensePanel } from './components/ExpensePanel'
import { ExpenseEntryDialog } from './components/ExpenseEntryDialog'
import { ProjectDocumentPanel } from './components/ProjectDocumentPanel'
import { InviteClientDialog } from './components/InviteClientDialog'
import { ProjectForecastPanel } from './components/ProjectForecastPanel'
import { ProjectMilestonePanel } from './components/ProjectMilestonePanel'
import { ProjectChangeOrderPanel } from './components/ProjectChangeOrderPanel'
import { createProjectCoverPhotoUrl, deleteProjectCoverPhoto, uploadProjectCoverPhoto } from './data/project-cover'
import { PayrollPanel } from './components/PayrollPanel'
import { TaskManagementPanel } from './components/TaskManagementPanel'
import { NotificationCenter } from './components/NotificationCenter'
import { MoneyInput } from './components/MoneyInput'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from './lib/payment-receipt-pdf'
import { PortfolioOverview } from './components/PortfolioOverview'
import { Metric } from './components/ProjectStatusBadges'
import { parseMoneyInput } from './lib/money-input'
import { useToast } from './components/toast-context'
import './App.css'

type Project = PortfolioProject
type Payment = PortfolioPayment
type WorkspaceView = 'portfolio' | 'portal' | 'payroll' | 'tasks'
type MobileNavigationPage = 'home' | 'projects' | 'updates' | 'profile'
type ProjectDetailTab = 'Overview' | 'Milestones' | 'Change orders' | 'Billings' | 'Payments' | 'Expenses' | 'Forecast' | 'Documents'
const projectDetailTabs: ProjectDetailTab[] = ['Overview', 'Milestones', 'Change orders', 'Billings', 'Payments', 'Expenses', 'Forecast', 'Documents']
const workspaceStateKey = 'sagact:workspace-navigation'

function readWorkspaceNavigation(): { view: WorkspaceView; selectedId: string | null; projectTab: ProjectDetailTab } {
  try {
    const stored = window.localStorage.getItem(workspaceStateKey)
    if (!stored) return { view: 'portfolio', selectedId: null, projectTab: 'Overview' }
    const state = JSON.parse(stored) as { view?: unknown; selectedId?: unknown; projectTab?: unknown }
    return {
      view: state.view === 'portal' ? 'portal' : state.view === 'payroll' ? 'payroll' : state.view === 'tasks' ? 'tasks' : 'portfolio',
      selectedId: typeof state.selectedId === 'string' ? state.selectedId : null,
      projectTab: projectDetailTabs.find((tab) => tab === state.projectTab) ?? 'Overview',
    }
  } catch {
    console.warn('Could not restore the saved workspace location; opening the portfolio instead.')
    return { view: 'portfolio', selectedId: null, projectTab: 'Overview' }
  }
}

const appLoadedAt = Date.now()
const appLoadedDate = new Date(appLoadedAt)
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const preciseMoney = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const projectStatusOptions: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
]
const shortDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
const projectDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
const financeForProject = (project: Project) => calculateProjectFinance({
  contractAmount: project.contract,
  specialDiscount: project.specialDiscount,
  approvedChangeOrders: project.approvedChangeOrders,
  progressPercent: project.progress,
  retentionRatePercent: project.retentionRate,
  retentionMethod: project.retentionMethod,
  billedToDate: project.billed,
  paymentsReceived: Math.max(0, project.collected - project.retentionPaid),
  retentionHeld: project.retention,
})
const todayLocal = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const retentionDueForProject = (project: Project) =>
  (project.status === 'completed' || project.status === 'closed')
    && isRetentionDue(project.completedAt, todayLocal())
    ? project.retention
    : 0

function App() {
  const { showToast } = useToast()
  const [initialNavigation] = useState(readWorkspaceNavigation)
  const [mobileNavigationPage, setMobileNavigationPage] = useState<MobileNavigationPage>(
    initialNavigation.view === 'tasks' ? 'updates' : initialNavigation.selectedId ? 'projects' : 'home',
  )
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [receivables, setReceivables] = useState<ReceivableAgingItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialNavigation.selectedId)
  const selectedIdRef = useRef(selectedId)
  const [view, setView] = useState<WorkspaceView>(initialNavigation.view)
  const [projectTab, setProjectTab] = useState<ProjectDetailTab>(initialNavigation.projectTab)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [healthFilter, setHealthFilter] = useState('All health')
  const [profitRiskFilter, setProfitRiskFilter] = useState('All profit risks')
  const [dateFilter, setDateFilter] = useState('Any time')
  const [showModal, setShowModal] = useState(false)
  const [showDashboardExpense, setShowDashboardExpense] = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [setupProject, setSetupProject] = useState<Project | null>(null)
  const [setupClient, setSetupClient] = useState('')
  const [setupContract, setSetupContract] = useState('')
  const [setupDiscount, setSetupDiscount] = useState('0')
  const [setupStartDate, setSetupStartDate] = useState('')
  const [setupDeadline, setSetupDeadline] = useState('')
  const [setupDownPayment, setSetupDownPayment] = useState('0')
  const [setupRetentionRate, setSetupRetentionRate] = useState('5')
  const [setupRetentionMethod, setSetupRetentionMethod] = useState<'final_schedule' | 'per_billing'>('final_schedule')
  const [setupError, setSetupError] = useState('')
  const [isSavingSetup, setIsSavingSetup] = useState(false)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [location, setLocation] = useState('')
  const [contract, setContract] = useState('')
  const [downPaymentPercent, setDownPaymentPercent] = useState('0')
  const [retentionRate, setRetentionRate] = useState('5')
  const [retentionMethod, setRetentionMethod] = useState<'final_schedule' | 'per_billing'>('final_schedule')
  const [formError, setFormError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [profileName, setProfileName] = useState('Project Manager')
  const [profileEmail, setProfileEmail] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const selected = projects.find((project) => project.id === selectedId)
  const clients = [...new Set(projects.map((project) => project.client))]
  const billed = projects.reduce((sum, project) => sum + project.billed, 0)
  const collected = projects.reduce((sum, project) => sum + project.collected, 0)
  const totalExpenses = projects.reduce((sum, project) => sum + project.outflow, 0)
  const receivable = projects.reduce((sum, project) => sum + financeForProject(project).receivablesDue + retentionDueForProject(project), 0)
  const retention = projects.reduce((sum, project) => sum + Math.max(0, project.retention - retentionDueForProject(project)), 0)
  const attentionCount = projects.filter((project) => project.healthStatus === 'needs_attention').length
  const currentDate = appLoadedDate
  const monthStart = Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const nextMonthStart = Date.UTC(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
  const monthPayments = payments.filter((payment) => {
    const receivedAt = Date.parse(payment.date)
    return receivedAt >= monthStart && receivedAt < nextMonthStart
  })
  const monthCashIn = monthPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const paymentBuckets = Array.from({ length: 12 }, (_, index) => {
    const firstDay = Math.floor(index * currentDate.getDate() / 12) + 1
    const nextDay = Math.floor((index + 1) * currentDate.getDate() / 12) + 1
    const start = Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), firstDay)
    const end = Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), nextDay)
    return monthPayments
      .filter((payment) => Date.parse(payment.date) >= start && Date.parse(payment.date) < end)
      .reduce((sum, payment) => sum + payment.amount, 0)
  })
  const maxPaymentBucket = Math.max(...paymentBuckets, 0)
  const cashBars = paymentBuckets.map((amount) => maxPaymentBucket > 0 ? Math.max(8, Math.round(amount / maxPaymentBucket * 100)) : 0)
  useEffect(() => {
    let active = true
    void loadPortfolio()
      .then((portfolio) => {
        if (!active) return
        setProjects(portfolio.projects)
        setPayments(portfolio.payments)
        setReceivables(portfolio.receivables)
        setLoadError('')
        const savedProjectId = selectedIdRef.current
        if (savedProjectId && !portfolio.projects.some((project) => project.id === savedProjectId)) {
          setSelectedId(null)
          setProjectTab('Overview')
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : 'Could not load the SAGACT workspace.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [reloadKey])
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    let active = true
    if (!supabase) return
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('Could not load the owner profile.', error)
        return
      }
      const user = data.user
      if (!user) return
      const metadataName = user.user_metadata.full_name
      const metadataFirstName = user.user_metadata.first_name
      const name = typeof metadataName === 'string' && metadataName.trim()
        ? metadataName.trim()
        : typeof metadataFirstName === 'string' && metadataFirstName.trim()
          ? metadataFirstName.trim()
          : user.email?.split('@')[0] ?? 'Project Manager'
      setProfileName(name)
      setProfileEmail(user.email ?? '')
    }).catch((error: unknown) => {
      if (active) console.error('Could not load the owner profile.', error)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem(workspaceStateKey, JSON.stringify({ view, selectedId, projectTab }))
    } catch {
      console.warn('Could not save the current workspace location.')
    }
  }, [view, selectedId, projectTab])
  const refreshWorkspace = (showLoading = true) => {
    setLoadError('')
    if (showLoading) setIsLoading(true)
    setReloadKey((key) => key + 1)
  }
  const updateProjectStateLocally = (projectId: string, status: ProjectStatus, healthStatus: ProjectHealthStatus) => {
    setProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, status, healthStatus }
      : project))
  }
  const saveProjectStateOptimistically = async (projectId: string, status: ProjectStatus, healthStatus: ProjectHealthStatus) => {
    const previousProject = projects.find((project) => project.id === projectId)
    if (!previousProject) throw new Error('Project is no longer available.')
    updateProjectStateLocally(projectId, status, healthStatus)
    try {
      await updateProjectState({ projectId, status, healthStatus })
      showToast('Project status updated.', 'update')
    } catch (error) {
      updateProjectStateLocally(projectId, previousProject.status, previousProject.healthStatus)
      throw error
    }
  }
  const filtered = projects.filter((project) => {
    const textMatch = `${project.name} ${project.client}`.toLowerCase().includes(search.toLowerCase())
    const statusMatch = statusFilter === 'All statuses' || project.status === statusFilter
    const healthMatch = healthFilter === 'All health' || project.healthStatus === healthFilter
    const finance = financeForProject(project)
    const profitRisk = calculateProfitRisk({
      contractValue: finance.contractValue,
      recordedCosts: project.outflow,
      costBudget: project.costBudget,
      estimatedCostToComplete: project.estimatedCostToComplete,
    })
    const profitRiskMatch = profitRiskFilter === 'All profit risks' || profitRisk.label === profitRiskFilter
    const updated = Date.parse(project.updatedAt)
    const updatedMonth = Number(project.updatedAt.slice(5, 7)) - 1
    const firstMonthOfQuarter = Math.floor(currentDate.getMonth() / 3) * 3
    const dateMatch = dateFilter === 'Any time' || (dateFilter === 'Last 30 days' && appLoadedAt - updated <= 30 * 86_400_000) || (dateFilter === 'This quarter' && updatedMonth >= firstMonthOfQuarter)
    return textMatch && statusMatch && healthMatch && profitRiskMatch && dateMatch
  })

  const openProject = (id: string) => { setMobileNavigationPage('projects'); setView('portfolio'); setProjectTab('Overview'); setSelectedId(id) }
  const openProjectSetup = (project: Project) => {
    setSetupProject(project)
    setSetupClient(project.client === 'Client not set' ? '' : project.client)
    setSetupContract(project.contract > 0 ? String(project.contract) : '')
    setSetupDiscount(String(project.specialDiscount))
    setSetupStartDate(project.startDate ?? project.createdAt.slice(0, 10))
    setSetupDeadline(project.deadline ?? '')
    setSetupDownPayment(String(project.downPaymentPercent))
    setSetupRetentionRate(String(project.retentionRate))
    setSetupRetentionMethod(project.retentionMethod === 'per-billing' ? 'per_billing' : 'final_schedule')
    setSetupError('')
    setShowSetupModal(true)
  }
  const saveProjectSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!setupProject) return
    const contractAmount = parseMoneyInput(setupContract)
    const specialDiscount = parseMoneyInput(setupDiscount)
    if (!Number.isFinite(contractAmount) || contractAmount <= 0) {
      setSetupError('Enter a contract amount greater than zero.')
      return
    }
    if (!Number.isFinite(specialDiscount) || specialDiscount < 0 || specialDiscount > contractAmount) {
      setSetupError('The special discount must be between zero and the contract amount.')
      return
    }
    if (setupDeadline && setupDeadline < setupStartDate) {
      setSetupError('The target date cannot be earlier than the project start date.')
      return
    }

    setSetupError('')
    setIsSavingSetup(true)
    try {
      await saveProjectSetupRecord({
        projectId: setupProject.id,
        clientName: setupClient.trim(),
        contractAmount,
        specialDiscount,
        startDate: setupStartDate,
        deadline: setupDeadline || null,
        downPaymentPercent: Number(setupDownPayment),
        retentionRatePercent: Number(setupRetentionRate),
        retentionMethod: setupRetentionMethod,
      })
      setShowSetupModal(false)
      showToast('Project contract details saved.', 'update')
      refreshWorkspace()
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Could not save project setup.')
    } finally {
      setIsSavingSetup(false)
    }
  }
  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (location.trim().length < 2) { setFormError('Enter the project location.'); return }
    const prefix = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    if (prefix.length < 3) { setFormError('The project name needs at least three letters for its receipt prefix.'); return }
    if (projects.some((project) => project.prefix === prefix)) { setFormError(`${prefix} is already in use. Receipt prefixes lock after the first number is issued.`); return }
    const amount = parseMoneyInput(contract)
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Enter a contract amount greater than zero.'); return }
    setFormError('')
    setIsCreatingProject(true)
    try {
      const projectId = await createProjectRecord({
        name: name.trim(),
        clientName: client.trim(),
        location: location.trim(),
        prefix,
        contractAmount: amount,
        downPaymentPercent: Number(downPaymentPercent),
        retentionRatePercent: Number(retentionRate),
        retentionMethod,
      })
      setSelectedId(projectId)
      setView('portfolio')
      setProjectTab('Overview')
      setShowModal(false)
      setName(''); setClient(''); setLocation(''); setContract(''); setDownPaymentPercent('0'); setRetentionRate('5'); setRetentionMethod('final_schedule')
      showToast('Project created.')
      refreshWorkspace()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the project.')
    } finally {
      setIsCreatingProject(false)
    }
  }


  return <div className={`app-shell${mobileNavigationPage === 'projects' ? ' is-mobile-projects-page' : ''}${mobileNavigationPage === 'profile' ? ' is-mobile-profile-page' : ''}${selected && view === 'portfolio' ? ' is-mobile-project-detail' : ''}`} aria-busy={isLoading}>
    {showSetupModal && setupProject && <ProjectSetupDialog project={setupProject} client={setupClient} setClient={setSetupClient} contract={setupContract} setContract={setSetupContract} discount={setupDiscount} setDiscount={setSetupDiscount} startDate={setupStartDate} setStartDate={setSetupStartDate} deadline={setupDeadline} setDeadline={setSetupDeadline} downPayment={setupDownPayment} setDownPayment={setSetupDownPayment} retentionRate={setupRetentionRate} setRetentionRate={setSetupRetentionRate} retentionMethod={setupRetentionMethod} setRetentionMethod={setSetupRetentionMethod} error={setupError} saving={isSavingSetup} onSubmit={saveProjectSetup} onClose={() => setShowSetupModal(false)} />}
    {showDashboardExpense && <ExpenseEntryDialog projects={projects.map((project) => ({ id: project.id, name: project.name }))} onClose={() => setShowDashboardExpense(false)} onSaved={() => { setShowDashboardExpense(false); refreshWorkspace(false) }} />}
    {isLoading && <div className="workspace-loading" role="status" aria-live="polite" aria-label="Loading SAGACT workspace"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><RefreshCw size={25} /></span><strong>Loading your workspace</strong><span className="loading-caption">Preparing your project overview</span><span className="loading-progress"><span /></span></div>}
    <aside className="sidebar">
      <div className="mobile-project-detail-header">
        <button type="button" onClick={() => { setSelectedId(null); setProjectTab('Overview') }} aria-label="Back to projects"><ArrowLeft size={19} /></button>
        <strong>Project Details</strong>
        <div className="mobile-owner-header-actions"><NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} /></div>
      </div>
      <div className="brand-lockup"><span className="brand-mark"><img src="/sagact-mark.svg" alt="" /></span><span>SAGACT<span className="brand-period">.</span></span></div>
      <div className="mobile-owner-header-actions">
        <NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} />
      </div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={`nav-item ${view === 'portfolio' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('portfolio'); setSelectedId(null); setProjectTab('Overview') }}><LayoutDashboard size={17} /><span>Portfolio</span></button>
        <button className={`nav-item ${view === 'tasks' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('updates'); setView('tasks'); setSelectedId(null); setProjectTab('Overview') }}><ClipboardList size={17} /><span>Tasks</span></button>
        <button className={`nav-item ${view === 'payroll' ? 'is-active' : ''}`} onClick={() => { setView('payroll'); setSelectedId(null); setProjectTab('Overview') }}><WalletCards size={17} /><span>Payroll</span></button>
        <button className={`nav-item ${view === 'portal' ? 'is-active' : ''}`} onClick={() => { setView('portal'); setSelectedId(null); setProjectTab('Overview') }}><Users size={17} /><span>Client portal</span></button>
      </nav>
    </aside>
    <nav className="mobile-bottom-nav" aria-label="Mobile quick navigation">
      <button type="button" className={mobileNavigationPage === 'home' ? 'is-active' : ''} aria-current={mobileNavigationPage === 'home' ? 'page' : undefined} onClick={() => { setMobileNavigationPage('home'); setView('portfolio'); setSelectedId(null); setProjectTab('Overview'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
        {mobileNavigationPage === 'home'
          ? <svg className="mobile-home-filled-icon" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>
          : <House size={17} />}
        <span>Home</span>
      </button>
      <button type="button" className={mobileNavigationPage === 'projects' ? 'is-active' : ''} aria-current={mobileNavigationPage === 'projects' ? 'page' : undefined} onClick={() => {
        setMobileNavigationPage('projects')
        setView('portfolio')
        setSelectedId(null)
        setProjectTab('Overview')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }}>
        {mobileNavigationPage === 'projects'
          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h6a2 2 0 0 1 2 2v2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2Zm-2 4h10V5H9v2Zm-3 5v7h16v-7h-5v2h-6v-2H4Zm7 0v1h2v-1h-2Z" /></svg>
          : <BriefcaseBusiness size={17} />}
        <span>Projects</span>
      </button>
      <button
        type="button"
        className={mobileNavigationPage === 'profile' ? 'is-active' : ''}
        aria-current={mobileNavigationPage === 'profile' ? 'page' : undefined}
        onClick={() => {
          setMobileNavigationPage('profile')
          setView('portfolio')
          setSelectedId(null)
          setProjectTab('Overview')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
        {mobileNavigationPage === 'profile'
          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5.1 0-9 2.7-9 6v2h18v-2c0-3.3-3.9-6-9-6Z" /></svg>
          : <UserRound size={17} />}
        <span>Profile</span>
      </button>
    </nav>

    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumbs"><span>SAGACT</span><ChevronRight size={13} /><strong>{view === 'portal' ? 'Client portal' : view === 'payroll' ? 'Payroll' : view === 'tasks' ? 'Tasks' : selected?.name ?? 'Portfolio'}</strong></div>
        <div className="topbar-right"><span className="topbar-date"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(currentDate)}</span><button className={`icon-button refresh-button ${isLoading ? 'is-loading' : ''}`} aria-label={isLoading ? 'Refreshing workspace' : 'Refresh workspace'} title={isLoading ? 'Refreshing workspace' : 'Workspace ready'} onClick={() => refreshWorkspace()} disabled={isLoading}><RefreshCw className="refresh-glyph" size={16} /><span className="sr-only" role="status" aria-live="polite">{isLoading ? 'Refreshing workspace' : 'Workspace ready'}</span></button><NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} /><button className="icon-button topbar-sign-out" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={16} /></button></div>
      </header>

      <main className="page-content">
        <div key={`${view}:${selectedId ?? 'portfolio'}`} className="view-transition">
        {mobileNavigationPage === 'profile' ? <MobileOwnerProfile name={profileName} email={profileEmail} onSignOut={() => { void supabase?.auth.signOut() }} /> : view === 'portal' ? <ClientPortal projects={projects} onOpenProject={openProject} /> : view === 'payroll' ? <PayrollPanel projects={projects} onChanged={() => refreshWorkspace(false)} /> : view === 'tasks' ? <TaskManagementPanel isOwner currentUserId="" projects={projects.map((project) => ({ id: project.id, name: project.name }))} /> : selected ? <ProjectDetail project={selected} tab={projectTab} setTab={setProjectTab} payments={payments.filter((payment) => payment.projectId === selected.id)} onBack={() => { setSelectedId(null); setProjectTab('Overview') }} onSetup={() => openProjectSetup(selected)} onChanged={() => refreshWorkspace(false)} onProjectStateChange={saveProjectStateOptimistically} /> : <PortfolioOverview projects={projects} payments={payments} receivables={receivables} filtered={filtered} currentDate={currentDate} loadError={loadError} attentionCount={attentionCount} billed={billed} collected={collected} totalExpenses={totalExpenses} receivable={receivable} retention={retention} search={search} statusFilter={statusFilter} healthFilter={healthFilter} profitRiskFilter={profitRiskFilter} dateFilter={dateFilter} monthCashIn={monthCashIn} cashBars={cashBars} isLoading={isLoading} setSearch={setSearch} setStatusFilter={setStatusFilter} setHealthFilter={setHealthFilter} setProfitRiskFilter={setProfitRiskFilter} setDateFilter={setDateFilter} setShowDashboardExpense={setShowDashboardExpense} setShowModal={setShowModal} onViewTasks={() => { setMobileNavigationPage('updates'); setView('tasks'); setSelectedId(null); setProjectTab('Overview') }} onUploadUpdate={(projectId) => { setMobileNavigationPage('projects'); setSelectedId(projectId); setView('portfolio'); setProjectTab('Milestones') }} isProjectsPage={mobileNavigationPage === 'projects'} refreshWorkspace={refreshWorkspace} openProject={openProject} />}
        </div>
      </main>
      <footer className="page-footer" aria-hidden="true" />
    </div>

    {showModal && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowModal(false) }}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div className="modal-heading"><div><h2 id="new-project-title">Create a project</h2></div><button className="icon-button" onClick={() => setShowModal(false)} aria-label="Close"><X size={18} /></button></div><form onSubmit={createProject}><label className="form-field">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Salo Spot" required /></label><label className="form-field">Client<input list="known-clients" value={client} onChange={(event) => setClient(event.target.value)} placeholder="Choose or add a client" required /><datalist id="known-clients">{clients.map((item) => <option key={item} value={item} />)}</datalist></label><label className="form-field">Project location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or project address" maxLength={200} minLength={2} required /></label><div className="form-row"><label className="form-field">Contract amount<MoneyInput min="1" step="1" value={contract} onChange={setContract} placeholder="0" required /></label><label className="form-field">Down payment %<input type="number" min="0" max="100" step="0.5" value={downPaymentPercent} onChange={(event) => setDownPaymentPercent(event.target.value)} required /></label></div><div className="form-row"><label className="form-field">Retention rate<select value={retentionRate} onChange={(event) => setRetentionRate(event.target.value as '5' | '10')}><option value="5">5% default</option><option value="10">10% client request</option></select></label><label className="form-field">Retention method<select value={retentionMethod} onChange={(event) => setRetentionMethod(event.target.value as 'final_schedule' | 'per_billing')}><option value="final_schedule">Final payment schedule</option><option value="per_billing">Deduct from each billing</option></select></label></div>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={isCreatingProject}><Plus size={15} />{isCreatingProject ? 'Saving…' : 'Create project'}</button></div></form></section></div>, document.body)}
  </div>
}

type ProjectSetupDialogProps = {
  project: Project
  client: string
  setClient: (value: string) => void
  contract: string
  setContract: (value: string) => void
  discount: string
  setDiscount: (value: string) => void
  startDate: string
  setStartDate: (value: string) => void
  deadline: string
  setDeadline: (value: string) => void
  downPayment: string
  setDownPayment: (value: string) => void
  retentionRate: string
  setRetentionRate: (value: string) => void
  retentionMethod: 'final_schedule' | 'per_billing'
  setRetentionMethod: (value: 'final_schedule' | 'per_billing') => void
  error: string
  saving: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

function ProjectSetupDialog({ project, client, setClient, contract, setContract, discount, setDiscount, startDate, setStartDate, deadline, setDeadline, downPayment, setDownPayment, retentionRate, setRetentionRate, retentionMethod, setRetentionMethod, error, saving, onSubmit, onClose }: ProjectSetupDialogProps) {
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="setup-project-title"><div className="modal-heading"><div><div className="section-kicker">Project financial setup</div><h2 id="setup-project-title">{project.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button></div><p className="modal-intro">Edit confirmed client, contract, and project schedule details.</p><form onSubmit={onSubmit}><label className="form-field">Client name<input autoFocus value={client} onChange={(event) => setClient(event.target.value)} placeholder="Enter the actual client name" minLength={2} required /></label><div className="form-row"><label className="form-field">Contract amount<MoneyInput min="0.01" step="0.01" value={contract} onChange={setContract} placeholder="0.00" required /></label><label className="form-field">Special discount<MoneyInput min="0" step="0.01" value={discount} onChange={setDiscount} required /></label></div><div className="form-row"><label className="form-field">Project start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label className="form-field">Target date<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label></div><div className="form-row"><label className="form-field">Down payment %<input type="number" min="0" max="100" step="0.5" value={downPayment} onChange={(event) => setDownPayment(event.target.value)} required /></label><label className="form-field">Retention rate<select value={retentionRate} onChange={(event) => setRetentionRate(event.target.value)}><option value="5">5% default</option><option value="10">10% client request</option></select></label></div><label className="form-field">Retention method<select value={retentionMethod} onChange={(event) => setRetentionMethod(event.target.value as 'final_schedule' | 'per_billing')}><option value="final_schedule">Final payment schedule</option><option value="per_billing">Deduct from each billing</option></select></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}><FileText size={15} />{saving ? 'Saving…' : 'Save contract setup'}</button></div></form></section></div>, document.body)
}

function ProjectDetailCover({ projectId, projectName, storagePath, onChanged }: { projectId: string; projectName: string; storagePath: string | null; onChanged: () => void }) {
  const { showToast } = useToast()
  const [loadedPhoto, setLoadedPhoto] = useState<{ storagePath: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoUrl = loadedPhoto?.storagePath === storagePath ? loadedPhoto.url : ''

  useEffect(() => {
    let active = true
    if (storagePath) {
      void createProjectCoverPhotoUrl(storagePath)
        .then((url) => { if (active) setLoadedPhoto({ storagePath, url }) })
        .catch((photoLoadError: unknown) => {
          console.error('Could not load the project cover photo.', photoLoadError)
          if (active) setError(photoLoadError instanceof Error ? photoLoadError.message : 'Could not load the project cover photo.')
        })
    }
    return () => { active = false }
  }, [storagePath])

  const uploadCover = async (file: File) => {
    setError('')
    setIsWorking(true)
    try {
      const newPath = await uploadProjectCoverPhoto(projectId, file, storagePath)
      setLoadedPhoto({ storagePath: newPath, url: await createProjectCoverPhotoUrl(newPath) })
      showToast('Project cover photo updated.')
      onChanged()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not update the project cover photo.')
    } finally {
      if (photoInput.current) photoInput.current.value = ''
      setIsWorking(false)
    }
  }

  const removeCover = async () => {
    if (!storagePath || isWorking) return
    setError('')
    setIsWorking(true)
    try {
      await deleteProjectCoverPhoto(projectId, storagePath)
      setLoadedPhoto(null)
      showToast('Project cover photo removed.')
      onChanged()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the project cover photo.')
    } finally {
      setIsWorking(false)
    }
  }

  return <div className={`project-detail-cover${photoUrl ? ' has-photo' : ''}`}>
    {photoUrl
      ? <img src={photoUrl} alt={`${projectName} project cover`} />
      : <div className="project-detail-cover-empty"><Camera size={24} /><strong>Add a project photo</strong><span>JPG, PNG, or WebP · Up to 10 MB</span></div>}
    <label className="project-detail-cover-upload">
      <Camera size={14} />{isWorking ? 'Saving…' : storagePath ? 'Change photo' : 'Upload photo'}
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Upload cover photo for ${projectName}`} disabled={isWorking} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file) void uploadCover(file)
      }} />
    </label>
    {storagePath && <button type="button" className="project-detail-cover-remove" aria-label="Remove project cover photo" title="Remove project cover photo" disabled={isWorking} onClick={() => { void removeCover() }}><Trash2 size={14} /></button>}
    {error && <p className="project-detail-cover-error" role="alert">{error}</p>}
  </div>
}

function ProjectDetail({ project, tab, setTab, payments, onBack, onSetup, onChanged, onProjectStateChange }: { project: Project; tab: ProjectDetailTab; setTab: (tab: ProjectDetailTab) => void; payments: Payment[]; onBack: () => void; onSetup: () => void; onChanged: () => void; onProjectStateChange: (projectId: string, status: ProjectStatus, healthStatus: ProjectHealthStatus) => Promise<void> }) {
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [showInviteClient, setShowInviteClient] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [projectStateError, setProjectStateError] = useState('')
  const [isSavingProjectState, setIsSavingProjectState] = useState(false)
  const projectPayments = payments.filter((payment) => payment.contractId === null)
  const projectExpenses = project.expenses.filter((expense) => expense.contractId === null)
  const finance = financeForProject(project)
  const originalFinance = calculateProjectFinance({
    contractAmount: project.contract,
    specialDiscount: project.specialDiscount,
    progressPercent: project.progress,
    retentionRatePercent: project.retentionRate,
    retentionMethod: project.retentionMethod,
    billedToDate: project.billed,
    paymentsReceived: project.collected,
    retentionHeld: project.retention,
  })
  const profitRisk = calculateProfitRisk({
    contractValue: finance.contractValue,
    recordedCosts: project.outflow,
    costBudget: project.costBudget,
    estimatedCostToComplete: project.estimatedCostToComplete,
  })
  const retentionDue = retentionDueForProject(project)
  const retentionHeld = Math.max(0, project.retention - retentionDue)
  const due = finance.receivablesDue + retentionDue
  const deadlineStatus = getProjectDeadlineStatus(project.deadline, project.status)
  const deadlineBadgeText = deadlineStatus.daysRemaining !== null && project.deadline
    ? `${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${project.deadline}T12:00:00`))} · ${Math.abs(deadlineStatus.daysRemaining)} day${Math.abs(deadlineStatus.daysRemaining) === 1 ? '' : 's'} ${deadlineStatus.daysRemaining < 0 ? 'overdue' : 'left'}`
    : deadlineStatus.label
  const saveProjectState = async (status: ProjectStatus, healthStatus: ProjectHealthStatus) => {
    if (isSavingProjectState) return
    setIsSavingProjectState(true)
    setProjectStateError('')
    try {
      await onProjectStateChange(project.id, status, healthStatus)
    } catch (error) {
      setProjectStateError(error instanceof Error ? error.message : 'Could not update project status.')
    } finally {
      setIsSavingProjectState(false)
    }
  }
  const receiptDetails = (payment: Payment) => ({
    projectName: project.name,
    payerName: payment.payer,
    receiptNumber: payment.receiptNumber ?? '',
    amount: payment.amount,
    receivedDate: payment.date,
    paymentType: payment.paymentType,
    paymentMode: payment.paymentMode,
    reference: payment.paymentReference,
  })
  const viewAcknowledgementReceipt = async (payment: Payment) => {
    setReceiptError('')
    try {
      await openPaymentReceiptPdf(receiptDetails(payment))
    } catch {
      setReceiptError('Could not preview the acknowledgement receipt.')
    }
  }
  const downloadAcknowledgementReceipt = async (payment: Payment) => {
    setReceiptError('')
    try {
      await downloadPaymentReceiptPdf(receiptDetails(payment))
    } catch {
      setReceiptError('Could not download the acknowledgement receipt.')
    }
  }
  return <div className="detail-page">{showInviteClient && project.clientId && <InviteClientDialog projectId={project.id} projectName={project.name} clientName={project.client} clientEmail={project.clientEmail} onClose={() => setShowInviteClient(false)} />}<section className="detail-heading">
    <div className="detail-heading-top">
      <button type="button" className="detail-breadcrumb" onClick={onBack} aria-label="Back to portfolio"><ArrowLeft size={16} aria-hidden="true" /><span className="detail-back-label">Back to portfolio</span></button>
      <strong className="detail-mobile-title">Project Details</strong>
    </div>
    <div className="project-detail-hero">
      <ProjectDetailCover projectId={project.id} storagePath={project.coverPhotoStoragePath} projectName={project.name} onChanged={onChanged} />
      <div className="project-detail-hero-body">
        <div className="project-detail-title-row">
          <div><h1>{project.name}</h1><p><span>{project.location}</span>{project.location && project.client ? <span aria-hidden="true"> · </span> : null}<span>{project.client}</span></p></div>
        </div>
        <div className="project-detail-summary-row">
          <label className={`project-state-control project-state-pill state-${project.status.replaceAll('_', '-')}`}><span className="sr-only">Project status</span><span className="project-state-dot" aria-hidden="true" /><span className="project-state-value">{projectStatusOptions.find((option) => option.value === project.status)?.label ?? 'Planning'}</span><select aria-label="Project status" value={project.status} onChange={(event) => { void saveProjectState(event.target.value as ProjectStatus, project.healthStatus) }}>{projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className={`project-state-control project-state-pill health-${project.healthStatus.replaceAll('_', '-')}`}><span className="sr-only">Project health</span><span className="project-state-dot" aria-hidden="true" /><span className="project-state-value">{project.healthStatus === 'needs_attention' ? 'Needs attention' : 'On track'}</span><select aria-label="Project health" value={project.healthStatus} onChange={(event) => { void saveProjectState(project.status, event.target.value as ProjectHealthStatus) }}><option value="on_track">On track</option><option value="needs_attention">Needs attention</option></select></label>
          <span className={`project-deadline-status deadline-${deadlineStatus.level}`} title={deadlineStatus.detail}>{deadlineBadgeText}</span>
        </div>
        <div className="project-detail-progress">
          <div><span>Project progress</span><strong>{project.progress}%</strong></div>
          <div className="project-detail-progress-track"><span style={{ width: `${project.progress}%` }} /></div>
        </div>
        <div className="project-detail-dates">
          <span><CalendarDays size={13} /><span><small>Started</small><strong>{projectDate(project.startDate ?? project.createdAt)}</strong></span></span>
          <span><CalendarDays size={13} /><span><small>Target date</small><strong>{project.deadline ? projectDate(project.deadline) : 'Not set'}</strong></span></span>
        </div>
        <div className="detail-actions">{project.clientId && <button className="button button-secondary" onClick={() => setShowInviteClient(true)}><UserPlus size={15} />Invite client</button>}{project.isSetupComplete ? <button className="button button-secondary" onClick={onSetup}><FileText size={15} />Edit contract</button> : <button className="button button-primary" onClick={onSetup}><FileText size={15} />Set up contract</button>}</div>
      </div>
    </div>
  </section>
    {projectStateError && <p className="form-error" role="alert">{projectStateError}</p>}
    <div className="detail-tabs" role="tablist" aria-label="Project sections">{projectDetailTabs.map((item) => <button key={item} className={tab === item ? 'tab is-selected' : 'tab'} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}</div>
    <div key={tab} className="detail-tab-transition">
    {(profitRisk.level === 'high' || profitRisk.level === 'critical') && <div className={`project-risk-callout risk-${profitRisk.level}`} role="status"><CircleAlert size={17} /><span><strong>Profit risk: {profitRisk.label}.</strong> {profitRisk.detail}.</span><button type="button" onClick={() => setTab('Forecast')}>Review forecast <ArrowRight size={14} /></button></div>}
    {tab === 'Overview' && <>
      <section className="surface-card detail-progress-card"><div className="card-heading-row"><h2>Project health</h2><span className="large-progress">{project.progress}<small>%</small></span></div><div className="detail-progress-track"><span style={{ width: `${project.progress}%` }} /></div><div className="progress-caption"><span>Work accomplished</span><strong>{money.format(finance.earnedToDate)} earned</strong></div><div className="milestone-callout"><span className="milestone-icon"><CalendarDays size={16} /></span><span><small>Next milestone</small><strong>{project.milestone}</strong></span><ChevronRight size={16} /></div></section>
      <section className="detail-financial-section" aria-labelledby="detail-financial-heading">
        <div className="detail-financial-heading"><h2 id="detail-financial-heading">Financial overview</h2></div>
        <div className="detail-financial-content">
          <div className="detail-metrics detail-financial-metrics">
            <Metric icon={<BriefcaseBusiness size={16} />} label="Contract value" value={money.format(finance.contractValue)} foot={`${project.downPaymentPercent}% down payment · ${project.retentionRate}% retention`} tone="neutral" />
            <Metric icon={<FileText size={16} />} label="Billed to date" value={money.format(project.billed)} foot={`${finance.contractValue ? Math.round(project.billed / finance.contractValue * 100) : 0}% of contract incl. down payment`} tone="blue" />
            <Metric icon={<CircleDollarSign size={16} />} label="Collected" value={money.format(project.collected)} foot={`${preciseMoney.format(due)} receivable`} tone="green" />
            <Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retentionHeld)} foot="Release conditions pending" tone="neutral" />
          </div>
          <div className="detail-financial-risk">
            <Metric icon={<CircleAlert size={16} />} label="Profit risk" value={profitRisk.label} foot={profitRisk.detail} tone="red" />
          </div>
        </div>
      </section>
      <div className="detail-content-grid detail-supporting-grid">
        <section className="surface-card receivable-card"><h2>Balance to follow up</h2><div className={`receivable-status ${due <= 0 ? 'is-settled' : 'has-balance'}`} role="status">{due <= 0 ? <Check size={15} /> : <CircleAlert size={15} />}<span>{due <= 0 ? 'Fully settled' : `${preciseMoney.format(due)} outstanding`}</span></div><div className="receivable-divider" /><div className="receivable-line"><span><span className="small-status-dot overdue-dot" />Billing receivable</span><strong>{money.format(finance.receivablesDue)}</strong></div><div className="receivable-line"><span><span className="small-status-dot retention-dot" />Retention release due</span><strong>{money.format(retentionDue)}</strong></div><small className="retention-explainer">Retention becomes receivable one month after project completion.</small></section>
        <section className="surface-card detail-activity-card"><div className="card-heading-row"><div><h2>Payments received</h2></div><button className="text-button compact-button" onClick={() => setTab('Payments')}>All payments <ArrowRight size={13} /></button></div>{projectPayments.length ? <div className="detail-recent-payments-list">{projectPayments.map((payment) => <div className="payment-detail-row" key={payment.id}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span><strong className="activity-amount">{money.format(payment.amount)}</strong></div>)}</div> : <div className="empty-state">No payments recorded yet.</div>}</section>
      </div>
    </>}
    {tab === 'Billings' && <BillingPanel projectId={project.id} projectName={project.name} clientName={project.client} location={project.location} progress={project.progress} earned={originalFinance.earnedToDate} ceiling={originalFinance.billableCeiling} isSetupComplete={project.isSetupComplete} onChanged={onChanged} />}
    {tab === 'Milestones' && <ProjectMilestonePanel projectId={project.id} milestones={project.milestones} onChanged={onChanged} />}
    {tab === 'Change orders' && <ProjectChangeOrderPanel projectId={project.id} projectPrefix={project.prefix} projectName={project.name} clientName={project.client} location={project.location} contractAmount={project.contract} specialDiscount={project.specialDiscount} retentionRatePercent={project.retentionRate} changeOrders={project.changeOrders} payments={payments} expenses={project.expenses} onChanged={onChanged} />}
    {tab === 'Payments' && <section className="surface-card tab-content payment-register-card">
      <div className="card-heading-row"><h2>Received payments</h2><button className="button button-primary" onClick={() => setShowPaymentDialog(true)}><Plus size={15} />Log payment</button></div>
      {showPaymentDialog && <PaymentEntryDialog project={project} onClose={() => setShowPaymentDialog(false)} onSaved={onChanged} />}
      {receiptError && <p className="form-error" role="alert">{receiptError}</p>}
      {projectPayments.length ? <div className="payment-register-list">{projectPayments.map((payment) => <div className="payment-detail-row" key={payment.id}>
        <span className="activity-icon"><ArrowDownLeft size={15} /></span>
        <span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span>
        <strong className="activity-amount">{money.format(payment.amount)}</strong>
        {payment.receiptNumber && <button type="button" className="text-button compact-button" aria-label={`View acknowledgement receipt ${payment.receiptNumber}`} title="View acknowledgement receipt" onClick={() => { void viewAcknowledgementReceipt(payment) }}><Eye size={14} />View</button>}
        {payment.receiptNumber && <button type="button" className="text-button compact-button" aria-label={`Download acknowledgement receipt ${payment.receiptNumber}`} title="Download acknowledgement receipt" onClick={() => { void downloadAcknowledgementReceipt(payment) }}><Download size={14} /></button>}
      </div>)}</div> : <div className="empty-state">No payments recorded for this project.</div>}
    </section>}
    {tab === 'Expenses' && <ExpensePanel projectId={project.id} projectName={project.name} expenses={projectExpenses} inflow={projectPayments.reduce((total, payment) => total + payment.amount, 0)} onChanged={onChanged} />}
    {tab === 'Forecast' && <ProjectForecastPanel projectId={project.id} contractValue={finance.contractValue} recordedCosts={project.outflow} costBudget={project.costBudget} estimatedCostToComplete={project.estimatedCostToComplete} onChanged={onChanged} />}
    {tab === 'Documents' && <ProjectDocumentPanel projectId={project.id} />}
    </div>
  </div>
}

function ClientPortal({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (id: string) => void }) {
  const project = projects[0]
  return <div className="portal-preview"><div className="eyebrow"><span className="eyebrow-rule" />Client access <span className="eyebrow-date">Preview</span></div><section className="portal-header"><div><h1>Client portal</h1><p>A client-safe view of project progress and shared documents.</p></div><span className="portal-preview-pill"><Users size={14} />Preview mode</span></section><div className="sample-banner"><CircleAlert size={15} /><span>This is a visual preview only. Client sign-in and database access rules are not connected.</span></div><div className="portal-project-grid">{projects.map((item) => <button key={item.id} className="portal-project surface-card" onClick={() => onOpenProject(item.id)}><div className="portal-project-top"><span className={`detail-avatar avatar-${item.prefix.toLowerCase()}`}>{item.name.slice(0, 1)}</span><ChevronRight size={16} /></div><div className="section-kicker">{item.client}</div><h2>{item.name}</h2><div className="portal-progress-label"><span>Progress</span><strong>{item.progress}%</strong></div><div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div><div className="portal-milestone"><CalendarDays size={14} />{item.milestone}</div></button>)}</div><section className="surface-card portal-statement"><div className="card-heading-row"><div><div className="section-kicker">Client statement preview</div><h2>{project?.name} · Billing summary</h2></div><FileText size={18} /></div><div className="portal-statement-lines"><div><span>Billings to date</span><strong>{money.format(project?.billed ?? 0)}</strong></div><div><span>Payments received</span><strong className="collected-text">− {money.format(project?.collected ?? 0)}</strong></div><div><span>Balance due</span><strong>{money.format(project ? financeForProject(project).receivablesDue : 0)}</strong></div><div className="statement-retention"><span>Retention held (not yet due)</span><strong>{money.format(project?.retention ?? 0)}</strong></div></div></section></div>
}

function MobileOwnerProfile({ name, email, onSignOut }: { name: string; email: string; onSignOut: () => void }) {
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [passwordUpdated, setPasswordUpdated] = useState(false)

  const closeAccountSettings = () => {
    if (isUpdatingPassword) return
    setIsAccountSettingsOpen(false)
    setPassword('')
    setPasswordConfirmation('')
    setPasswordError('')
    setPasswordUpdated(false)
  }

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) {
      setPasswordError('Password updates are unavailable because authentication is not configured.')
      return
    }
    if (password.length < 8) {
      setPasswordError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== passwordConfirmation) {
      setPasswordError('The passwords do not match.')
      return
    }

    setPasswordError('')
    setIsUpdatingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPasswordUpdated(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
      setPasswordError(`Could not update your password: ${message}`)
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return <section className="mobile-owner-profile-page" aria-labelledby="mobile-profile-title">
    {isAccountSettingsOpen && createPortal(<div className="modal-backdrop mobile-password-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAccountSettings() }}>
      <section className="project-modal mobile-password-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
        <div className="modal-heading">
          <div><h2 id="account-settings-title">Account Settings</h2></div>
          <button className="icon-button" type="button" onClick={closeAccountSettings} aria-label="Close" disabled={isUpdatingPassword}><X size={18} /></button>
        </div>
        {passwordUpdated
          ? <div className="mobile-password-success" role="status">
            <p>Your password has been updated.</p>
            <div className="modal-actions"><button type="button" className="button button-primary" onClick={closeAccountSettings}>Done</button></div>
          </div>
          : <>
            <p className="modal-intro">Choose a new password for your account. Use at least 8 characters.</p>
            <form onSubmit={(event) => { void updatePassword(event) }}>
              <label className="form-field">New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <label className="form-field">Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
              {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={closeAccountSettings} disabled={isUpdatingPassword}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={isUpdatingPassword}>{isUpdatingPassword ? 'Updating…' : 'Update password'}</button>
              </div>
            </form>
          </>}
      </section>
    </div>, document.body)}
    <header className="mobile-profile-heading">
      <h1 id="mobile-profile-title">Profile</h1>
    </header>
    <section className="mobile-profile-identity surface-card" aria-label="Account identity">
      <span className="mobile-profile-identity-copy">
        <strong>{name}</strong>
        <span>Project Manager</span>
        {email && <small>{email}</small>}
      </span>
    </section>
    <section className="mobile-profile-settings surface-card" aria-label="Profile settings" role="list">
      <button className="mobile-profile-setting-row" type="button" onClick={() => setIsAccountSettingsOpen(true)} role="listitem">
        <span className="mobile-profile-setting-icon" aria-hidden="true"><Settings2 size={17} /></span>
        <span>Account Settings</span>
        <ChevronRight className="mobile-profile-setting-chevron" size={16} aria-hidden="true" />
      </button>
    </section>
    <button type="button" className="mobile-profile-sign-out" onClick={onSignOut}>
      <LogOut size={17} aria-hidden="true" />
      <span>Log Out</span>
    </button>
  </section>
}

export default App
