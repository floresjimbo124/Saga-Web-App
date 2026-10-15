import { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, BriefcaseBusiness, CalendarDays, ChevronRight, ClipboardList, House, LayoutDashboard, Plus, RefreshCw, WalletCards, X, History, Receipt, UserRound } from 'lucide-react'
import { calculateProfitRisk } from './finance/profit-risk'
import { type ReceivableAgingItem } from './finance/receivables-aging'
import { createProject as createProjectRecord, loadPortfolio, updateProjectCostForecast, updateProjectSetup as saveProjectSetupRecord, updateProjectState, type PortfolioBillingEvent, type ProjectHealthStatus, type ProjectStatus } from './data/portfolio'
import { supabase } from './lib/supabase'
import { QuickExpenseSheet } from './components/QuickExpenseSheet'
import { AccountMenu } from './components/AccountMenu'
import { loadProjectTasks } from './data/tasks'
import { SkeletonRows } from './components/Motion'
import { NotificationCenter } from './components/NotificationCenter'
import { MoneyInput } from './components/MoneyInput'
import { PortfolioOverview } from './components/PortfolioOverview'
import { parseMoneyInput } from './lib/money-input'
import { useToast } from './components/toast-context'
import { workspaceNavigationStorageKey } from './auth/workspace-navigation'
import { ProjectSetupDialog } from './app/ProjectSetupDialog'
import { ProjectDetail } from './app/ProjectDetail'
import { MobileOwnerProfile } from './app/OwnerProfile'
import { projectDetailTabs, setupMoney, financeForProject, retentionDueForProject, type Project, type Payment, type ProjectDetailTab } from './app/project-shared'
import './App.css'

const AllExpensesPanel = lazy(() => import('./components/AllExpensesPanel').then((module) => ({ default: module.AllExpensesPanel })))
const PayrollPanel = lazy(() => import('./components/PayrollPanel').then((module) => ({ default: module.PayrollPanel })))
const TaskManagementPanel = lazy(() => import('./components/TaskManagementPanel').then((module) => ({ default: module.TaskManagementPanel })))
const ActivityPanel = lazy(() => import('./components/ActivityPanel').then((module) => ({ default: module.ActivityPanel })))



