import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BriefcaseBusiness, Download, Eye,
  CalendarDays, ChevronRight, CircleAlert, CircleDollarSign,
  FileText, LayoutDashboard, LogOut, Plus, RefreshCw, UserPlus, Users, WalletCards, X,
} from 'lucide-react'
import { calculateProjectFinance } from './finance/project-finance'
import { calculateProfitRisk } from './finance/profit-risk'
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
import { ProjectDeadlinePanel } from './components/ProjectDeadlinePanel'
import { NotificationCenter } from './components/NotificationCenter'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from './lib/payment-receipt-pdf'
import { PortfolioOverview } from './components/PortfolioOverview'
import { Metric } from './components/ProjectStatusBadges'
import './App.css'

type Project = PortfolioProject
type Payment = PortfolioPayment
const appLoadedAt = Date.now()
const appLoadedDate = new Date(appLoadedAt)
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
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [receivables, setReceivables] = useState<ReceivableAgingItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'portfolio' | 'portal'>('portfolio')
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
    if (location.trim().length < 2) { setFormError('Enter the project location.'); return }
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
        location: location.trim(),
        prefix,
        contractAmount: amount,
        downPaymentPercent: Number(downPaymentPercent),
        retentionRatePercent: Number(retentionRate),
        retentionMethod,
      })
      setSelectedId(projectId)
      setView('portfolio')
      setShowModal(false)
      setName(''); setClient(''); setLocation(''); setContract(''); setDownPaymentPercent('0'); setRetentionRate('5'); setRetentionMethod('final_schedule')
      refreshWorkspace()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the project.')
    } finally {
      setIsCreatingProject(false)
    }
  }


  return <div className="app-shell" aria-busy={isLoading}>
    {showSetupModal && setupProject && <ProjectSetupDialog project={setupProject} client={setupClient} setClient={setSetupClient} contract={setupContract} setContract={setSetupContract} discount={setupDiscount} setDiscount={setSetupDiscount} downPayment={setupDownPayment} setDownPayment={setSetupDownPayment} retentionRate={setupRetentionRate} setRetentionRate={setSetupRetentionRate} retentionMethod={setupRetentionMethod} setRetentionMethod={setSetupRetentionMethod} error={setupError} saving={isSavingSetup} onSubmit={saveProjectSetup} onClose={() => setShowSetupModal(false)} />}
    {showDashboardExpense && <ExpenseEntryDialog projects={projects.map((project) => ({ id: project.id, name: project.name }))} onClose={() => setShowDashboardExpense(false)} onSaved={() => { setShowDashboardExpense(false); refreshWorkspace() }} />}
    {isLoading && <div className="workspace-loading" role="status" aria-live="polite" aria-label="Loading SAGACT workspace"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><RefreshCw size={25} /></span><strong>Loading your workspace</strong><span className="loading-caption">Preparing your project overview</span><span className="loading-progress"><span /></span></div>}
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-mark"><img src="/sagact-mark.svg" alt="" /></span><span>SAGACT<span className="brand-period">.</span></span></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={`nav-item ${view === 'portfolio' ? 'is-active' : ''}`} onClick={() => { setView('portfolio'); setSelectedId(null) }}><LayoutDashboard size={17} /><span>Portfolio</span></button>
        <button className={`nav-item ${view === 'portal' ? 'is-active' : ''}`} onClick={() => { setView('portal'); setSelectedId(null) }}><Users size={17} /><span>Client portal</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="workspace-state"><span className="live-dot" />SAGACT database</div><div className="owner-profile"><div className="owner-avatar">S</div><div><strong>SAGACT</strong><span>Project workspace</span></div><button className="sign-out-button" type="button" aria-label="Sign out" title="Sign out" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={16} /></button></div></div>
    </aside>

    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumbs"><span>SAGACT</span><ChevronRight size={13} /><strong>{view === 'portal' ? 'Client portal' : selected?.name ?? 'Portfolio'}</strong></div>
        <div className="topbar-right"><span className="topbar-date"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(currentDate)}</span><button className={`icon-button refresh-button ${isLoading ? 'is-loading' : ''}`} aria-label={isLoading ? 'Refreshing workspace' : 'Refresh workspace'} title={isLoading ? 'Refreshing workspace' : 'Workspace ready'} onClick={refreshWorkspace} disabled={isLoading}><RefreshCw className="refresh-glyph" size={16} /><span className="sr-only" role="status" aria-live="polite">{isLoading ? 'Refreshing workspace' : 'Workspace ready'}</span></button><NotificationCenter projects={projects} receivables={receivables} onOpenProject={openProject} /></div>
      </header>

      <main className="page-content">
        <div key={`${view}:${selectedId ?? 'portfolio'}`} className="view-transition">
        {view === 'portal' ? <ClientPortal projects={projects} onOpenProject={openProject} /> : selected ? <ProjectDetail project={selected} payments={payments.filter((payment) => payment.projectId === selected.id)} onBack={() => setSelectedId(null)} onSetup={() => openProjectSetup(selected)} onChanged={refreshWorkspace} /> : <PortfolioOverview projects={projects} payments={payments} receivables={receivables} filtered={filtered} currentDate={currentDate} loadError={loadError} attentionCount={attentionCount} billed={billed} collected={collected} totalExpenses={totalExpenses} receivable={receivable} retention={retention} search={search} statusFilter={statusFilter} healthFilter={healthFilter} profitRiskFilter={profitRiskFilter} dateFilter={dateFilter} monthCashIn={monthCashIn} cashBars={cashBars} isLoading={isLoading} setSearch={setSearch} setStatusFilter={setStatusFilter} setHealthFilter={setHealthFilter} setProfitRiskFilter={setProfitRiskFilter} setDateFilter={setDateFilter} setShowDashboardExpense={setShowDashboardExpense} setShowModal={setShowModal} refreshWorkspace={refreshWorkspace} openProject={openProject} />}
        </div>
      </main>
      <footer className="page-footer"><span>SAGACT <span className="footer-dot">·</span> Live workspace</span><span>Clear records. Steady work.</span></footer>
    </div>

    {showModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowModal(false) }}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div className="modal-heading"><div><h2 id="new-project-title">Start a project</h2></div><button className="icon-button" onClick={() => setShowModal(false)} aria-label="Close"><X size={18} /></button></div><form onSubmit={createProject}><label className="form-field">Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Salo Spot" required /></label><label className="form-field">Client<input list="known-clients" value={client} onChange={(event) => setClient(event.target.value)} placeholder="Choose or add a client" required /><datalist id="known-clients">{clients.map((item) => <option key={item} value={item} />)}</datalist></label><label className="form-field">Project location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or project address" maxLength={200} minLength={2} required /></label><div className="form-row"><label className="form-field">Contract amount<input type="number" min="1" step="1" value={contract} onChange={(event) => setContract(event.target.value)} placeholder="0" required /></label><label className="form-field">Down payment %<input type="number" min="0" max="100" step="0.5" value={downPaymentPercent} onChange={(event) => setDownPaymentPercent(event.target.value)} required /></label></div><div className="form-row"><label className="form-field">Retention rate<select value={retentionRate} onChange={(event) => setRetentionRate(event.target.value as '5' | '10')}><option value="5">5% default</option><option value="10">10% client request</option></select></label><label className="form-field">Retention method<select value={retentionMethod} onChange={(event) => setRetentionMethod(event.target.value as 'final_schedule' | 'per_billing')}><option value="final_schedule">Final payment schedule</option><option value="per_billing">Deduct from each billing</option></select></label></div>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={isCreatingProject}><Plus size={15} />{isCreatingProject ? 'Saving…' : 'Create project'}</button></div></form></section></div>}
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

