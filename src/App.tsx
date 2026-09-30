import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness,
  CalendarDays, ChevronDown, ChevronRight, CircleAlert, CircleDollarSign,
  Clock3, FileText, LayoutDashboard, LogOut, Plus, RefreshCw, Search, Upload, Users, WalletCards, X,
} from 'lucide-react'
import { calculateProjectFinance } from './finance/project-finance'
import { createProject as createProjectRecord, loadPortfolio, updateProjectSetup as saveProjectSetupRecord, type PortfolioPayment, type PortfolioProject, type ProjectStatus } from './data/portfolio'
import { supabase } from './lib/supabase'
import './App.css'

type Project = PortfolioProject
type Payment = PortfolioPayment
const appLoadedAt = Date.now()
const appLoadedDate = new Date(appLoadedAt)
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const shortDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
const financeForProject = (project: Project) => calculateProjectFinance({
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

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'portfolio' | 'portal'>('portfolio')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [clientFilter, setClientFilter] = useState('All clients')
  const [dateFilter, setDateFilter] = useState('Any time')
  const [showModal, setShowModal] = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [setupProject, setSetupProject] = useState<Project | null>(null)
  const [setupClient, setSetupClient] = useState('')
  const [setupContract, setSetupContract] = useState('')
  const [setupDiscount, setSetupDiscount] = useState('0')
  const [setupDownPayment, setSetupDownPayment] = useState('0')
  const [setupRetentionRate, setSetupRetentionRate] = useState('5')
  const [setupRetentionMethod, setSetupRetentionMethod] = useState<'final_schedule' | 'per_billing'>('final_schedule')
  const [setupError, setSetupError] = useState('')
  const [isSavingSetup, setIsSavingSetup] = useState(false)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [contract, setContract] = useState('')
  const [downPaymentPercent, setDownPaymentPercent] = useState('0')
  const [retentionRate, setRetentionRate] = useState('5')
  const [retentionMethod, setRetentionMethod] = useState<'final_schedule' | 'per_billing'>('final_schedule')
  const [formError, setFormError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const selected = projects.find((project) => project.id === selectedId)
  const clients = [...new Set(projects.map((project) => project.client))]
  const billed = projects.reduce((sum, project) => sum + project.billed, 0)
  const collected = projects.reduce((sum, project) => sum + project.collected, 0)
  const receivable = projects.reduce((sum, project) => sum + financeForProject(project).receivablesDue, 0)
  const retention = projects.reduce((sum, project) => sum + project.retention, 0)
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
        setLoadError('')
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
  const refreshWorkspace = () => {
    setLoadError('')
    setIsLoading(true)
    setReloadKey((key) => key + 1)
  }
  const filtered = projects.filter((project) => {
    const textMatch = `${project.name} ${project.client}`.toLowerCase().includes(search.toLowerCase())
    const statusMatch = statusFilter === 'All statuses' || project.status === statusFilter
    const clientMatch = clientFilter === 'All clients' || project.client === clientFilter
    const updated = Date.parse(project.updatedAt)
    const updatedMonth = Number(project.updatedAt.slice(5, 7)) - 1
    const firstMonthOfQuarter = Math.floor(currentDate.getMonth() / 3) * 3
    const dateMatch = dateFilter === 'Any time' || (dateFilter === 'Last 30 days' && appLoadedAt - updated <= 30 * 86_400_000) || (dateFilter === 'This quarter' && updatedMonth >= firstMonthOfQuarter)
    return textMatch && statusMatch && clientMatch && dateMatch
  })

  const openProject = (id: string) => { setView('portfolio'); setSelectedId(id) }
  const openProjectSetup = (project: Project) => {
    setSetupProject(project)
    setSetupClient(project.client === 'Client not set' ? '' : project.client)
    setSetupContract(project.contract > 0 ? String(project.contract) : '')
    setSetupDiscount(String(project.specialDiscount))
    setSetupDownPayment(String(project.downPaymentPercent))
    setSetupRetentionRate(String(project.retentionRate))
    setSetupRetentionMethod(project.retentionMethod === 'per-billing' ? 'per_billing' : 'final_schedule')
    setSetupError('')
    setShowSetupModal(true)
  }
  const saveProjectSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!setupProject) return
    const contractAmount = Number(setupContract)
    const specialDiscount = Number(setupDiscount)
    if (!Number.isFinite(contractAmount) || contractAmount <= 0) {
      setSetupError('Enter a contract amount greater than zero.')
      return
    }
    if (!Number.isFinite(specialDiscount) || specialDiscount < 0 || specialDiscount > contractAmount) {
      setSetupError('The special discount must be between zero and the contract amount.')
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
        downPaymentPercent: Number(setupDownPayment),
        retentionRatePercent: Number(setupRetentionRate),
        retentionMethod: setupRetentionMethod,
      })
      setShowSetupModal(false)
      refreshWorkspace()
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Could not save project setup.')
    } finally {
      setIsSavingSetup(false)
    }
  }
  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prefix = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    if (prefix.length < 3) { setFormError('The project name needs at least three letters for its receipt prefix.'); return }
    if (projects.some((project) => project.prefix === prefix)) { setFormError(`${prefix} is already in use. Receipt prefixes lock after the first number is issued.`); return }
    const amount = Number(contract)
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Enter a contract amount greater than zero.'); return }
    setFormError('')
    setIsCreatingProject(true)
    try {
      const projectId = await createProjectRecord({
        name: name.trim(),
        clientName: client.trim(),
        prefix,
        contractAmount: amount,
        downPaymentPercent: Number(downPaymentPercent),
        retentionRatePercent: Number(retentionRate),
        retentionMethod,
      })
      setSelectedId(projectId)
      setView('portfolio')
      setShowModal(false)
      setName(''); setClient(''); setContract(''); setDownPaymentPercent('0'); setRetentionRate('5'); setRetentionMethod('final_schedule')
      refreshWorkspace()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the project.')
    } finally {
      setIsCreatingProject(false)
    }
  }

  const projectPrefixPreview = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)

  return <div className="app-shell" aria-busy={isLoading}>
    {showSetupModal && setupProject && <ProjectSetupDialog project={setupProject} client={setupClient} setClient={setSetupClient} contract={setupContract} setContract={setSetupContract} discount={setupDiscount} setDiscount={setSetupDiscount} downPayment={setupDownPayment} setDownPayment={setSetupDownPayment} retentionRate={setupRetentionRate} setRetentionRate={setSetupRetentionRate} retentionMethod={setupRetentionMethod} setRetentionMethod={setSetupRetentionMethod} error={setupError} saving={isSavingSetup} onSubmit={saveProjectSetup} onClose={() => setShowSetupModal(false)} />}
    {isLoading && <div className="workspace-loading" role="status" aria-live="polite" aria-label="Loading SAGACT workspace"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><RefreshCw size={25} /></span><strong>Loading your workspace</strong><span className="loading-caption">Preparing your project overview</span><span className="loading-progress"><span /></span></div>}
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-mark"><BriefcaseBusiness size={19} /></span><span>SAGACT<span className="brand-period">.</span></span></div>
      <div className="side-label">Owner workspace</div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={`nav-item ${view === 'portfolio' ? 'is-active' : ''}`} onClick={() => { setView('portfolio'); setSelectedId(null) }}><LayoutDashboard size={17} /><span>Portfolio</span></button>
        <button className={`nav-item ${view === 'portal' ? 'is-active' : ''}`} onClick={() => { setView('portal'); setSelectedId(null) }}><Users size={17} /><span>Client portal</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="workspace-state"><span className="live-dot" />SAGACT database</div><div className="owner-profile"><div className="owner-avatar">S</div><div><strong>SAGACT</strong><span>Project workspace</span></div><button className="sign-out-button" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={16} /></button></div></div>
    </aside>

    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumbs"><span>SAGACT</span><ChevronRight size={13} /><strong>{view === 'portal' ? 'Client portal' : selected?.name ?? 'Portfolio'}</strong></div>
        <div className="topbar-right"><span className="owner-view"><span className="owner-view-dot" />Owner view</span><span className="topbar-date"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(currentDate)}</span><button className={`icon-button refresh-button ${isLoading ? 'is-loading' : ''}`} aria-label={isLoading ? 'Refreshing workspace' : 'Refresh workspace'} title={isLoading ? 'Refreshing workspace' : 'Refresh workspace'} onClick={refreshWorkspace} disabled={isLoading}><RefreshCw className="refresh-glyph" size={16} /><span className="sr-only" role="status" aria-live="polite">{isLoading ? 'Refreshing workspace' : 'Workspace ready'}</span></button><button className="icon-button notification-button" aria-label="Notifications" title="Notifications"><Bell size={17} /><span className="notification-dot" /></button></div>
      </header>

      <main className="page-content">
        <div key={`${view}:${selectedId ?? 'portfolio'}`} className="view-transition">
        {view === 'portal' ? <ClientPortal projects={projects} onOpenProject={openProject} /> : selected ? <ProjectDetail project={selected} payments={payments.filter((payment) => payment.projectId === selected.id)} onBack={() => setSelectedId(null)} onSetup={() => openProjectSetup(selected)} /> : <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-rule" />Builder's desk <span className="eyebrow-date">{new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(currentDate)}</span></div><h1>Money, in order.</h1><p>A clear view of what’s billed, what’s collected, and what still needs a follow-up.</p></div><div className="heading-actions"><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} />New project</button></div></section>
          {loadError ? <div className="sample-banner" role="alert"><CircleAlert size={15} /><span><strong>Could not load SAGACT data.</strong> {loadError}</span><button className="text-button" onClick={refreshWorkspace}>Retry</button></div> : <div className="sample-banner"><CircleAlert size={15} /><span><strong>Live workspace.</strong> Portfolio figures come from SAGACT’s Supabase database.</span></div>}
          <section className="metric-grid" aria-label="Portfolio totals">
            <Metric icon={<FileText size={16} />} label="Total billed" value={money.format(billed)} foot="Across all projects" tone="green" />
            <Metric icon={<ArrowDownLeft size={16} />} label="Collected" value={money.format(collected)} foot={`${billed ? Math.round(collected / billed * 100) : 0}% of billed`} tone="blue" />
            <Metric icon={<Clock3 size={16} />} label="Receivables due" value={money.format(receivable)} foot="Retention excluded" tone="gold" />
            <Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retention)} foot="Not yet due for release" tone="neutral" />
          </section>
          <section className="portfolio-section"><div className="section-heading"><h2>Projects <span className="count-pill">{projects.length}</span></h2></div>
            <div className="filter-bar"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or clients" aria-label="Search projects or clients" /></label>
              <label className="select-wrap"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option><option>On track</option><option>Needs attention</option><option>Planning</option></select><ChevronDown size={13} /></label>
              <label className="select-wrap"><span className="sr-only">Filter by client</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option>All clients</option>{clients.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label>
              <label className="select-wrap date-filter"><span className="sr-only">Filter by date range</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option>Any time</option><option>Last 30 days</option><option>This quarter</option></select><ChevronDown size={13} /></label></div>
            <div className="project-table"><div className="project-table-head"><span>Project / client</span><span>Contract</span><span>Progress</span><span>Billed</span><span>Collected</span><span>Status</span><span /></div>
              {filtered.length ? filtered.map((project) => <button className="project-row" key={project.id} onClick={() => openProject(project.id)}><span className="project-name-cell"><span className={`project-avatar avatar-${project.prefix.toLowerCase()}`}>{project.name.slice(0, 1)}</span><span className="project-title-stack"><strong>{project.name}</strong><small>{project.client}</small></span></span><span className="money-cell">{money.format(project.contract)}</span><span className="progress-cell"><span className="progress-value">{project.progress}%</span><span className="progress-track"><span style={{ width: `${project.progress}%` }} /></span></span><span className="money-cell">{money.format(project.billed)}</span><span className="money-cell">{money.format(project.collected)}</span><span><StatusBadge status={project.status} /></span><span className="row-arrow"><ChevronRight size={16} /></span></button>) : <div className="empty-state">{projects.length ? 'No projects match those filters.' : 'No projects in this workspace yet. Create one to get started.'}</div>}
              <div className="table-footer"><span>Showing {filtered.length} of {projects.length} projects</span><span>Amounts in PHP</span></div></div>
          </section>
          <section className="lower-grid"><div className="surface-card cashflow-card"><div className="card-heading-row"><div><div className="section-kicker">{new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(currentDate)}</div><h2>Cash in, month to date</h2></div><button className="icon-button small-icon-button" aria-label="Open cash flow details" title="Open cash flow details"><ArrowUpRight size={16} /></button></div><div className="cashflow-total"><strong>{money.format(monthCashIn)}</strong><span className="positive-chip">{payments.length} receipt{payments.length === 1 ? '' : 's'}</span></div>{monthCashIn ? <><div className="bar-chart" aria-label="Monthly cash received from recorded payments">{cashBars.map((height, index) => <span className={index === 11 ? 'bar current-bar' : 'bar'} key={index} style={{ height: `${height}%` }} />)}</div><div className="chart-axis"><span>Start</span><span>Mid-month</span><span>Today</span></div></> : <div className="chart-empty">No payments recorded this month.</div>}</div>
            <div className="surface-card activity-card"><div className="card-heading-row"><div><div className="section-kicker">Latest movement</div><h2>Recent payments</h2></div><button className="text-button compact-button" onClick={() => payments[0] && openProject(payments[0].projectId)} disabled={!payments.length}>View all <ArrowRight size={13} /></button></div><div className="activity-list">{payments.length ? payments.slice(0, 3).map((payment) => <button className="activity-row" key={payment.id} onClick={() => openProject(payment.projectId)}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{projects.find((item) => item.id === payment.projectId)?.name} · {shortDate(payment.date)} · {payment.reference}</small></span><span className="activity-amount">+{money.format(payment.amount)}</span></button>) : <div className="empty-state">No payments recorded yet.</div>}</div><div className="activity-foot"><span className="live-dot" />Receipts recorded from the SAGACT database</div></div></section>
        </>}
        </div>
      </main>
      <footer className="page-footer"><span>SAGACT <span className="footer-dot">·</span> Live workspace</span><span>Clear records. Steady work.</span></footer>
    </div>

    {showModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowModal(false) }}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div className="modal-heading"><div><div className="section-kicker">Project template</div><h2 id="new-project-title">Start a project</h2></div><button className="icon-button" onClick={() => setShowModal(false)} aria-label="Close"><X size={18} /></button></div><p className="modal-intro">Start with the standard payment split and wording. Adjust project terms before the first billing.</p><form onSubmit={createProject}><label className="form-field">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Salo Spot" required /></label><label className="form-field">Client<input list="known-clients" value={client} onChange={(event) => setClient(event.target.value)} placeholder="Choose or add a client" required /><datalist id="known-clients">{clients.map((item) => <option key={item} value={item} />)}</datalist></label><div className="form-row"><label className="form-field">Contract amount<input type="number" min="1" step="1" value={contract} onChange={(event) => setContract(event.target.value)} placeholder="0" required /></label><label className="form-field">Down payment %<input type="number" min="0" max="100" step="0.5" value={downPaymentPercent} onChange={(event) => setDownPaymentPercent(event.target.value)} required /></label></div><div className="form-row"><label className="form-field">Retention rate<select value={retentionRate} onChange={(event) => setRetentionRate(event.target.value)}><option value="5">5% default</option><option value="10">10% client request</option></select></label><label className="form-field">Retention method<select value={retentionMethod} onChange={(event) => setRetentionMethod(event.target.value as 'final_schedule' | 'per_billing')}><option value="final_schedule">Final payment schedule</option><option value="per_billing">Deduct from each billing</option></select></label></div><div className="prefix-preview"><span>Receipt prefix</span><strong>{projectPrefixPreview.length === 3 ? `${projectPrefixPreview}-0001` : '---'}</strong><small>First three letters · locks after first receipt</small></div>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={isCreatingProject}><Plus size={15} />{isCreatingProject ? 'Saving…' : 'Create project'}</button></div></form></section></div>}
  </div>
}