type WorkspaceView = 'portfolio' | 'payroll' | 'tasks' | 'expenses' | 'activity'
type MobileNavigationPage = 'home' | 'projects' | 'updates' | 'profile'
function readWorkspaceNavigation(): { view: WorkspaceView; selectedId: string | null; projectTab: ProjectDetailTab } {
  try {
    const stored = window.sessionStorage.getItem(workspaceNavigationStorageKey)
    if (!stored) return { view: 'portfolio', selectedId: null, projectTab: 'Overview' }
    const state = JSON.parse(stored) as { view?: unknown; selectedId?: unknown; projectTab?: unknown }
    return {
      view: state.view === 'activity' ? 'activity' : state.view === 'payroll' ? 'payroll' : state.view === 'tasks' ? 'tasks' : state.view === 'expenses' ? 'expenses' : 'portfolio',
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

function App() {
  const { showToast } = useToast()
  const [initialNavigation] = useState(readWorkspaceNavigation)
  const [mobileNavigationPage, setMobileNavigationPage] = useState<MobileNavigationPage>(
    initialNavigation.view === 'tasks' ? 'updates' : initialNavigation.selectedId ? 'projects' : 'home',
  )
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [billingHistory, setBillingHistory] = useState<PortfolioBillingEvent[]>([])
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
  const [costBudget, setCostBudget] = useState('')
  const [downPaymentPercent, setDownPaymentPercent] = useState('0')
  const [retentionRate, setRetentionRate] = useState('5')
  const [retentionMethod, setRetentionMethod] = useState<'final_schedule' | 'per_billing'>('final_schedule')
  const [formError, setFormError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [taskAttentionCount, setTaskAttentionCount] = useState(0)
  useEffect(() => { if (!isLoading) setHasLoadedOnce(true) }, [isLoading])
  useEffect(() => {
    if (isLoading) return
    let active = true
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    void loadProjectTasks()
      .then((tasks) => { if (active) setTaskAttentionCount(tasks.filter((task) => task.status !== 'done' && (task.status === 'blocked' || (task.dueDate && task.dueDate <= weekAhead))).length) })
      .catch(() => { if (active) setTaskAttentionCount(0) })
    return () => { active = false }
  }, [isLoading, view])
  const [profileName, setProfileName] = useState('Project Manager')
  const [profileTitle, setProfileTitle] = useState('Project Manager')
  const [profileEmail, setProfileEmail] = useState('')
  const [pendingTaskNotificationId, setPendingTaskNotificationId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const selected = projects.find((project) => project.id === selectedId)
  const clients = [...new Set(projects.map((project) => project.client))]
  const missingReceiptCount = projects.flatMap((project) => project.expenses).filter((expense) => !expense.receiptStoragePath && expense.category !== 'payroll' && !expense.id.startsWith('payroll')).length
  const billed = projects.reduce((sum, project) => sum + project.billed, 0)
  const collected = projects.reduce((sum, project) => sum + project.collected, 0)
  const totalExpenses = projects.reduce((sum, project) => sum + project.outflow, 0)
  const receivable = receivables.reduce((sum, item) => sum + item.outstandingAmount, 0) + projects.reduce((sum, project) => sum + retentionDueForProject(project), 0)
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
  const openTaskCommentNotification = (taskId: string) => {
    setPendingTaskNotificationId(taskId)
    setMobileNavigationPage('updates')
    setView('tasks')
    setSelectedId(null)
    setProjectTab('Overview')
  }
  useEffect(() => {
    let active = true
    void loadPortfolio()
      .then((portfolio) => {
        if (!active) return
        setProjects(portfolio.projects)
        setPayments(portfolio.payments)
        setReceivables(portfolio.receivables)
        setBillingHistory(portfolio.billingHistory)
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
      const metadataTitle = user.user_metadata.job_title
      const name = typeof metadataName === 'string' && metadataName.trim()
        ? metadataName.trim()
        : typeof metadataFirstName === 'string' && metadataFirstName.trim()
          ? metadataFirstName.trim()
          : user.email?.split('@')[0] ?? 'Project Manager'
      setProfileName(name)
      setProfileTitle(typeof metadataTitle === 'string' && metadataTitle.trim() ? metadataTitle.trim() : 'Project Manager')
      setProfileEmail(user.email ?? '')
    }).catch((error: unknown) => {
      if (active) console.error('Could not load the owner profile.', error)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    try {
      window.sessionStorage.setItem(workspaceNavigationStorageKey, JSON.stringify({ view, selectedId, projectTab }))
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
    const budget = costBudget.trim() ? parseMoneyInput(costBudget) : null
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) { setFormError('Enter a valid cost budget, or leave it blank to set it later.'); return }
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
      if (budget !== null && budget > 0) {
        try {
          await updateProjectCostForecast({ projectId, costBudget: budget, estimatedCostToComplete: budget })
        } catch {
          showToast('Project created, but the cost budget could not be saved. Set it in the Forecast tab.', 'update')
        }
      }
      setSelectedId(projectId)
      setView('portfolio')
      setProjectTab('Overview')
      setShowModal(false)
      setName(''); setClient(''); setLocation(''); setContract(''); setCostBudget(''); setDownPaymentPercent('0'); setRetentionRate('5'); setRetentionMethod('final_schedule')
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
    {showDashboardExpense && <QuickExpenseSheet projects={projects.map((project) => ({ id: project.id, name: project.name }))} onClose={() => setShowDashboardExpense(false)} onSaved={() => { setShowDashboardExpense(false); refreshWorkspace(false) }} />}
    {isLoading && (hasLoadedOnce
      ? <div className="workspace-loading" role="status" aria-live="polite" aria-label="Loading SAGACT workspace"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><RefreshCw size={25} /></span><strong>Loading your workspace</strong><span className="loading-caption">Preparing your project overview</span><span className="loading-progress"><span /></span></div>
      : <div className="workspace-loading auth-loading" role="status" aria-live="polite" aria-label="Loading SAGACT workspace"><span className="auth-loading-mark"><img src="/sagact-mark.svg" alt="" /></span><span className="loading-brand">SAGACT<span>.</span></span><strong>Preparing your workspace</strong><span className="loading-progress"><span /></span></div>)}
    <aside className="sidebar">
      <div className="mobile-project-detail-header">
        <button type="button" onClick={() => { setSelectedId(null); setProjectTab('Overview') }} aria-label="Back to projects"><ArrowLeft size={19} /></button>
        <strong>Project Details</strong>
        <div className="mobile-owner-header-actions">
          <NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} onOpenTask={openTaskCommentNotification} />
        </div>
      </div>
      <div className="brand-lockup"><span className="brand-mark"><img src="/sagact-mark.svg" alt="" /></span><span>SAGACT<span className="brand-period">.</span></span></div>
      <div className="mobile-owner-header-actions">
        <NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} onOpenTask={openTaskCommentNotification} />
      </div>
      <nav className="primary-nav grouped-nav" aria-label="Main navigation">
        <span className="nav-indicator" aria-hidden="true" style={{ '--nav-index': Math.max(0, (['portfolio', 'tasks', 'expenses', 'payroll'] as WorkspaceView[]).indexOf(view)) } as React.CSSProperties} />
        <span className="nav-group-label">Workspace</span>
        <button className={`nav-item ${view === 'portfolio' && mobileNavigationPage !== 'profile' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('portfolio'); setSelectedId(null); setProjectTab('Overview') }}><LayoutDashboard size={17} /><span>Portfolio</span></button>
        <button className={`nav-item ${view === 'tasks' && mobileNavigationPage !== 'profile' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('updates'); setView('tasks'); setSelectedId(null); setProjectTab('Overview') }}><ClipboardList size={17} /><span>Tasks</span>{taskAttentionCount > 0 && <em className="nav-count" title="Blocked or due within 7 days">{taskAttentionCount}</em>}</button>
        <button className={`nav-item nav-item-desktop-only ${view === 'activity' && mobileNavigationPage !== 'profile' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('activity'); setSelectedId(null); setProjectTab('Overview') }}><History size={17} /><span>Activity</span></button>
        <span className="nav-group-label">Finance</span>
        <button className={`nav-item ${view === 'expenses' && mobileNavigationPage !== 'profile' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('expenses'); setSelectedId(null); setProjectTab('Overview') }}><Receipt size={17} /><span>Expenses</span>{missingReceiptCount > 0 && <em className="nav-count is-warning" title="Expenses without a receipt">{missingReceiptCount}</em>}</button>
        <button className={`nav-item ${view === 'payroll' && mobileNavigationPage !== 'profile' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('payroll'); setSelectedId(null); setProjectTab('Overview') }}><WalletCards size={17} /><span>Payroll</span></button>
      </nav>
      <div className="owner-sidebar-footer">
        <button type="button" className="client-sidebar-account" onClick={() => { setMobileNavigationPage('profile'); setSelectedId(null) }}>
          <span className="client-account-avatar">{profileName.trim().charAt(0).toUpperCase() || <UserRound size={15} />}</span>
          <span><strong>{profileName}</strong><small>{profileTitle}</small></span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
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
        <div className="breadcrumbs"><span>SAGACT</span><ChevronRight size={13} /><strong>{mobileNavigationPage === 'profile' ? 'Profile' : view === 'activity' ? 'Activity' : view === 'payroll' ? 'Payroll' : view === 'tasks' ? 'Tasks' : view === 'expenses' ? 'Expenses' : selected?.name ?? 'Portfolio'}</strong></div>
        <div className="topbar-right">
          <span className="topbar-date"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(currentDate)}</span>
          <NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} onOpenTask={openTaskCommentNotification} />
          <AccountMenu name={profileName} caption={profileTitle} onOpenProfile={() => { setMobileNavigationPage('profile'); setSelectedId(null); window.scrollTo({ top: 0 }) }} onSignOut={() => { void supabase?.auth.signOut() }} />
        </div>
      </header>

      <main className="page-content">
        <div key={`${view}:${selectedId ?? 'portfolio'}`} className="view-transition">
        <Suspense fallback={<SkeletonRows rows={5} label="Loading" />}>{mobileNavigationPage === 'profile' ? <MobileOwnerProfile name={profileName} title={profileTitle} email={profileEmail} onOpenActivity={() => { setMobileNavigationPage('home'); setView('activity'); setSelectedId(null) }} onSignOut={() => { void supabase?.auth.signOut() }} /> : view === 'activity' ? <ActivityPanel onOpenProject={openProject} /> : view === 'expenses' ? <AllExpensesPanel projects={projects.map((project) => ({ id: project.id, name: project.name, expenses: project.expenses }))} onChanged={() => refreshWorkspace(false)} /> : view === 'payroll' ? <PayrollPanel projects={projects} onChanged={() => refreshWorkspace(false)} /> : view === 'tasks' ? <TaskManagementPanel isOwner currentUserId="" projects={projects.map((project) => ({ id: project.id, name: project.name }))} notificationTaskId={pendingTaskNotificationId} onNotificationTaskClosed={() => setPendingTaskNotificationId('')} /> : selected ? <ProjectDetail project={selected} tab={projectTab} setTab={setProjectTab} payments={payments.filter((payment) => payment.projectId === selected.id)} receivables={receivables.filter((item) => item.projectId === selected.id)} onBack={() => { setSelectedId(null); setProjectTab('Overview') }} onSetup={() => openProjectSetup(selected)} onChanged={() => refreshWorkspace(false)} onProjectStateChange={saveProjectStateOptimistically} /> : <PortfolioOverview ownerName={profileName === 'Project Manager' ? '' : profileName.split(' ')[0]} projects={projects} payments={payments} receivables={receivables} billingHistory={billingHistory} filtered={filtered} currentDate={currentDate} loadError={loadError} attentionCount={attentionCount} billed={billed} collected={collected} totalExpenses={totalExpenses} receivable={receivable} retention={retention} search={search} statusFilter={statusFilter} healthFilter={healthFilter} profitRiskFilter={profitRiskFilter} dateFilter={dateFilter} monthCashIn={monthCashIn} cashBars={cashBars} isLoading={isLoading} setSearch={setSearch} setStatusFilter={setStatusFilter} setHealthFilter={setHealthFilter} setProfitRiskFilter={setProfitRiskFilter} setDateFilter={setDateFilter} setShowDashboardExpense={setShowDashboardExpense} setShowModal={setShowModal} onViewTasks={() => { setMobileNavigationPage('updates'); setView('tasks'); setSelectedId(null); setProjectTab('Overview') }} onUploadUpdate={(projectId) => { setMobileNavigationPage('projects'); setSelectedId(projectId); setView('portfolio'); setProjectTab('Milestones') }} isProjectsPage={mobileNavigationPage === 'projects'} refreshWorkspace={refreshWorkspace} openProject={openProject} />}</Suspense>
        </div>
      </main>
      <footer className="page-footer" aria-hidden="true" />
    </div>

    {showModal && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isCreatingProject) setShowModal(false) }}>
      <section className="project-modal setup-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div className="modal-heading"><div><div className="section-kicker">New project</div><h2 id="new-project-title">Create a project</h2></div><button className="icon-button" onClick={() => setShowModal(false)} aria-label="Close" disabled={isCreatingProject}><X size={18} /></button></div>
        <form onSubmit={createProject} className="setup-form">
          <fieldset className="setup-group"><legend>Project</legend>
            <label className="form-field">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Salo Spot" required /></label>
            <div className="form-row">
              <label className="form-field">Client<input list="known-clients" value={client} onChange={(event) => setClient(event.target.value)} placeholder="Choose or add a client" required /><datalist id="known-clients">{clients.map((item) => <option key={item} value={item} />)}</datalist></label>
              <label className="form-field">Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or project address" maxLength={200} minLength={2} required /></label>
            </div>
          </fieldset>
          <fieldset className="setup-group"><legend>Contract &amp; payment terms</legend>
            <div className="form-row">
              <label className="form-field">Contract amount<MoneyInput min="1" step="1" value={contract} onChange={setContract} placeholder="0" required /></label>
              <label className="form-field">Down payment<span className="setup-suffix-input"><input type="number" min="0" max="100" step="0.5" value={downPaymentPercent} onChange={(event) => setDownPaymentPercent(event.target.value)} required /><span>%</span></span></label>
            </div>
            <label className="form-field">Cost budget <span className="field-optional">optional · recommended</span><MoneyInput min="0" step="1" value={costBudget} onChange={setCostBudget} placeholder="What you expect the whole build to cost" /></label>
            {(() => { const amount = parseMoneyInput(contract); const budget = parseMoneyInput(costBudget); return Number.isFinite(amount) && amount > 0 && Number.isFinite(budget) && budget > 0 ? <p className={`setup-preview${budget >= amount ? ' is-warning' : ''}`}><span>Expected profit</span><strong>{setupMoney.format(amount - budget)} · {Math.round((amount - budget) / amount * 100)}% margin</strong></p> : <p className="setup-hint">Add a budget so the project can show profit and overspending from day one.</p> })()}
            {(() => { const amount = parseMoneyInput(contract); const percent = Number(downPaymentPercent); return Number.isFinite(amount) && amount > 0 && Number.isFinite(percent) && percent > 0 ? <p className="setup-preview"><span>Down payment amount</span><strong>{setupMoney.format(amount * percent / 100)}</strong></p> : null })()}
            <div className="form-field"><span>Retention rate</span><div className="setup-segment" role="radiogroup" aria-label="Retention rate">{([{ value: '5', label: '5%', hint: 'Default' }, { value: '10', label: '10%', hint: 'Client request' }] as const).map((option) => <button key={option.value} type="button" role="radio" aria-checked={retentionRate === option.value} className={retentionRate === option.value ? 'is-selected' : ''} onClick={() => setRetentionRate(option.value)}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div></div>
            <div className="form-field"><span>Retention method</span><div className="setup-choice" role="radiogroup" aria-label="Retention method">
              <button type="button" role="radio" aria-checked={retentionMethod === 'final_schedule'} className={retentionMethod === 'final_schedule' ? 'is-selected' : ''} onClick={() => setRetentionMethod('final_schedule')}><strong>Final payment schedule</strong><small>Collected once at the end</small></button>
              <button type="button" role="radio" aria-checked={retentionMethod === 'per_billing'} className={retentionMethod === 'per_billing' ? 'is-selected' : ''} onClick={() => setRetentionMethod('per_billing')}><strong>Deduct from each billing</strong><small>Held back from every progress billing</small></button>
            </div></div>
          </fieldset>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)} disabled={isCreatingProject}>Cancel</button><button type="submit" className="button button-primary" disabled={isCreatingProject}><Plus size={15} />{isCreatingProject ? 'Creating…' : 'Create project'}</button></div>
        </form>
      </section>
    </div>, document.body)}
  </div>
}

export default App
