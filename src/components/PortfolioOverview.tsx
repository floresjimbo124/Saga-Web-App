import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Clock3,
  Filter,
  FileText,
  FolderKanban,
  Plus,
  Search,
  TrendingUp,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { PortfolioPayment, PortfolioProject, ProjectHealthStatus, ProjectStatus } from '../data/portfolio'
import { createProjectMilestonePhotoUrl } from '../data/project-milestones'
import type { ReceivableAgingItem } from '../finance/receivables-aging'
import { calculateProjectFinance } from '../finance/project-finance'
import { calculateProfitRisk } from '../finance/profit-risk'
import { calculateCostPace } from '../finance/cost-pace'
import { getProjectDeadlineStatus } from '../finance/project-deadline'
import { Metric, ProjectDeadlineBadge, ProfitRiskBadge, StatusBadge } from './ProjectStatusBadges'
import { ReceivablesAgingPanel } from './ReceivablesAgingPanel'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const projectStatusOptions: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
]
const projectHealthOptions: { value: ProjectHealthStatus; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'needs_attention', label: 'Needs attention' },
]

const shortDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
const relativeDate = (date: string) => {
  const eventDate = new Date(date.length === 10 ? `${date}T12:00:00` : date)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const eventStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
  const daysAgo = Math.round((todayStart.getTime() - eventStart.getTime()) / 86_400_000)
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return `${daysAgo}d ago`
  return shortDate(date)
}

function MobileActivityPhoto({ storagePath, projectName }: { storagePath: string; projectName: string }) {
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoError, setPhotoError] = useState(false)

  useEffect(() => {
    let active = true
    void createProjectMilestonePhotoUrl(storagePath)
      .then((url) => { if (active) setPhotoUrl(url) })
      .catch((error: unknown) => {
        console.error('Could not load a recent milestone photo.', error)
        if (active) setPhotoError(true)
      })
    return () => { active = false }
  }, [storagePath])

  if (!photoUrl || photoError) {
    return <span className="mobile-recent-activity-icon"><FolderKanban size={15} /></span>
  }
  return <img className="mobile-recent-activity-photo" src={photoUrl} alt={`${projectName} milestone`} />
}

function MobileProjectCover({ storagePath, projectName }: { storagePath: string | null | undefined; projectName: string }) {
  const [photoUrl, setPhotoUrl] = useState('')

  useEffect(() => {
    let active = true
    if (!storagePath) return () => { active = false }
    void createProjectMilestonePhotoUrl(storagePath)
      .then((url) => { if (active) setPhotoUrl(url) })
      .catch((error: unknown) => {
        console.error('Could not load this project cover photo.', error)
      })
    return () => { active = false }
  }, [storagePath])

  return photoUrl
    ? <img src={photoUrl} alt={`${projectName} project`} />
    : <span className="mobile-project-cover-fallback">{projectName.slice(0, 1)}</span>
}

type PortfolioOverviewProps = {
  ownerName?: string
  projects: PortfolioProject[]
  payments: PortfolioPayment[]
  receivables: ReceivableAgingItem[]
  filtered: PortfolioProject[]
  currentDate: Date
  loadError: string
  attentionCount: number
  billed: number
  collected: number
  totalExpenses: number
  receivable: number
  retention: number
  search: string
  statusFilter: string
  healthFilter: string
  profitRiskFilter: string
  dateFilter: string
  monthCashIn: number
  cashBars: number[]
  isLoading: boolean
  setSearch: (value: string) => void
  setStatusFilter: (value: string) => void
  setHealthFilter: (value: string) => void
  setProfitRiskFilter: (value: string) => void
  setDateFilter: (value: string) => void
  setShowDashboardExpense: (value: boolean) => void
  setShowModal: (value: boolean) => void
  onViewTasks: () => void
  onUploadUpdate: (projectId: string) => void
  isProjectsPage: boolean
  refreshWorkspace: () => void
  openProject: (projectId: string) => void
}

