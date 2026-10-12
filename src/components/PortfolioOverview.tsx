import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
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
  WalletCards,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { PortfolioPayment, PortfolioProject, ProjectHealthStatus, ProjectStatus } from '../data/portfolio'
import { createProjectMilestonePhotoUrl } from '../data/project-milestones'
import type { ReceivableAgingItem } from '../finance/receivables-aging'
import { calculateProjectFinance } from '../finance/project-finance'
import { calculateProfitRisk } from '../finance/profit-risk'
import { getProjectDeadlineStatus } from '../finance/project-deadline'
import { HealthBadge, Metric, ProjectDeadlineBadge, ProfitRiskBadge, StatusBadge } from './ProjectStatusBadges'
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
  cashBars,
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
}: PortfolioOverviewProps) {
  const greetingHour = currentDate.getHours()
  const greetingText = greetingHour < 12 ? 'Good morning' : greetingHour < 18 ? 'Good afternoon' : 'Good evening'
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
      <div className="portfolio-welcome"><h1>{greetingText}</h1><p>Here’s what’s happening with your projects today.</p></div>
      <div className="heading-actions"><button className="button button-primary button-danger" onClick={() => setShowDashboardExpense(true)} disabled={!projects.length || isLoading}><Plus size={17} />Add new expense</button><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} />New project</button></div>
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
    <section className="metric-grid desktop-portfolio-metrics" aria-label="Portfolio totals">
      <Metric icon={<FileText size={16} />} label="Total billed" value={money.format(billed)} foot="Across all projects" tone="green" />
      <Metric icon={<ArrowDownLeft size={16} />} label="Collected" value={money.format(collected)} foot={`${billed ? Math.round(collected / billed * 100) : 0}% of billed`} tone="blue" />
      <Metric icon={<ArrowUpRight size={16} />} label="Total expenses" value={money.format(totalExpenses)} foot="Across all projects" tone="red" />
      <Metric icon={<Clock3 size={16} />} label="Receivables due" value={money.format(receivable)} foot="Retention excluded" tone="gold" />
      <Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retention)} foot="Not yet due for release" tone="neutral" />
    </section>
    <section className="portfolio-section" id="portfolio-projects"><div className="section-heading"><h2>Projects <span className="count-pill">{projects.length}</span></h2></div>
      {attentionCount > 0 && <div className="attention-summary" role="status"><div><CircleAlert size={16} /><strong>{attentionCount} project{attentionCount === 1 ? '' : 's'} need{attentionCount === 1 ? 's' : ''} attention</strong></div><button type="button" className="text-button compact-button" onClick={() => setHealthFilter('needs_attention')}>View projects <ArrowRight size={13} /></button></div>}
      <div className="filter-bar"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or clients" aria-label="Search projects or clients" /></label>
        <label className="select-wrap"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>
        <label className="select-wrap"><span className="sr-only">Filter by health</span><select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}><option>All health</option>{projectHealthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>
        <label className="select-wrap"><span className="sr-only">Filter by profit risk</span><select value={profitRiskFilter} onChange={(event) => setProfitRiskFilter(event.target.value)}><option>All profit risks</option><option>High</option><option>Medium</option><option>Low</option><option>Not rated</option></select><ChevronDown size={13} /></label>
        <label className="select-wrap date-filter"><span className="sr-only">Filter by date range</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option>Any time</option><option>Last 30 days</option><option>This quarter</option></select><ChevronDown size={13} /></label></div>
      <div className="project-table"><div className="project-table-head"><span>Project / client</span><span>Contract</span><span>Progress</span><span>Billed</span><span>Collected</span><span>Net cash</span><span>Status</span><span>Health</span><span>Profit risk</span><span>Deadline</span><span /></div>
        {filtered.length ? filtered.map((project) => {
          const netCash = project.collected - project.outflow
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
          return <button className="project-row" key={project.id} onClick={() => openProject(project.id)}><span className="project-name-cell"><span className={`project-avatar avatar-${project.prefix.toLowerCase()}`}>{project.name.slice(0, 1)}</span><span className="project-title-stack"><strong>{project.name}</strong><small>{project.client}</small></span></span><span className="money-cell project-contract">{money.format(project.contract)}</span><span className="progress-cell project-progress"><span className="progress-value">{project.progress}%</span><span className="progress-track"><span style={{ width: `${project.progress}%` }} /></span></span><span className="money-cell project-billed">{money.format(project.billed)}</span><span className="money-cell project-collected">{money.format(project.collected)}</span><span className={`money-cell net-cash-cell ${netCash < 0 ? 'net-cash-negative' : 'net-cash-positive'} project-net-cash`}>{money.format(netCash)}</span><span className="project-status"><StatusBadge status={project.status} /></span><span className="project-health"><HealthBadge status={project.healthStatus} /></span><span className="project-risk"><ProfitRiskBadge risk={profitRisk} /></span><span className="project-deadline"><ProjectDeadlineBadge deadline={deadlineStatus} /></span><span className="row-arrow"><ChevronRight size={16} /></span></button>
        }) : <div className="empty-state">{projects.length ? 'No projects match those filters.' : 'No projects in this workspace yet. Create one to get started.'}</div>}
        <div className="table-footer"><span>Showing {filtered.length} of {projects.length} projects</span></div></div>
    </section>
    <section className="lower-grid"><div className="surface-card cashflow-card"><div className="card-heading-row"><div><div className="section-kicker">{new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(currentDate)}</div><h2>Cash in, month to date</h2></div><button className="icon-button small-icon-button" aria-label="Open cash flow details" title="Open cash flow details"><ArrowUpRight size={16} /></button></div><div className="cashflow-total"><strong>{money.format(monthCashIn)}</strong><span className="positive-chip">{payments.length} receipt{payments.length === 1 ? '' : 's'}</span></div>{monthCashIn ? <><div className="bar-chart" aria-label="Monthly cash received from recorded payments">{cashBars.map((height, index) => <span className={index === 11 ? 'bar current-bar' : 'bar'} key={index} style={{ height: `${height}%` }} />)}</div><div className="chart-axis"><span>Start</span><span>Mid-month</span><span>Today</span></div></> : <div className="chart-empty">No payments recorded this month.</div>}</div>
      <div className="surface-card activity-card"><div className="card-heading-row"><div><h2>Recent payments</h2></div><button className="text-button compact-button" onClick={() => payments[0] && openProject(payments[0].projectId)} disabled={!payments.length}>View all <ArrowRight size={13} /></button></div><div className="activity-list">{payments.length ? payments.slice(0, 3).map((payment) => <button className="activity-row" key={payment.id} onClick={() => openProject(payment.projectId)}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{projects.find((item) => item.id === payment.projectId)?.name} · {shortDate(payment.date)} · {payment.reference}</small></span><span className="activity-amount">+{money.format(payment.amount)}</span></button>) : <div className="empty-state">No payments recorded yet.</div>}</div></div></section>
    <ReceivablesAgingPanel items={receivables} onOpenProject={openProject} />
  </>
}