function ProjectDetail({ project, payments, onBack, onSetup, onChanged }: { project: Project; payments: Payment[]; onBack: () => void; onSetup: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState('Overview')
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [showInviteClient, setShowInviteClient] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [projectStateError, setProjectStateError] = useState('')
  const [isSavingProjectState, setIsSavingProjectState] = useState(false)
  const finance = financeForProject(project)
  const profitRisk = calculateProfitRisk({
    contractValue: finance.contractValue,
    recordedCosts: project.outflow,
    costBudget: project.costBudget,
    estimatedCostToComplete: project.estimatedCostToComplete,
  })
  const retentionDue = retentionDueForProject(project)
  const retentionHeld = Math.max(0, project.retention - retentionDue)
  const due = finance.receivablesDue + retentionDue
  const saveProjectState = async (status: ProjectStatus, healthStatus: ProjectHealthStatus) => {
    setIsSavingProjectState(true)
    setProjectStateError('')
    try {
      await updateProjectState({ projectId: project.id, status, healthStatus })
      onChanged()
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
  return <div className="detail-page">{showInviteClient && project.clientId && <InviteClientDialog projectId={project.id} projectName={project.name} clientName={project.client} clientEmail={project.clientEmail} onClose={() => setShowInviteClient(false)} />}<button className="back-link" onClick={onBack}><ArrowLeft size={15} />All projects</button><section className="detail-heading">
    <div className="detail-title-row"><div className={`detail-avatar avatar-${project.prefix.toLowerCase()}`}>{project.name.slice(0, 1)}</div><div><div className="eyebrow detail-eyebrow">Project overview <span className="eyebrow-date">{project.location}</span></div><h1>{project.name}</h1><p>{project.client}</p></div></div>
    <div className="detail-status-row"><div className="project-state-controls"><label className="project-state-control"><span>Project status</span><select aria-label="Project status" value={project.status} disabled={isSavingProjectState} onChange={(event) => { void saveProjectState(event.target.value as ProjectStatus, project.healthStatus) }}>{projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="project-state-control"><span>Health</span><select aria-label="Project health" value={project.healthStatus} disabled={isSavingProjectState} onChange={(event) => { void saveProjectState(project.status, event.target.value as ProjectHealthStatus) }}>{projectHealthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><div className="detail-actions">{project.clientId && <button className="button button-secondary" onClick={() => setShowInviteClient(true)}><UserPlus size={15} />Invite client</button>}{project.isSetupComplete ? <button className="button button-secondary" onClick={onSetup}><FileText size={15} />Edit contract</button> : <button className="button button-primary" onClick={onSetup}><FileText size={15} />Set up contract</button>}</div></div>
  </section>
    {projectStateError && <p className="form-error" role="alert">{projectStateError}</p>}
    <div className="detail-tabs" role="tablist" aria-label="Project sections">{['Overview', 'Billings', 'Payments', 'Expenses', 'Forecast', 'Documents'].map((item) => <button key={item} className={tab === item ? 'tab is-selected' : 'tab'} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}</div>
    <div className="detail-metrics"><Metric icon={<BriefcaseBusiness size={16} />} label="Contract value" value={money.format(project.contract)} foot={`${project.downPaymentPercent}% down payment · ${project.retentionRate}% retention`} tone="green" /><Metric icon={<FileText size={16} />} label="Billed to date" value={money.format(project.billed)} foot={`${project.contract ? Math.round(project.billed / project.contract * 100) : 0}% of contract incl. down payment`} tone="blue" /><Metric icon={<CircleDollarSign size={16} />} label="Collected" value={money.format(project.collected)} foot={`${money.format(due)} receivable`} tone="gold" /><Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retentionHeld)} foot="Release conditions pending" tone="neutral" /><Metric icon={<CircleAlert size={16} />} label="Profit risk" value={profitRisk.label} foot={profitRisk.detail} tone={profitRisk.tone} /></div>
    {tab === 'Overview' && <div className="detail-content-grid"><section className="surface-card detail-progress-card"><div className="card-heading-row"><div><div className="section-kicker">Work progress</div><h2>Project health</h2></div><span className="large-progress">{project.progress}<small>%</small></span></div><div className="detail-progress-track"><span style={{ width: `${project.progress}%` }} /></div><div className="progress-caption"><span>Work accomplished</span><strong>{money.format(finance.earnedToDate)} earned</strong></div><div className="milestone-callout"><span className="milestone-icon"><CalendarDays size={16} /></span><span><small>Next milestone</small><strong>{project.milestone}</strong></span><ChevronRight size={16} /></div></section>
      <section className="surface-card receivable-card"><div className="section-kicker">Receivables</div><h2>Balance to follow up</h2><strong className="receivable-total">{money.format(due)}</strong><div className="receivable-divider" /><div className="receivable-line"><span><span className="small-status-dot overdue-dot" />Billing receivable</span><strong>{money.format(finance.receivablesDue)}</strong></div><div className="receivable-line"><span><span className="small-status-dot retention-dot" />Retention release due</span><strong>{money.format(retentionDue)}</strong></div><div className="receivable-line"><span><span className="small-status-dot retention-dot" />Retention held</span><strong>{money.format(retentionHeld)}</strong></div><small className="retention-explainer">Retention becomes receivable one month after project completion.</small></section>
      <section className="surface-card detail-activity-card"><div className="card-heading-row"><div><h2>Payments received</h2></div><button className="text-button compact-button" onClick={() => setTab('Payments')}>All payments <ArrowRight size={13} /></button></div>{payments.length ? <div className="detail-recent-payments-list">{payments.map((payment) => <div className="payment-detail-row" key={payment.id}><span className="activity-icon"><ArrowDownLeft size={15} /></span><span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span><strong className="activity-amount">{money.format(payment.amount)}</strong></div>)}</div> : <div className="empty-state">No payments recorded yet.</div>}</section></div>}
    {tab === 'Billings' && <BillingPanel projectId={project.id} projectName={project.name} clientName={project.client} location={project.location} progress={project.progress} earned={finance.earnedToDate} ceiling={finance.billableCeiling} isSetupComplete={project.isSetupComplete} onChanged={onChanged} />}
    {tab === 'Payments' && <section className="surface-card tab-content">
      <div className="card-heading-row"><div><div className="section-kicker">Payment register</div><h2>Received payments</h2></div><button className="button button-primary" onClick={() => setShowPaymentDialog(true)}><Plus size={15} />Log payment</button></div>
      {showPaymentDialog && <PaymentEntryDialog project={project} onClose={() => setShowPaymentDialog(false)} onSaved={onChanged} />}
      {receiptError && <p className="form-error" role="alert">{receiptError}</p>}
      {payments.length ? <div className="payment-register-list">{payments.map((payment) => <div className="payment-detail-row" key={payment.id}>
        <span className="activity-icon"><ArrowDownLeft size={15} /></span>
        <span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span>
        <strong className="activity-amount">{money.format(payment.amount)}</strong>
        {payment.receiptNumber && <button type="button" className="text-button compact-button" aria-label={`View acknowledgement receipt ${payment.receiptNumber}`} title="View acknowledgement receipt" onClick={() => { void viewAcknowledgementReceipt(payment) }}><Eye size={14} />View</button>}
        {payment.receiptNumber && <button type="button" className="text-button compact-button" aria-label={`Download acknowledgement receipt ${payment.receiptNumber}`} title="Download acknowledgement receipt" onClick={() => { void downloadAcknowledgementReceipt(payment) }}><Download size={14} /></button>}
      </div>)}</div> : <div className="empty-state">No payments recorded for this project.</div>}
    </section>}
    {tab === 'Expenses' && <ExpensePanel projectId={project.id} projectName={project.name} expenses={project.expenses} inflow={project.collected} onChanged={onChanged} />}
    {tab === 'Forecast' && <ProjectForecastPanel projectId={project.id} contractValue={finance.contractValue} recordedCosts={project.outflow} costBudget={project.costBudget} estimatedCostToComplete={project.estimatedCostToComplete} onChanged={onChanged} />}
    {tab === 'Overview' && <ProjectDeadlinePanel key={project.deadline ?? 'no-deadline'} projectId={project.id} deadline={project.deadline} status={project.status} onChanged={onChanged} />}
    {tab === 'Documents' && <ProjectDocumentPanel projectId={project.id} />}
  </div>
}

function ClientPortal({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (id: string) => void }) {
  const project = projects[0]
  return <div className="portal-preview"><div className="eyebrow"><span className="eyebrow-rule" />Client access <span className="eyebrow-date">Preview</span></div><section className="portal-header"><div><h1>Client portal</h1><p>A client-safe view of project progress and shared documents.</p></div><span className="portal-preview-pill"><Users size={14} />Preview mode</span></section><div className="sample-banner"><CircleAlert size={15} /><span>This is a visual preview only. Client sign-in and database access rules are not connected.</span></div><div className="portal-project-grid">{projects.map((item) => <button key={item.id} className="portal-project surface-card" onClick={() => onOpenProject(item.id)}><div className="portal-project-top"><span className={`detail-avatar avatar-${item.prefix.toLowerCase()}`}>{item.name.slice(0, 1)}</span><ChevronRight size={16} /></div><div className="section-kicker">{item.client}</div><h2>{item.name}</h2><div className="portal-progress-label"><span>Progress</span><strong>{item.progress}%</strong></div><div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div><div className="portal-milestone"><CalendarDays size={14} />{item.milestone}</div></button>)}</div><section className="surface-card portal-statement"><div className="card-heading-row"><div><div className="section-kicker">Client statement preview</div><h2>{project?.name} · Billing summary</h2></div><FileText size={18} /></div><div className="portal-statement-lines"><div><span>Billings to date</span><strong>{money.format(project?.billed ?? 0)}</strong></div><div><span>Payments received</span><strong className="collected-text">− {money.format(project?.collected ?? 0)}</strong></div><div><span>Balance due</span><strong>{money.format(project ? financeForProject(project).receivablesDue : 0)}</strong></div><div className="statement-retention"><span>Retention held (not yet due)</span><strong>{money.format(project?.retention ?? 0)}</strong></div></div></section></div>
}

export default App