function Metric({ icon, label, value, foot, tone }: { icon: React.ReactNode; label: string; value: string; foot: string; tone: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span className="metric-icon">{icon}</span><span>{label}</span></div><strong className="metric-value">{value}</strong><small>{foot}</small></div>
}
function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`status-badge status-${status.toLowerCase().replace(' ', '-')}`}><span />{status}</span>
}

type ProjectSetupDialogProps = {
  project: Project
  client: string
  setClient: (value: string) => void
  contract: string
  setContract: (value: string) => void
  discount: string
  setDiscount: (value: string) => void
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

function ProjectSetupDialog({ project, client, setClient, contract, setContract, discount, setDiscount, downPayment, setDownPayment, retentionRate, setRetentionRate, retentionMethod, setRetentionMethod, error, saving, onSubmit, onClose }: ProjectSetupDialogProps) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="setup-project-title"><div className="modal-heading"><div><div className="section-kicker">Project financial setup</div><h2 id="setup-project-title">{project.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button></div><p className="modal-intro">Enter confirmed client and contract details. Saved project-specific terms are prefilled.</p><form onSubmit={onSubmit}><label className="form-field">Client name<input autoFocus value={client} onChange={(event) => setClient(event.target.value)} placeholder="Enter the actual client name" minLength={2} required /></label><div className="form-row"><label className="form-field">Contract amount<input type="number" min="0.01" step="0.01" value={contract} onChange={(event) => setContract(event.target.value)} placeholder="0.00" required /></label><label className="form-field">Special discount<input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} required /></label></div><div className="form-row"><label className="form-field">Down payment %<input type="number" min="0" max="100" step="0.5" value={downPayment} onChange={(event) => setDownPayment(event.target.value)} required /></label><label className="form-field">Retention rate<select value={retentionRate} onChange={(event) => setRetentionRate(event.target.value)}><option value="5">5% default</option><option value="10">10% client request</option></select></label></div><label className="form-field">Retention method<select value={retentionMethod} onChange={(event) => setRetentionMethod(event.target.value as 'final_schedule' | 'per_billing')}><option value="final_schedule">Final payment schedule</option><option value="per_billing">Deduct from each billing</option></select></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}><FileText size={15} />{saving ? 'Saving…' : 'Save contract setup'}</button></div></form></section></div>
}

