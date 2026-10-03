import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Plus,
  Search,
  WalletCards,
} from 'lucide-react'
import type { PortfolioPayment, PortfolioProject, ProjectHealthStatus, ProjectStatus } from '../data/portfolio'
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
  refreshWorkspace,
  openProject,
}: PortfolioOverviewProps) {
  return <>
    <section className="page-heading"><div /><div className="heading-actions"><button className="button button-primary button-danger" onClick={() => setShowDashboardExpense(true)} disabled={!projects.length || isLoading}><Plus size={17} />Add expense</button><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} />New project</button></div></section>
    {loadError && <div className="sample-banner" role="alert"><CircleAlert size={15} /><span><strong>Could not load SAGACT data.</strong> {loadError}</span><button className="text-button" onClick={refreshWorkspace}>Retry</button></div>}
    <section className="metric-grid" aria-label="Portfolio totals">
      <Metric icon={<FileText size={16} />} label="Total billed" value={money.format(billed)} foot="Across all projects" tone="green" />
      <Metric icon={<ArrowDownLeft size={16} />} label="Collected" value={money.format(collected)} foot={`${billed ? Math.round(collected / billed * 100) : 0}% of billed`} tone="blue" />
      <Metric icon={<ArrowUpRight size={16} />} label="Total expenses" value={money.format(totalExpenses)} foot="Across all projects" tone="red" />
      <Metric icon={<Clock3 size={16} />} label="Receivables due" value={money.format(receivable)} foot="Retention excluded" tone="gold" />
      <Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retention)} foot="Not yet due for release" tone="neutral" />
    </section>
    <section className="portfolio-section"><div className="section-heading"><h2>Projects <span className="count-pill">{projects.length}</span></h2></div>
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
          return <button className="project-row" key={project.id} onClick={() => openProject(project.id)}><span className="project-name-cell"><span className={`project-avatar avatar-${project.prefix.toLowerCase()}`}>{project.name.slice(0, 1)}</span><span className="project-title-stack"><strong>{project.name}</strong><small>{project.client}</small></span></span><span className="money-cell">{money.format(project.contract)}</span><span className="progress-cell"><span className="progress-value">{project.progress}%</span><span className="progress-track"><span style={{ width: `${project.progress}%` }} /></span></span><span className="money-cell">{money.format(project.billed)}</span><span className="money-cell">{money.format(project.collected)}</span><span className={`money-cell net-cash-cell ${netCash < 0 ? 'net-cash-negative' : 'net-cash-positive'}`}>{money.format(netCash)}</span><span><StatusBadge status={project.status} /></span><span><HealthBadge status={project.healthStatus} /></span><span><ProfitRiskBadge risk={profitRisk} /></span><span><ProjectDeadlineBadge deadline={deadlineStatus} /></span><span className="row-arrow"><ChevronRight size={16} /></span></button>
        }) : <div className="empty-state">{projects.length ? 'No projects match those filters.' : 'No projects in this workspace yet. Create one to get started.'}</div>}
        <div className="table-footer"><span>Showing {filtered.length} of {projects.length} projects</span></div></div>
    </section>
    <section className="lower-grid"><div className="surface-card cashflow-card"><div className="card-heading-row"><div><div className="section-kicker">{new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(currentDate)}</div><h2>Cash in, month to date</h2></div><button className="icon-button small-icon-button" aria-label="Open cash flow details" title="Open cash flow details"><ArrowUpRight size={16} /></button></div><div className="cashflow-total"><strong>{money.format(monthCashIn)}</strong><span className="positive-chip">{payments.length} receipt{payments.length === 1 ? '' : 's'}</span></div>{monthCashIn ? <><div className="bar-chart" aria-label="Monthly cash received from recorded payments">{cashBars.map((height, index) => <span className={index === 11 ? 'bar current-bar' : 'bar'} key={index} style={{ height: `${height}%` }} />)}</div><div className="chart-axis"><span>Start</span><span>Mid-month</span><span>Today</span></div></> : <div className="chart-empty">No payments recorded this month.</div>}</div>
      <div className="surface-card activity-card"><div className="card-heading-row"><div><h2>Recent payments</h2></div><button className="text-button compact-button" onClick={() => payments[0] && openProject(payments[0].projectId)} disabled={!payments.length}>View all <ArrowRight size={13} /></button></div><div className="activity-list">{payments.length ? payments.slice(0, 3).map((payment) => <button className="activity-row" key={payment.id} onClick={() => openProject(payment.projectId)}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{projects.find((item) => item.id === payment.projectId)?.name} · {shortDate(payment.date)} · {payment.reference}</small></span><span className="activity-amount">+{money.format(payment.amount)}</span></button>) : <div className="empty-state">No payments recorded yet.</div>}</div></div></section>
    <ReceivablesAgingPanel items={receivables} onOpenProject={openProject} />
  </>
}
