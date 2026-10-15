import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BriefcaseBusiness, Camera, Crop, Download, Eye,
  CalendarDays, Check, ChevronRight, CircleAlert, CircleDollarSign, ClipboardList, Pencil,
  FileText, House, LayoutDashboard, LogOut, Plus, RefreshCw, Settings2, Trash2, UserPlus, WalletCards, X,
  Receipt, UserRound,
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
import { QuickExpenseSheet } from './components/QuickExpenseSheet'
import { AccountMenu } from './components/AccountMenu'
import { ProjectProfitCard } from './components/ProjectProfitCard'
import { AllExpensesPanel } from './components/AllExpensesPanel'
import { loadProjectTasks } from './data/tasks'
import { ProjectDocumentPanel } from './components/ProjectDocumentPanel'
import { InviteClientDialog } from './components/InviteClientDialog'
import { ProjectForecastPanel } from './components/ProjectForecastPanel'
import { ProjectMilestonePanel } from './components/ProjectMilestonePanel'
import { ContractImpactCard, ProjectChangeOrderPanel } from './components/ProjectChangeOrderPanel'
import { ProjectPulse } from './components/ProjectPulse'
import { StatusMenu, type StatusMenuOption } from './components/StatusMenu'
import { createProjectCoverPhotoUrl, deleteProjectCoverPhoto, uploadProjectCoverPhoto, validateProjectCoverPhoto } from './data/project-cover'
import { ProjectCoverCropDialog } from './components/ProjectCoverCropDialog'
import { PayrollPanel } from './components/PayrollPanel'
import { TaskManagementPanel } from './components/TaskManagementPanel'
import { NotificationCenter } from './components/NotificationCenter'
import { MoneyInput } from './components/MoneyInput'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from './lib/payment-receipt-pdf'
import { formatPaymentType } from './lib/payment-type'
import { formatChangeOrderNumber } from './lib/change-order-number'
import { formatBillingNumber } from './lib/billing-number'
import { PortfolioOverview } from './components/PortfolioOverview'
import { Metric } from './components/ProjectStatusBadges'
import { parseMoneyInput } from './lib/money-input'
import { useToast } from './components/toast-context'
import { workspaceNavigationStorageKey } from './auth/workspace-navigation'
import './App.css'