function ProjectDetail({ project, payments, onBack, onSetup }: { project: Project; payments: Payment[]; onBack: () => void; onSetup: () => void }) {
  const [tab, setTab] = useState('Overview')
  const finance = financeForProject(project)
  const due = finance.receivablesDue
  return <div className="detail-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />All projects</button><section className="detail-heading"><div className="detail-title-row"><div className={`detail-avatar avatar-${project.prefix.toLowerCase()}`}>{project.name.slice(0, 1)}</div><div><div className="eyebrow detail-eyebrow">Project overview <span className="eyebrow-date">{project.location}</span></div><h1>{project.name}</h1><p>{project.client}</p></div><StatusBadge status={project.status} /></div><div className="detail-actions">{project.isSetupComplete ? <><button className="button button-secondary" onClick={onSetup}><FileText size={15} />Edit contract</button><button className="button button-primary" onClick={() => setTab('Billings')}><Plus size={15} />Create billing</button></> : <button className="button button-primary" onClick={onSetup}><FileText size={15} />Set up contract</button>}</div></section>
    <div className="detail-tabs" role="tablist" aria-label="Project sections">{['Overview', 'Billings', 'Payments', 'Documents'].map((item) => <button key={item} className={tab === item ? 'tab is-selected' : 'tab'} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}</div>
    <div className="detail-metrics"><Metric icon={<BriefcaseBusiness size={16} />} label="Contract value" value={money.format(project.contract)} foot={`${project.downPaymentPercent}% down payment · ${project.retentionRate}% retention`} tone="green" /><Metric icon={<FileText size={16} />} label="Billed to date" value={money.format(project.billed)} foot={`${project.contract ? Math.round(project.billed / project.contract * 100) : 0}% of contract`} tone="blue" /><Metric icon={<CircleDollarSign size={16} />} label="Collected" value={money.format(project.collected)} foot={`${money.format(due)} receivable`} tone="gold" /><Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(project.retention)} foot="Release conditions pending" tone="neutral" /></div>
    {tab === 'Overview' && <div className="detail-content-grid"><section className="surface-card detail-progress-card"><div className="card-heading-row"><div><div className="section-kicker">Work progress</div><h2>Project health</h2></div><span className="large-progress">{project.progress}<small>%</small></span></div><div className="detail-progress-track"><span style={{ width: `${project.progress}%` }} /></div><div className="progress-caption"><span>Work accomplished</span><strong>{money.format(finance.earnedToDate)} earned</strong></div><div className="milestone-callout"><span className="milestone-icon"><CalendarDays size={16} /></span><span><small>Next milestone</small><strong>{project.milestone}</strong></span><ChevronRight size={16} /></div></section>
      <section className="surface-card receivable-card"><div className="section-kicker">Receivables</div><h2>Balance to follow up</h2><strong className="receivable-total">{money.format(due)}</strong><div className="receivable-divider" /><div className="receivable-line"><span><span className="small-status-dot overdue-dot" />Overdue</span><strong>{money.format(due)}</strong></div><div className="receivable-line"><span><span className="small-status-dot retention-dot" />Retention held</span><strong>{money.format(project.retention)}</strong></div><small className="retention-explainer">Held retention is shown separately and excluded from overdue amounts.</small></section>
      <section className="surface-card detail-activity-card"><div className="card-heading-row"><div><div className="section-kicker">Latest movement</div><h2>Payments received</h2></div><button className="text-button compact-button" onClick={() => setTab('Payments')}>All payments <ArrowRight size={13} /></button></div>{payments.length ? payments.map((payment) => <div className="payment-detail-row" key={payment.id}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span><strong className="activity-amount">{money.format(payment.amount)}</strong></div>) : <div className="empty-state">No payments recorded yet.</div>}</section></div>}
    {tab === 'Billings' && <section className="surface-card tab-content"><div className="card-heading-row"><div><div className="section-kicker">Billing calculation</div><h2>Progress billing balance</h2></div><span className="demo-tag">Current calculation</span></div><div className="billing-calculation"><div><span>Earned work ({project.progress}%)</span><strong>{money.format(finance.earnedToDate)}</strong></div><div><span>Payments received, including down payment</span><strong>− {money.format(project.collected)}</strong></div><div className="billing-calculation-total"><span>Amount for billing</span><strong>{money.format(finance.amountForBilling)}</strong></div><div><span>Billable ceiling before retention release</span><strong>{money.format(finance.billableCeiling)}</strong></div></div><p className="calculation-note">Cumulative earned value less all receipts. Reconcile existing invoices and open balances before issuing a new invoice.</p></section>}
    {tab === 'Payments' && <section className="surface-card tab-content"><div className="card-heading-row"><div><div className="section-kicker">Payment register</div><h2>Received payments</h2></div><button className="button button-primary" disabled title="Payment entry is not connected yet"><Plus size={15} />Log payment</button></div>{payments.length ? payments.map((payment) => <div className="payment-detail-row" key={payment.id}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span><strong className="activity-amount">{money.format(payment.amount)}</strong></div>) : <div className="empty-state">No payments recorded for this project.</div>}</section>}
    {tab === 'Documents' && <section className="surface-card tab-content"><div className="section-kicker">Project files</div><h2>Documents</h2><div className="document-placeholder"><FileText size={19} /><span><strong>No documents uploaded</strong><small>Contracts, plans, billings, and receipts will live here.</small></span><button className="button button-secondary" disabled title="Document storage is not connected yet"><Upload size={14} />Upload file</button></div><p className="calculation-note">Document storage is not connected yet.</p></section>}
  </div>
}