export function PortfolioOverview({
  projects,
  payments,
  receivables,
  filtered,
  currentDate,
  loadError,
  attentionCount,
  billed,
  collected,
  totalExpenses,
  receivable,
  retention,
  search,
  statusFilter,
  healthFilter,
  profitRiskFilter,
  dateFilter,
  monthCashIn,
  isLoading,
  setSearch,
  setStatusFilter,
  setHealthFilter,
  setProfitRiskFilter,
  setDateFilter,
  setShowDashboardExpense,
  setShowModal,
  onViewTasks,
  onUploadUpdate,
  isProjectsPage,
  refreshWorkspace,
  openProject,
  ownerName = '',
}: PortfolioOverviewProps) {
  const greetingHour = currentDate.getHours()
  const greetingText = greetingHour < 12 ? 'Good morning' : greetingHour < 18 ? 'Good afternoon' : 'Good evening'
  const isSameMonth = (date: string, offset: number) => {
    const value = new Date(date.length === 10 ? `${date}T12:00:00` : date)
    const target = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1)
    return value.getFullYear() === target.getFullYear() && value.getMonth() === target.getMonth()
  }
  const sixMonths = Array.from({ length: 6 }, (_, index) => {
    const offset = index - 5
    const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1)
    return {
      key: `${monthDate.getFullYear()}-${monthDate.getMonth()}`,
      label: new Intl.DateTimeFormat('en-PH', { month: 'short' }).format(monthDate),
      cashIn: payments.filter((payment) => isSameMonth(payment.date, offset)).reduce((sum, payment) => sum + payment.amount, 0),
      expenses: projects.flatMap((project) => project.expenses).filter((expense) => isSameMonth(expense.date, offset)).reduce((sum, expense) => sum + expense.amount, 0),
      isCurrent: offset === 0,
    }
  })
  const sixMonthMax = Math.max(...sixMonths.map((month) => Math.max(month.cashIn, month.expenses)), 0)
  const sixMonthCashIn = sixMonths.reduce((sum, month) => sum + month.cashIn, 0)
  const sixMonthExpenses = sixMonths.reduce((sum, month) => sum + month.expenses, 0)
  const monthReceiptCount = payments.filter((payment) => isSameMonth(payment.date, 0)).length
  const overdueItems = receivables.filter((item) => item.daysOverdue > 0)
  const unpaidChangeOrders = receivables.filter((item) => item.kind === 'change-order')
  const pendingApprovals = projects.flatMap((project) => project.changeOrders.filter((order) => order.status === 'pending_approval'))
  const deadlineAlerts = projects.filter((project) => {
    const level = getProjectDeadlineStatus(project.deadline, project.status).level
    return level === 'overdue' || level === 'due-soon'
  })
  const projectForecasts = projects.map((project) => {
    const contractValue = calculateProjectFinance({
      contractAmount: project.contract,
      specialDiscount: project.specialDiscount,
      approvedChangeOrders: project.approvedChangeOrders,
      progressPercent: project.progress,
      retentionRatePercent: project.retentionRate,
      retentionMethod: project.retentionMethod,
      billedToDate: project.billed,
      paymentsReceived: project.collected,
      retentionHeld: project.retention,
    }).contractValue
    return {
      project,
      risk: calculateProfitRisk({ contractValue, recordedCosts: project.outflow, costBudget: project.costBudget, estimatedCostToComplete: project.estimatedCostToComplete }),
      pace: calculateCostPace({ costBudget: project.costBudget, recordedCosts: project.outflow, progressPercent: project.progress }),
    }
  })
  const ratedForecasts = projectForecasts.filter((item) => item.risk.projectedProfit !== null)
  const projectedProfitTotal = ratedForecasts.reduce((sum, item) => sum + (item.risk.projectedProfit ?? 0), 0)
  const overspending = projectForecasts.filter((item) => item.pace.level === 'overspending' || item.pace.level === 'watch')
  const shortDeadline = (date: string | null) => date ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date)) : ''
  const actionItems = [
    overdueItems.length > 0 && { key: 'overdue', tone: 'danger', label: `${overdueItems.length} overdue billing${overdueItems.length === 1 ? '' : 's'}`, detail: `${money.format(overdueItems.reduce((sum, item) => sum + item.outstandingAmount, 0))} past due`, onClick: () => document.getElementById('receivables-aging')?.scrollIntoView({ behavior: 'smooth' }) },
    unpaidChangeOrders.length > 0 && { key: 'co', tone: 'warning', label: `${unpaidChangeOrders.length} unpaid change order${unpaidChangeOrders.length === 1 ? '' : 's'}`, detail: `${money.format(unpaidChangeOrders.reduce((sum, item) => sum + item.outstandingAmount, 0))} to collect`, onClick: () => openProject(unpaidChangeOrders[0].projectId) },
    pendingApprovals.length > 0 && { key: 'approval', tone: 'warning', label: `${pendingApprovals.length} change order${pendingApprovals.length === 1 ? '' : 's'} awaiting client`, detail: 'Waiting for client approval', onClick: () => openProject(projects.find((project) => project.changeOrders.some((order) => order.status === 'pending_approval'))?.id ?? '') },
    overspending.length > 0 && { key: 'pace', tone: 'danger', label: `${overspending.length} project${overspending.length === 1 ? '' : 's'} spending ahead of progress`, detail: overspending.slice(0, 2).map((item) => `${item.project.name} · ${item.pace.detail}`).join(', '), onClick: () => openProject(overspending[0].project.id) },
    deadlineAlerts.length > 0 && { key: 'deadline', tone: 'info', label: `${deadlineAlerts.length} deadline${deadlineAlerts.length === 1 ? '' : 's'} coming up`, detail: deadlineAlerts.slice(0, 2).map((project) => `${project.name} · ${shortDeadline(project.deadline)}`).join(', '), onClick: () => openProject(deadlineAlerts[0].id) },
  ].filter(Boolean) as { key: string; tone: string; label: string; detail: string; onClick: () => void }[]
  const activeCount = projects.filter((project) => project.status === 'active').length
  const completedCount = projects.filter((project) => project.status === 'completed' || project.status === 'closed').length
  const delayedCount = projects.filter((project) => getProjectDeadlineStatus(project.deadline, project.status).level === 'overdue').length
  const overallProgress = projects.length
    ? Math.round(projects.reduce((total, project) => total + project.progress, 0) / projects.length)
    : 0
  const [showUpdateProjectPicker, setShowUpdateProjectPicker] = useState(false)
  const [showMobileProjectFilters, setShowMobileProjectFilters] = useState(false)
  const [projectFilterAnimationKey, setProjectFilterAnimationKey] = useState(0)
  const [isCompactViewport, setIsCompactViewport] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const updateProjectFilter = (update: () => void) => {
    update()
    setProjectFilterAnimationKey((key) => key + 1)
  }
  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 640px)')
    const syncViewport = () => setIsCompactViewport(compactViewport.matches)
    syncViewport()
    compactViewport.addEventListener('change', syncViewport)
    return () => compactViewport.removeEventListener('change', syncViewport)
  }, [])
  const recentActivity = [
    ...projects.flatMap((project) => project.milestones
      .filter((milestone) => milestone.status === 'complete' && milestone.actualDate)
      .map((milestone) => ({
        id: `milestone-${milestone.id}`,
        projectId: project.id,
        projectName: project.name,
        date: milestone.actualDate!,
        description: `Milestone completed · ${milestone.name}`,
        photoStoragePath: milestone.photoStoragePath,
      }))),
    ...payments.map((payment) => ({
      id: `payment-${payment.id}`,
      projectId: payment.projectId,
      projectName: projects.find((project) => project.id === payment.projectId)?.name ?? 'Project',
      date: payment.date,
      description: `${payment.payer} · ${money.format(payment.amount)}`,
      photoStoragePath: null,
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 3)

  if (isProjectsPage && isCompactViewport) {
    const mobileProjects = projects.filter((project) => {
      const matchesSearch = `${project.name} ${project.client} ${project.location}`.toLowerCase().includes(search.toLowerCase())
      const matchesStatus = statusFilter === 'All statuses'
        || (statusFilter === 'active' && project.status === 'active')
        || (statusFilter === 'completed' && (project.status === 'completed' || project.status === 'closed'))
        || (statusFilter === 'on_hold' && project.status === 'on_hold')
      const finance = calculateProjectFinance({
        contractAmount: project.contract,
        specialDiscount: project.specialDiscount,
        approvedChangeOrders: project.approvedChangeOrders,
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
      return matchesSearch && matchesStatus
        && (healthFilter === 'All health' || project.healthStatus === healthFilter)
        && (profitRiskFilter === 'All profit risks' || profitRisk.label === profitRiskFilter)
    })
    const statusTabs: { label: string; value: string }[] = [
      { label: 'All', value: 'All statuses' },
      { label: 'In Progress', value: 'active' },
      { label: 'Completed', value: 'completed' },
      { label: 'On Hold', value: 'on_hold' },
    ]

    return <section className="mobile-projects-page" aria-label="Projects">
      <div className="mobile-project-search-row">
        <label className="search-field">
          <Search size={15} />
          <input value={search} onChange={(event) => updateProjectFilter(() => setSearch(event.target.value))} placeholder="Search projects or clients" aria-label="Search projects or clients" />
        </label>
        <button type="button" className={`mobile-project-filter-button ${showMobileProjectFilters ? 'is-active' : ''}`} aria-label="Toggle project filters" aria-expanded={showMobileProjectFilters} onClick={() => setShowMobileProjectFilters((open) => !open)}>
          <Filter size={16} />
        </button>
      </div>
      {attentionCount > 0 && <div className="attention-summary mobile-project-attention" role="status">
        <div><CircleAlert size={15} /><strong>{attentionCount} project{attentionCount === 1 ? '' : 's'} need{attentionCount === 1 ? 's' : ''} attention</strong></div>
        <button type="button" className="text-button compact-button" onClick={() => updateProjectFilter(() => {
          setSearch('')
          setStatusFilter('All statuses')
          setHealthFilter('needs_attention')
          setProfitRiskFilter('All profit risks')
        })}>View projects <ArrowRight size={13} /></button>
      </div>}
      {showMobileProjectFilters && <div className="mobile-project-extra-filters">
        <label className="select-wrap"><span>Project health</span><select value={healthFilter} onChange={(event) => updateProjectFilter(() => setHealthFilter(event.target.value))}><option>All health</option>{projectHealthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>
        <label className="select-wrap"><span>Profit risk</span><select value={profitRiskFilter} onChange={(event) => updateProjectFilter(() => setProfitRiskFilter(event.target.value))}><option>All profit risks</option><option>High</option><option>Medium</option><option>Low</option><option>Not rated</option></select><ChevronDown size={13} /></label>
      </div>}
      <div className="mobile-project-status-tabs" role="group" aria-label="Filter projects by status">
        {statusTabs.map((tab) => <button type="button" key={tab.value} className={statusFilter === tab.value ? 'is-active' : ''} aria-pressed={statusFilter === tab.value} onClick={() => updateProjectFilter(() => setStatusFilter(tab.value))}>{tab.label}</button>)}
      </div>
      <div className="mobile-project-card-list">
        {mobileProjects.length ? mobileProjects.map((project, index) => {
          const coverPhoto = project.coverPhotoStoragePath ?? project.milestones.find((milestone) => milestone.photoStoragePath)?.photoStoragePath
          const statusLabel = project.status === 'active' ? 'In Progress' : project.status === 'on_hold' ? 'On Hold' : project.status === 'completed' || project.status === 'closed' ? 'Completed' : 'Planning'
          const progressDate = project.completedAt ?? project.deadline
          return <button type="button" className="mobile-project-card" key={project.id} style={{ animationName: projectFilterAnimationKey % 2 ? 'mobileProjectFilterEnterA' : 'mobileProjectFilterEnterB', animationDelay: `${Math.min(index, 5) * 35}ms` }} onClick={() => openProject(project.id)}>
            <span className="mobile-project-cover">
              <MobileProjectCover storagePath={coverPhoto} projectName={project.name} />
            </span>
            <span className="mobile-project-card-content">
              <span className="mobile-project-card-heading"><strong>{project.name}</strong><ChevronRight size={15} /></span>
              <small className="mobile-project-client">{project.client}</small>
              <small className="mobile-project-location">{project.location}</small>
              <span className={`mobile-project-status status-${project.status.replace('_', '-')}`}>{statusLabel}</span>
              <span className="mobile-project-progress"><span><span style={{ width: `${project.progress}%` }} /></span><small>{project.progress}%</small></span>
              <span className="mobile-project-dates">
                <small><Clock3 size={10} />Started {shortDate(project.startDate ?? project.createdAt)}</small>
                <small><Clock3 size={10} />{progressDate ? `Target ${shortDate(progressDate)}` : 'No target date'}</small>
              </span>
            </span>
          </button>
        }) : <p className="mobile-projects-empty">{projects.length ? 'No projects match your search or filters.' : 'No projects in this workspace yet.'}</p>}
      </div>
      <p className="mobile-project-count">Showing {mobileProjects.length} of {projects.length} projects</p>
    </section>
  }

  return <>
    <section className="page-heading portfolio-page-heading">
      <div className="portfolio-welcome"><h1>{greetingText}{ownerName ? `, ${ownerName}` : ''}</h1><p>{activeCount} active project{activeCount === 1 ? '' : 's'} · {money.format(receivable)} to collect{pendingApprovals.length ? ` · ${pendingApprovals.length} change order${pendingApprovals.length === 1 ? '' : 's'} awaiting approval` : ''}</p></div>
      <div className="heading-actions"><button className="button button-secondary dashboard-expense-button" onClick={() => setShowDashboardExpense(true)} disabled={!projects.length || isLoading}><Plus size={17} />Add new expense</button><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} />New project</button></div>
    </section>
    <section className="mobile-dashboard-stats" aria-label="Project summary">
      <div><span className="mobile-dashboard-stat-icon"><FolderKanban size={15} /></span><strong>{projects.length}</strong><small>Total projects</small></div>
      <div><span className="mobile-dashboard-stat-icon"><Activity size={15} /></span><strong>{activeCount}</strong><small>In progress</small></div>
      <div><span className="mobile-dashboard-stat-icon"><CircleCheck size={15} /></span><strong>{completedCount}</strong><small>Completed</small></div>
      <div><span className="mobile-dashboard-stat-icon is-delayed"><Clock3 size={15} /></span><strong>{delayedCount}</strong><small>Delayed</small></div>
    </section>
    <section className="mobile-project-overview surface-card" aria-labelledby="mobile-project-overview-title">
      <div className="mobile-dashboard-section-heading">
        <h2 id="mobile-project-overview-title">Project Overview</h2>
        <span>This Month</span>
      </div>
      <div className="mobile-progress-summary">
        <div><span>Overall Progress</span><TrendingUp size={16} /></div>
        <strong>{overallProgress}%</strong>
        <div className="mobile-progress-track"><span style={{ width: `${overallProgress}%` }} /></div>
        <div className="mobile-progress-mini-chart" aria-hidden="true">
          {projects.slice(0, 8).map((project) => <span key={project.id} style={{ height: `${Math.max(12, project.progress)}%` }} />)}
        </div>
      </div>
    </section>
    <section className="mobile-quick-actions" aria-labelledby="mobile-quick-actions-title">
      <h2 id="mobile-quick-actions-title">Quick Actions</h2>
      <div className="mobile-quick-action-grid">
        <button type="button" onClick={() => setShowModal(true)}><span><Plus size={16} /></span><strong>New Project</strong><small>Create a new project</small></button>
        <button type="button" disabled={!projects.length || isLoading} onClick={() => setShowDashboardExpense(true)}><span><Plus size={16} /></span><strong>Add New Expense</strong><small>Track project cost</small></button>
        <button type="button" disabled={!projects.length || isLoading} onClick={() => setShowUpdateProjectPicker(true)}><span><Camera size={16} /></span><strong>Upload Update</strong><small>Add photos &amp; progress</small></button>
        <button type="button" onClick={onViewTasks}><span><CalendarDays size={16} /></span><strong>View Schedule</strong><small>Open task calendar</small></button>
      </div>
    </section>
    {showUpdateProjectPicker && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowUpdateProjectPicker(false) }}>
      <section className="project-modal mobile-update-project-picker" role="dialog" aria-modal="true" aria-labelledby="mobile-update-project-title">
        <div className="modal-heading">
          <div><h2 id="mobile-update-project-title">Upload a project update</h2><p>Choose a project to add progress or milestone photos.</p></div>
          <button className="icon-button" type="button" onClick={() => setShowUpdateProjectPicker(false)} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mobile-update-project-list">
          {projects.map((project) => <button type="button" key={project.id} onClick={() => { setShowUpdateProjectPicker(false); onUploadUpdate(project.id) }}>
            <span><strong>{project.name}</strong><small>{project.milestones.length} milestone{project.milestones.length === 1 ? '' : 's'} · {project.progress}% complete</small></span>
            <ChevronRight size={16} />
          </button>)}
        </div>
      </section>
    </div>, document.body)}
    <section className="mobile-recent-activity" aria-labelledby="mobile-recent-activity-title">
      <div className="mobile-dashboard-section-heading">
        <h2 id="mobile-recent-activity-title">Recent Activity</h2>
        <button type="button" onClick={onViewTasks}>See all</button>
      </div>
      {recentActivity.length ? <div className="mobile-recent-activity-list">{recentActivity.map((activity) => {
        return <button type="button" className="mobile-recent-activity-row" key={activity.id} onClick={() => openProject(activity.projectId)}>
          {activity.photoStoragePath
            ? <MobileActivityPhoto storagePath={activity.photoStoragePath} projectName={activity.projectName} />
            : <span className="mobile-recent-activity-icon"><ArrowDownLeft size={15} /></span>}
          <span><strong>{activity.projectName}</strong><small>{activity.description} · {relativeDate(activity.date)}</small></span>
          <ChevronRight size={16} />
        </button>
      })}</div> : <p className="mobile-recent-activity-empty">No recent activity yet.</p>}
    </section>
    {loadError && <div className="sample-banner" role="alert"><CircleAlert size={15} /><span><strong>Could not load SAGACT data.</strong> {loadError}</span><button className="text-button" onClick={refreshWorkspace}>Retry</button></div>}
    {actionItems.length > 0 && <section className="dashboard-action-pills" aria-label="Needs your attention">
      {actionItems.map((item) => <button type="button" key={item.key} className={`dashboard-action-pill is-${item.tone}`} onClick={item.onClick} title={item.detail}>
        <i aria-hidden="true" /><strong>{item.label}</strong><span>{item.detail}</span><ArrowRight size={12} />
      </button>)}
    </section>}
    <section className="metric-grid desktop-portfolio-metrics" aria-label="Portfolio totals">
      <Metric icon={<FileText size={16} />} label="Total billed" value={money.format(billed)} foot="Incl. approved change orders" tone="green" />
      <Metric icon={<ArrowDownLeft size={16} />} label="Collected" value={money.format(collected)} foot={`${billed ? Math.round(collected / billed * 100) : 0}% of billed`} tone="blue" />
      {ratedForecasts.length || !projects.length
        ? <Metric icon={<TrendingUp size={16} />} label="Projected profit" value={ratedForecasts.length ? money.format(projectedProfitTotal) : '—'} foot={ratedForecasts.length ? `${ratedForecasts.length} of ${projects.length} project${projects.length === 1 ? '' : 's'} rated · ${money.format(totalExpenses)} spent` : `Set budgets to rate · ${money.format(totalExpenses)} spent`} tone={ratedForecasts.length && projectedProfitTotal < 0 ? 'red' : 'green'} />
        : <button type="button" className="metric-card metric-green metric-prompt" onClick={() => openProject(projects[0].id)}><div className="metric-top"><span className="metric-icon"><TrendingUp size={16} /></span><span>Projected profit</span></div><strong className="metric-value">Set a budget <ArrowRight size={16} /></strong><small>To see profit and margin · {money.format(totalExpenses)} spent</small></button>}
      <Metric icon={<Clock3 size={16} />} label="Receivables due" value={money.format(receivable)} foot={`${receivables.length} open item${receivables.length === 1 ? '' : 's'}${overdueItems.length ? ` · ${overdueItems.length} overdue` : ''}${retention > 0 ? ` · ${money.format(retention)} retention held` : ''}`} tone="gold" />
    </section>
    <section className="portfolio-section" id="portfolio-projects"><div className="section-heading"><h2>Projects <span className="count-pill">{projects.length}</span></h2></div>
      {attentionCount > 0 && <div className="attention-summary" role="status"><div><CircleAlert size={16} /><strong>{attentionCount} project{attentionCount === 1 ? '' : 's'} need{attentionCount === 1 ? 's' : ''} attention</strong></div><button type="button" className="text-button compact-button" onClick={() => setHealthFilter('needs_attention')}>View projects <ArrowRight size={13} /></button></div>}
      {projects.length >= 5 && <div className="filter-bar"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or clients" aria-label="Search projects or clients" /></label>
        <label className="select-wrap"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>

        <label className="select-wrap"><span className="sr-only">Filter by profit risk</span><select value={profitRiskFilter} onChange={(event) => setProfitRiskFilter(event.target.value)}><option>All profit risks</option><option>High</option><option>Medium</option><option>Low</option><option>Not rated</option></select><ChevronDown size={13} /></label>
        <label className="select-wrap date-filter"><span className="sr-only">Filter by date range</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option>Any time</option><option>Last 30 days</option><option>This quarter</option></select><ChevronDown size={13} /></label></div>}
      <div className="project-table"><div className="project-table-head"><span>Project</span><span>Progress</span><span>Collected / billed</span><span>Profit</span><span>Status</span><span>Deadline</span><span /></div>
        {filtered.length ? filtered.map((project) => {
          const finance = calculateProjectFinance({
            contractAmount: project.contract,
            specialDiscount: project.specialDiscount,
            approvedChangeOrders: project.approvedChangeOrders,
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
          const deadlineStatus = getProjectDeadlineStatus(project.deadline, project.status)
          const collectedPercent = project.billed > 0 ? Math.min(100, Math.round(project.collected / project.billed * 100)) : 0
          return <button className="project-row" key={project.id} onClick={() => openProject(project.id)}>
            <span className="project-name-cell"><span className={`project-avatar avatar-${project.prefix.toLowerCase()}`}>{project.name.slice(0, 1)}</span><span className="project-title-stack"><strong>{project.name}</strong><small>{project.client} · {money.format(project.contract)}</small></span></span>
            <span className="money-cell project-contract">{money.format(project.contract)}</span>
            <span className="progress-cell project-progress"><span className="progress-value">{project.progress}%</span><span className="progress-track"><span style={{ width: `${project.progress}%` }} /></span></span>
            <span className={`project-billed project-billing-cell${project.collected > project.billed ? ' is-over' : ''}`}><span><strong>{money.format(project.collected)}</strong><small>of {money.format(project.billed)}</small></span>{project.collected > project.billed && <small className="project-billing-advance">+{money.format(project.collected - project.billed)} advance</small>}<span className="project-billing-track"><span style={{ width: `${collectedPercent}%` }} /></span></span>
            <span className="project-risk"><ProfitRiskBadge risk={profitRisk} />{profitRisk.projectedMarginPercent !== null && <small className="project-risk-margin">{Math.round(profitRisk.projectedMarginPercent)}%</small>}</span>
            <span className="project-status"><StatusBadge status={project.status} />{project.healthStatus === 'needs_attention' && <small className="project-attention">Needs attention</small>}</span>
            <span className="project-deadline"><ProjectDeadlineBadge deadline={deadlineStatus} />{project.deadline && deadlineStatus.level !== 'completed' && <small className="project-deadline-date">{shortDeadline(project.deadline)}</small>}</span>
            <span className="row-arrow"><ChevronRight size={16} /></span>
          </button>
        }) : <div className="empty-state">{projects.length ? 'No projects match those filters.' : 'No projects in this workspace yet. Create one to get started.'}</div>}
        <div className="table-footer"><span>Showing {filtered.length} of {projects.length} projects</span></div></div>
    </section>
    <section className="lower-grid"><div className="surface-card cashflow-card">
        <div className="card-heading-row"><div><div className="section-kicker">Last 6 months</div><h2>Cash in vs expenses</h2></div></div>
        <div className="cashflow-summary">
          <span><small>This month</small><strong>{money.format(monthCashIn)}</strong><em>{monthReceiptCount} receipt{monthReceiptCount === 1 ? '' : 's'}</em></span>
          <span><small>6-month cash in</small><strong>{money.format(sixMonthCashIn)}</strong></span>
          <span><small>6-month expenses</small>{sixMonthExpenses > 0 ? <strong className="is-expense">{money.format(sixMonthExpenses)}</strong> : <strong className="is-muted">None logged</strong>}</span>
        </div>
        {sixMonthMax > 0 ? <div className="six-month-chart" role="img" aria-label="Cash in and expenses for the last six months">
          {sixMonths.map((month) => <div className={`six-month-col${month.isCurrent ? ' is-current' : ''}`} key={month.key} title={`${month.label}: ${money.format(month.cashIn)} in · ${money.format(month.expenses)} expenses`}>
            <div className="six-month-bars">
              <span className="bar-in" style={{ height: `${month.cashIn ? Math.max(3, month.cashIn / sixMonthMax * 100) : 0}%` }} />
              <span className="bar-out" style={{ height: `${month.expenses ? Math.max(3, month.expenses / sixMonthMax * 100) : 0}%` }} />
            </div>
            <small>{month.label}</small>
          </div>)}
        </div> : <div className="chart-empty">No payments or expenses in the last 6 months.</div>}
        {sixMonthExpenses > 0 && <div className="six-month-legend"><span><i className="bar-in" />Cash in</span><span><i className="bar-out" />Expenses</span></div>}
      </div>
      <div className="surface-card activity-card"><div className="card-heading-row"><div><h2>Recent payments</h2></div><button className="text-button compact-button" onClick={() => payments[0] && openProject(payments[0].projectId)} disabled={!payments.length}>View all <ArrowRight size={13} /></button></div><div className="activity-list">{payments.length ? payments.slice(0, 3).map((payment) => <button className="activity-row" key={payment.id} onClick={() => openProject(payment.projectId)}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{projects.find((item) => item.id === payment.projectId)?.name} · {shortDate(payment.date)} · {payment.reference}</small></span><span className="activity-amount">+{money.format(payment.amount)}</span></button>) : <div className="empty-state">No payments recorded yet.</div>}</div></div></section>
    <div id="receivables-aging"><ReceivablesAgingPanel items={receivables} onOpenProject={openProject} /></div>
  </>
}