type Project = PortfolioProject
type Payment = PortfolioPayment
type WorkspaceView = 'portfolio' | 'payroll' | 'tasks' | 'expenses'
type MobileNavigationPage = 'home' | 'projects' | 'updates' | 'profile'
type ProjectDetailTab = 'Overview' | 'Milestones' | 'Change orders' | 'Billings' | 'Payments' | 'Expenses' | 'Forecast' | 'Documents'
const projectDetailTabs: ProjectDetailTab[] = ['Overview', 'Milestones', 'Change orders', 'Billings', 'Payments', 'Expenses', 'Forecast', 'Documents']
function readWorkspaceNavigation(): { view: WorkspaceView; selectedId: string | null; projectTab: ProjectDetailTab } {
  try {
    const stored = window.sessionStorage.getItem(workspaceNavigationStorageKey)
    if (!stored) return { view: 'portfolio', selectedId: null, projectTab: 'Overview' }
    const state = JSON.parse(stored) as { view?: unknown; selectedId?: unknown; projectTab?: unknown }
    return {
      view: state.view === 'payroll' ? 'payroll' : state.view === 'tasks' ? 'tasks' : state.view === 'expenses' ? 'expenses' : 'portfolio',
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
const projectStatusMenuOptions: StatusMenuOption<ProjectStatus>[] = [
  { value: 'planning', label: 'Planning', description: 'Not started on site yet', tone: 'blue' },
  { value: 'active', label: 'Active', description: 'Work is under way', tone: 'green' },
  { value: 'on_hold', label: 'On hold', description: 'Paused for now', tone: 'amber' },
  { value: 'completed', label: 'Completed', description: 'Work finished, closing out', tone: 'green' },
  { value: 'closed', label: 'Closed', description: 'Fully settled and archived', tone: 'grey' },
]
const projectHealthMenuOptions: StatusMenuOption<ProjectHealthStatus>[] = [
  { value: 'on_track', label: 'On track', description: 'No issues right now', tone: 'green' },
  { value: 'needs_attention', label: 'Needs attention', description: 'Something needs follow-up', tone: 'red' },
]
const setupMoney = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
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
        <button className={`nav-item ${view === 'portfolio' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('portfolio'); setSelectedId(null); setProjectTab('Overview') }}><LayoutDashboard size={17} /><span>Portfolio</span></button>
        <button className={`nav-item ${view === 'tasks' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('updates'); setView('tasks'); setSelectedId(null); setProjectTab('Overview') }}><ClipboardList size={17} /><span>Tasks</span>{taskAttentionCount > 0 && <em className="nav-count" title="Blocked or due within 7 days">{taskAttentionCount}</em>}</button>
        <span className="nav-group-label">Finance</span>
        <button className={`nav-item ${view === 'expenses' ? 'is-active' : ''}`} onClick={() => { setMobileNavigationPage('home'); setView('expenses'); setSelectedId(null); setProjectTab('Overview') }}><Receipt size={17} /><span>Expenses</span>{missingReceiptCount > 0 && <em className="nav-count is-warning" title="Expenses without a receipt">{missingReceiptCount}</em>}</button>
        <button className={`nav-item ${view === 'payroll' ? 'is-active' : ''}`} onClick={() => { setView('payroll'); setSelectedId(null); setProjectTab('Overview') }}><WalletCards size={17} /><span>Payroll</span></button>
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
        <div className="breadcrumbs"><span>SAGACT</span><ChevronRight size={13} /><strong>{view === 'payroll' ? 'Payroll' : view === 'tasks' ? 'Tasks' : view === 'expenses' ? 'Expenses' : selected?.name ?? 'Portfolio'}</strong></div>
        <div className="topbar-right">
          <span className="topbar-date"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(currentDate)}</span>
          <NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} onOpenTask={openTaskCommentNotification} />
          <AccountMenu name={profileName} caption={profileTitle} onOpenProfile={() => { setMobileNavigationPage('profile'); setSelectedId(null); window.scrollTo({ top: 0 }) }} onSignOut={() => { void supabase?.auth.signOut() }} />
        </div>
      </header>

      <main className="page-content">
        <div key={`${view}:${selectedId ?? 'portfolio'}`} className="view-transition">
        {mobileNavigationPage === 'profile' ? <MobileOwnerProfile name={profileName} title={profileTitle} email={profileEmail} onSignOut={() => { void supabase?.auth.signOut() }} /> : view === 'expenses' ? <AllExpensesPanel projects={projects.map((project) => ({ id: project.id, name: project.name, expenses: project.expenses }))} onChanged={() => refreshWorkspace(false)} /> : view === 'payroll' ? <PayrollPanel projects={projects} onChanged={() => refreshWorkspace(false)} /> : view === 'tasks' ? <TaskManagementPanel isOwner currentUserId="" projects={projects.map((project) => ({ id: project.id, name: project.name }))} notificationTaskId={pendingTaskNotificationId} onNotificationTaskClosed={() => setPendingTaskNotificationId('')} /> : selected ? <ProjectDetail project={selected} tab={projectTab} setTab={setProjectTab} payments={payments.filter((payment) => payment.projectId === selected.id)} receivables={receivables.filter((item) => item.projectId === selected.id)} onBack={() => { setSelectedId(null); setProjectTab('Overview') }} onSetup={() => openProjectSetup(selected)} onChanged={() => refreshWorkspace(false)} onProjectStateChange={saveProjectStateOptimistically} /> : <PortfolioOverview ownerName={profileName === 'Project Manager' ? '' : profileName.split(' ')[0]} projects={projects} payments={payments} receivables={receivables} filtered={filtered} currentDate={currentDate} loadError={loadError} attentionCount={attentionCount} billed={billed} collected={collected} totalExpenses={totalExpenses} receivable={receivable} retention={retention} search={search} statusFilter={statusFilter} healthFilter={healthFilter} profitRiskFilter={profitRiskFilter} dateFilter={dateFilter} monthCashIn={monthCashIn} cashBars={cashBars} isLoading={isLoading} setSearch={setSearch} setStatusFilter={setStatusFilter} setHealthFilter={setHealthFilter} setProfitRiskFilter={setProfitRiskFilter} setDateFilter={setDateFilter} setShowDashboardExpense={setShowDashboardExpense} setShowModal={setShowModal} onViewTasks={() => { setMobileNavigationPage('updates'); setView('tasks'); setSelectedId(null); setProjectTab('Overview') }} onUploadUpdate={(projectId) => { setMobileNavigationPage('projects'); setSelectedId(projectId); setView('portfolio'); setProjectTab('Milestones') }} isProjectsPage={mobileNavigationPage === 'projects'} refreshWorkspace={refreshWorkspace} openProject={openProject} />}
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
  const setupContractValue = parseMoneyInput(contract)
  const setupDiscountValue = parseMoneyInput(discount)
  const setupNet = Math.max(0, (Number.isFinite(setupContractValue) ? setupContractValue : 0) - (Number.isFinite(setupDiscountValue) ? setupDiscountValue : 0))
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="project-modal setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-project-title"><div className="modal-heading"><div><div className="section-kicker">Project financial setup</div><h2 id="setup-project-title">{project.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button></div><form onSubmit={onSubmit} className="setup-form">
      <fieldset className="setup-group"><legend>Client</legend>
        <label className="form-field">Client name<input autoFocus value={client} onChange={(event) => setClient(event.target.value)} placeholder="Enter the actual client name" minLength={2} required /></label>
      </fieldset>
      <fieldset className="setup-group"><legend>Contract</legend>
        <div className="form-row"><label className="form-field">Contract amount<MoneyInput min="0.01" step="0.01" value={contract} onChange={setContract} placeholder="0.00" required /></label><label className="form-field">Special discount<MoneyInput min="0" step="0.01" value={discount} onChange={setDiscount} required /></label></div>
        <p className="setup-preview"><span>Net contract</span><strong>{setupMoney.format(setupNet)}</strong></p>
      </fieldset>
      <fieldset className="setup-group"><legend>Schedule</legend>
        <div className="form-row"><label className="form-field">Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label className="form-field">Target date<input type="date" value={deadline} min={startDate || undefined} onChange={(event) => setDeadline(event.target.value)} /></label></div>
        {startDate && deadline && deadline > startDate && <p className="setup-preview"><span>Duration</span><strong>{Math.round((new Date(`${deadline}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000)} calendar days</strong></p>}
      </fieldset>
      <fieldset className="setup-group"><legend>Payment terms</legend>
        <div className="form-row"><label className="form-field">Down payment<span className="setup-suffix-input"><input type="number" min="0" max="100" step="0.5" value={downPayment} onChange={(event) => setDownPayment(event.target.value)} required /><span>%</span></span></label>
          <div className="form-field"><span>Retention rate</span><div className="setup-segment" role="radiogroup" aria-label="Retention rate">{[{ value: '5', label: '5%', hint: 'Default' }, { value: '10', label: '10%', hint: 'Client request' }].map((option) => <button key={option.value} type="button" role="radio" aria-checked={retentionRate === option.value} className={retentionRate === option.value ? 'is-selected' : ''} onClick={() => setRetentionRate(option.value)}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div></div></div>
        {setupNet > 0 && Number.isFinite(Number(downPayment)) && <p className="setup-preview"><span>Down payment amount</span><strong>{setupMoney.format(setupNet * Number(downPayment) / 100)}</strong></p>}
        <div className="form-field"><span>Retention method</span><div className="setup-choice" role="radiogroup" aria-label="Retention method">
          <button type="button" role="radio" aria-checked={retentionMethod === 'final_schedule'} className={retentionMethod === 'final_schedule' ? 'is-selected' : ''} onClick={() => setRetentionMethod('final_schedule')}><strong>Final payment schedule</strong><small>Collected once at the end</small></button>
          <button type="button" role="radio" aria-checked={retentionMethod === 'per_billing'} className={retentionMethod === 'per_billing' ? 'is-selected' : ''} onClick={() => setRetentionMethod('per_billing')}><strong>Deduct from each billing</strong><small>Held back from every progress billing</small></button>
        </div></div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}><FileText size={15} />{saving ? 'Saving…' : 'Save contract setup'}</button></div></form></section></div>, document.body)
}

function ProjectDetailCover({ projectId, projectName, storagePath, onChanged }: { projectId: string; projectName: string; storagePath: string | null; onChanged: () => void }) {
  const { showToast } = useToast()
  const [loadedPhoto, setLoadedPhoto] = useState<{ storagePath: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
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
      showToast(
        storagePath ? 'Project cover photo updated.' : 'Project cover photo added.',
        storagePath ? 'update' : 'create',
      )
      onChanged()
      setCropFile(null)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not update the project cover photo.')
    } finally {
      if (photoInput.current) photoInput.current.value = ''
      setIsWorking(false)
    }
  }

  const adjustCover = async () => {
    if (!photoUrl || isWorking) return
    setError('')
    setIsWorking(true)
    try {
      const response = await fetch(photoUrl)
      if (!response.ok) throw new Error('Could not load the current project photo for cropping.')
      const blob = await response.blob()
      const extension = storagePath?.split('.').pop() ?? 'jpg'
      setCropFile(new File([blob], `project-cover.${extension}`, { type: blob.type }))
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : 'Could not open the crop editor.')
    } finally {
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
      showToast('Project cover photo removed.', 'delete')
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
    {photoUrl && <button type="button" className="project-detail-cover-adjust" aria-label="Adjust project photo crop" title="Adjust photo crop" disabled={isWorking} onClick={() => { void adjustCover() }}><Crop size={14} />Adjust crop</button>}
    <label className="project-detail-cover-upload">
      <Camera size={14} />{isWorking ? 'Saving…' : storagePath ? 'Change photo' : 'Upload photo'}
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Upload cover photo for ${projectName}`} disabled={isWorking} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (!file) return
        try {
          validateProjectCoverPhoto(file)
          setError('')
          setCropFile(file)
        } catch (validationError) {
          setError(validationError instanceof Error ? validationError.message : 'Could not use the selected project photo.')
          event.currentTarget.value = ''
        }
      }} />
    </label>
    {storagePath && <button type="button" className="project-detail-cover-remove" aria-label="Remove project cover photo" title="Remove project cover photo" disabled={isWorking} onClick={() => { void removeCover() }}><Trash2 size={14} /></button>}
    {error && <p className="project-detail-cover-error" role="alert">{error}</p>}
    {cropFile && <ProjectCoverCropDialog file={cropFile} saving={isWorking} error={error} onCancel={() => { if (!isWorking) { setCropFile(null); setError('') } }} onSave={(file) => { void uploadCover(file) }} />}
  </div>
}

function ProjectDetail({ project, tab, setTab, payments, receivables, onBack, onSetup, onChanged, onProjectStateChange }: { project: Project; tab: ProjectDetailTab; setTab: (tab: ProjectDetailTab) => void; payments: Payment[]; receivables: ReceivableAgingItem[]; onBack: () => void; onSetup: () => void; onChanged: () => void; onProjectStateChange: (projectId: string, status: ProjectStatus, healthStatus: ProjectHealthStatus) => Promise<void> }) {
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [paymentToEdit, setPaymentToEdit] = useState<Payment | null>(null)
  const [showInviteClient, setShowInviteClient] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [projectStateError, setProjectStateError] = useState('')
  const [isSavingProjectState, setIsSavingProjectState] = useState(false)
  const paymentHistory = payments
  const projectExpenses = project.expenses
  const finance = financeForProject(project)
  const approvedChangeOrderTotal = project.changeOrders
    .filter((order) => order.status === 'approved')
    .reduce((total, order) => total + order.amount, 0)
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
  const billingReceivable = receivables
    .filter((item) => item.kind !== 'change-order' && item.kind !== 'retention')
    .reduce((total, item) => total + item.outstandingAmount, 0)
  const changeOrderReceivable = receivables
    .filter((item) => item.kind === 'change-order')
    .reduce((total, item) => total + item.outstandingAmount, 0)
  const due = billingReceivable + changeOrderReceivable + retentionDue
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
  const changeOrderForPayment = (payment: Payment) =>
    payment.paymentType === 'change_order'
      ? project.changeOrders.find((order) => order.contractId === payment.contractId)
      : undefined
  const receiptDetails = (payment: Payment) => {
    const changeOrder = changeOrderForPayment(payment)
    return {
      projectName: project.name,
      payerName: payment.payer,
      receiptNumber: payment.receiptNumber ?? '',
      amount: payment.amount,
      receivedDate: payment.date,
      paymentType: payment.paymentType,
      changeOrderLabel: changeOrder
        ? `${formatChangeOrderNumber(project.prefix, changeOrder.orderNumber)} · ${changeOrder.title}`
        : undefined,
      billingAllocations: payment.billingAllocations.map((allocation) => ({
        billingNumber: formatBillingNumber(allocation.billingNumber),
      })),
      paymentMode: payment.paymentMode,
      reference: payment.paymentReference,
    }
  }
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
          <StatusMenu label="Project status" value={project.status} disabled={isSavingProjectState} options={projectStatusMenuOptions} onChange={(next) => { void saveProjectState(next, project.healthStatus) }} />
          <StatusMenu label="Project health" value={project.healthStatus} disabled={isSavingProjectState} options={projectHealthMenuOptions} onChange={(next) => { void saveProjectState(project.status, next) }} />
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
      <ProjectPulse progress={project.progress} startDate={project.startDate ?? project.createdAt} deadline={project.deadline} isClosed={project.status === 'completed' || project.status === 'closed'} milestones={project.milestones} costBudget={project.costBudget} recordedCosts={project.outflow} outstanding={due} pendingChangeOrders={project.changeOrders.filter((order) => order.status === 'pending_approval').length} onOpenTab={setTab} />
      <section className="surface-card detail-progress-card"><div className="card-heading-row"><h2>Project health</h2><span className="large-progress">{project.progress}<small>%</small></span></div><div className="detail-progress-track"><span style={{ width: `${project.progress}%` }} /></div><div className="progress-caption"><span>Work accomplished</span><strong>{money.format(finance.earnedToDate)} earned</strong></div><div className="milestone-callout"><span className="milestone-icon"><CalendarDays size={16} /></span><span><small>Next milestone</small><strong>{project.milestone}</strong></span><ChevronRight size={16} /></div></section>
      <ProjectProfitCard contractValue={finance.contractValue} recordedCosts={project.outflow} costBudget={project.costBudget} estimatedCostToComplete={project.estimatedCostToComplete} progressPercent={project.progress} onOpenForecast={() => setTab('Forecast')} onOpenExpenses={() => setTab('Expenses')} />
      <section className="detail-financial-section fin-section" aria-labelledby="detail-financial-heading">
        <div className="detail-financial-heading"><h2 id="detail-financial-heading">Financial overview</h2></div>
        <div className="surface-card fin-layout">
          <ContractImpactCard contractAmount={project.contract} specialDiscount={project.specialDiscount} changeOrders={project.changeOrders} changeOrderOutstanding={changeOrderReceivable} footnote={`${project.downPaymentPercent}% down payment · ${project.retentionRate}% retention`} onOpenChangeOrders={() => setTab('Change orders')} />
          <div className="detail-metrics fin-metrics">
            <div className="metric-card metric-blue">
              <div className="metric-top"><span className="metric-icon"><FileText size={16} /></span><span>Billed to date</span></div>
              <strong className="metric-value">{money.format(project.billed)}</strong>
              <small>{finance.contractValue ? Math.round(project.billed / finance.contractValue * 100) : 0}% of revised contract</small>
              {approvedChangeOrderTotal > 0 && <ul className="fin-balance-lines">
                <li><span>Contract</span><span>{money.format(project.billed - approvedChangeOrderTotal)}</span></li>
                <li><span>Change orders</span><span>{money.format(approvedChangeOrderTotal)}</span></li>
              </ul>}
            </div>
            <div className="metric-card metric-green">
              <div className="metric-top"><span className="metric-icon"><CircleDollarSign size={16} /></span><span>Collected</span></div>
              <strong className="metric-value">{money.format(project.collected)}</strong>
              <small>{finance.contractValue ? Math.round(project.collected / finance.contractValue * 100) : 0}% of revised contract</small>
              {approvedChangeOrderTotal > 0 && <ul className="fin-balance-lines">
                <li><span>Contract</span><span>{money.format(Math.max(0, project.collected - Math.max(0, approvedChangeOrderTotal - changeOrderReceivable)))}</span></li>
                <li><span>Change orders</span><span>{money.format(Math.max(0, approvedChangeOrderTotal - changeOrderReceivable))}</span></li>
              </ul>}
            </div>
            <Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retentionHeld)} foot="Released one month after completion" tone="neutral" />
            <div className={`metric-card fin-balance ${due > 0 ? 'has-balance' : 'is-settled'}`}>
              <div className="metric-top"><span className="metric-icon">{due > 0 ? <CircleAlert size={16} /> : <Check size={16} />}</span><span>Balance outstanding</span></div>
              <strong className="metric-value">{due > 0 ? money.format(due) : 'Fully settled'}</strong>
              <ul className="fin-balance-lines">
                <li><span>Billings</span><span>{money.format(billingReceivable)}</span></li>
                {approvedChangeOrderTotal > 0 && <li><span>Change orders</span><span>{money.format(changeOrderReceivable)}</span></li>}
                <li><span>Retention due</span><span>{money.format(retentionDue)}</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <div className="detail-supporting-grid fin-payments">
        <section className="surface-card detail-activity-card"><div className="card-heading-row"><div><h2>Payments received</h2></div><button className="text-button compact-button" onClick={() => setTab('Payments')}>All payments{paymentHistory.length > 5 ? ` (${paymentHistory.length})` : ''} <ArrowRight size={13} /></button></div>{paymentHistory.length ? <div className="detail-recent-payments-list">{paymentHistory.slice(0, 5).map((payment) => <div className="payment-detail-row" key={payment.id}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.billingAllocations.length ? `${payment.billingAllocations.map((allocation) => `Billing #${formatBillingNumber(allocation.billingNumber)}`).join(', ')} · ${formatPaymentType(payment.paymentType)}` : formatPaymentType(payment.paymentType)} · {payment.reference}</small></span><strong className="activity-amount">{money.format(payment.amount)}</strong></div>)}</div> : <div className="empty-state">No payments recorded yet.</div>}</section>
      </div>
    </>}
    {tab === 'Billings' && <BillingPanel projectId={project.id} projectName={project.name} clientName={project.client} location={project.location} progress={project.progress} earned={originalFinance.earnedToDate} ceiling={originalFinance.billableCeiling} isSetupComplete={project.isSetupComplete} downPaymentAmount={Math.round(Math.max(0, project.contract - project.specialDiscount) * project.downPaymentPercent / 100)} downPaymentPercent={project.downPaymentPercent} onChanged={onChanged} />}
    {tab === 'Milestones' && <ProjectMilestonePanel projectId={project.id} milestones={project.milestones} onChanged={onChanged} />}
    {tab === 'Change orders' && <ProjectChangeOrderPanel projectId={project.id} projectPrefix={project.prefix} projectName={project.name} clientName={project.client} location={project.location} contractAmount={project.contract} specialDiscount={project.specialDiscount} changeOrders={project.changeOrders} onChanged={onChanged} />}
    {tab === 'Payments' && <section className="surface-card tab-content payment-register-card">
      <div className="card-heading-row"><h2>Received payments</h2><button className="button button-primary" onClick={() => setShowPaymentDialog(true)}><Plus size={15} />Log payment</button></div>
      {(showPaymentDialog || paymentToEdit) && <PaymentEntryDialog
        project={project}
        payment={paymentToEdit ?? undefined}
        changeOrderContracts={project.changeOrders
          .flatMap((order) => order.status === 'approved' && order.contractId
            ? [{ id: order.contractId, label: `${formatChangeOrderNumber(project.prefix, order.orderNumber)} · ${order.title}` }]
            : [])}
        onClose={() => { setShowPaymentDialog(false); setPaymentToEdit(null) }}
        onSaved={onChanged}
      />}
      {receiptError && <p className="form-error" role="alert">{receiptError}</p>}
      {paymentHistory.length ? <div className="payment-register-list">{paymentHistory.map((payment) => {
        const changeOrder = changeOrderForPayment(payment)
        const changeOrderLabel = changeOrder
          ? formatChangeOrderNumber(project.prefix, changeOrder.orderNumber)
          : null
        return <div className="payment-detail-row pay-row" key={payment.id}>
          <span className="activity-icon"><ArrowDownLeft size={15} /></span>
          <span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.billingAllocations.length ? `${payment.billingAllocations.map((allocation) => `Billing #${formatBillingNumber(allocation.billingNumber)} (${money.format(allocation.amount)})`).join(', ')} · ${formatPaymentType(payment.paymentType)}` : formatPaymentType(payment.paymentType)}{changeOrderLabel ? ` · ${changeOrderLabel}` : ''} · {payment.reference}</small></span>
          <strong className="activity-amount">{money.format(payment.amount)}</strong>
          <span className="pay-actions">
            <button type="button" className="pay-action" aria-label={`Edit payment ${payment.receiptNumber ?? ''}`} title="Edit payment" onClick={() => { setShowPaymentDialog(false); setPaymentToEdit(payment) }}><Pencil size={14} /><span>Edit</span></button>
            {payment.receiptNumber && <button type="button" className="pay-action" aria-label={`View acknowledgement receipt ${payment.receiptNumber}`} title="View receipt" onClick={() => { void viewAcknowledgementReceipt(payment) }}><Eye size={14} /><span>Receipt</span></button>}
            {payment.receiptNumber && <button type="button" className="pay-action is-icon" aria-label={`Download acknowledgement receipt ${payment.receiptNumber}`} title="Download receipt PDF" onClick={() => { void downloadAcknowledgementReceipt(payment) }}><Download size={14} /></button>}
          </span>
        </div>
      })}</div> : <div className="empty-state">No payments recorded for this project.</div>}
    </section>}
    {tab === 'Expenses' && <ExpensePanel projectId={project.id} projectName={project.name} expenses={projectExpenses} inflow={project.collected} onChanged={onChanged} />}
    {tab === 'Forecast' && <ProjectForecastPanel projectId={project.id} contractValue={finance.contractValue} recordedCosts={project.outflow} costBudget={project.costBudget} estimatedCostToComplete={project.estimatedCostToComplete} onChanged={onChanged} />}
    {tab === 'Documents' && <ProjectDocumentPanel projectId={project.id} />}
    </div>
  </div>
}

function MobileOwnerProfile({ name, title, email, onSignOut }: { name: string; title: string; email: string; onSignOut: () => void }) {
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
        <span>{title}</span>
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