function ClientPortal({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (id: string) => void }) {
  const project = projects[0]
  return <div className="portal-preview"><div className="eyebrow"><span className="eyebrow-rule" />Client access <span className="eyebrow-date">Preview</span></div><section className="portal-header"><div><h1>Client portal</h1><p>A client-safe view of project progress and shared documents.</p></div><span className="portal-preview-pill"><Users size={14} />Preview mode</span></section><div className="sample-banner"><CircleAlert size={15} /><span>This is a visual preview only. Client sign-in and database access rules are not connected.</span></div><div className="portal-project-grid">{projects.map((item) => <button key={item.id} className="portal-project surface-card" onClick={() => onOpenProject(item.id)}><div className="portal-project-top"><span className={`detail-avatar avatar-${item.prefix.toLowerCase()}`}>{item.name.slice(0, 1)}</span><ChevronRight size={16} /></div><div className="section-kicker">{item.client}</div><h2>{item.name}</h2><div className="portal-progress-label"><span>Progress</span><strong>{item.progress}%</strong></div><div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div><div className="portal-milestone"><CalendarDays size={14} />{item.milestone}</div></button>)}</div><section className="surface-card portal-statement"><div className="card-heading-row"><div><div className="section-kicker">Client statement preview</div><h2>{project?.name} · Billing summary</h2></div><FileText size={18} /></div><div className="portal-statement-lines"><div><span>Billings to date</span><strong>{money.format(project?.billed ?? 0)}</strong></div><div><span>Payments received</span><strong className="collected-text">− {money.format(project?.collected ?? 0)}</strong></div><div><span>Balance due</span><strong>{money.format(project ? financeForProject(project).receivablesDue : 0)}</strong></div><div className="statement-retention"><span>Retention held (not yet due)</span><strong>{money.format(project?.retention ?? 0)}</strong></div></div></section></div>
}

export default App
