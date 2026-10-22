import { Suspense, lazy, useState } from 'react'
import { ProjectDetailCover } from './ProjectDetailCover'
import { ArrowDownLeft, ArrowLeft, ArrowRight, Download, Eye, CalendarDays, Check, ChevronRight, CircleAlert, CircleDollarSign, Pencil, FileText, Plus, UserPlus, WalletCards } from 'lucide-react'
import { calculateProjectFinance } from '../finance/project-finance'
import { calculateProfitRisk } from '../finance/profit-risk'
import { getProjectDeadlineStatus } from '../finance/project-deadline'
import { type ReceivableAgingItem } from '../finance/receivables-aging'
import { type ProjectHealthStatus, type ProjectStatus } from '../data/portfolio'
import { PaymentEntryDialog } from '../components/PaymentEntryDialog'
import { ProjectProfitCard } from '../components/ProjectProfitCard'
import { InviteClientDialog } from '../components/InviteClientDialog'
import { ContractImpactCard, ProjectChangeOrderPanel } from '../components/ProjectChangeOrderPanel'
import { ProjectPulse } from '../components/ProjectPulse'
import { useBillingReadiness } from '../data/insights'
import { StatusMenu } from '../components/StatusMenu'
import { CountUp, EmptyArt, ProgressRing, SkeletonRows } from '../components/Motion'
import { formatPaymentType } from '../lib/payment-type'
import { formatChangeOrderNumber } from '../lib/change-order-number'
import { formatBillingNumber } from '../lib/billing-number'
import { Metric } from '../components/ProjectStatusBadges'
import { useProjectCanEdit } from './project-permissions'
import { projectDetailTabs, money, projectStatusMenuOptions, projectHealthMenuOptions, shortDate, projectDate, financeForProject, retentionDueForProject, type Project, type Payment, type ProjectDetailTab } from './project-shared'

const BillingPanel = lazy(() => import('../components/BillingPanel').then((module) => ({ default: module.BillingPanel })))
const ExpensePanel = lazy(() => import('../components/ExpensePanel').then((module) => ({ default: module.ExpensePanel })))
const ProjectDocumentPanel = lazy(() => import('../components/ProjectDocumentPanel').then((module) => ({ default: module.ProjectDocumentPanel })))
const ProjectForecastPanel = lazy(() => import('../components/ProjectForecastPanel').then((module) => ({ default: module.ProjectForecastPanel })))
const ProjectMilestonePanel = lazy(() => import('../components/ProjectMilestonePanel').then((module) => ({ default: module.ProjectMilestonePanel })))

export function ProjectDetail({ project, tab, setTab, payments, receivables, onBack, onSetup, onChanged, onProjectStateChange }: { project: Project; tab: ProjectDetailTab; setTab: (tab: ProjectDetailTab) => void; payments: Payment[]; receivables: ReceivableAgingItem[]; onBack: () => void; onSetup: () => void; onChanged: () => void; onProjectStateChange: (projectId: string, status: ProjectStatus, healthStatus: ProjectHealthStatus) => Promise<void> }) {
  const canEdit = useProjectCanEdit()
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [paymentToEdit, setPaymentToEdit] = useState<Payment | null>(null)
  const [showInviteClient, setShowInviteClient] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [projectStateError, setProjectStateError] = useState('')
  const [isSavingProjectState, setIsSavingProjectState] = useState(false)
  const paymentHistory = payments
  const projectExpenses = project.expenses
  const finance = financeForProject(project)
  const billingReadiness = useBillingReadiness(project.id, `${project.progress}:${project.billed}:${project.collected}`)
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
      const { openPaymentReceiptPdf } = await import('../lib/payment-receipt-pdf')
      await openPaymentReceiptPdf(receiptDetails(payment))
    } catch {
      setReceiptError('Could not preview the acknowledgement receipt.')
    }
  }
  const downloadAcknowledgementReceipt = async (payment: Payment) => {
    setReceiptError('')
    try {
      const { downloadPaymentReceiptPdf } = await import('../lib/payment-receipt-pdf')
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
      <ProjectDetailCover projectId={project.id} storagePath={project.coverPhotoStoragePath} projectName={project.name} onChanged={onChanged} readOnly={!canEdit} />
      <div className="project-detail-hero-body">
        <div className="project-detail-title-row">
          <div><h1>{project.name}</h1><p><span>{project.location}</span>{project.location && project.client ? <span aria-hidden="true"> · </span> : null}<span>{project.client}</span></p></div>
        </div>
        <div className="project-detail-summary-row">
          <StatusMenu label="Project status" value={project.status} disabled={isSavingProjectState || !canEdit} options={projectStatusMenuOptions} onChange={(next) => { void saveProjectState(next, project.healthStatus) }} />
          <StatusMenu label="Project health" value={project.healthStatus} disabled={isSavingProjectState || !canEdit} options={projectHealthMenuOptions} onChange={(next) => { void saveProjectState(project.status, next) }} />
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
        {canEdit && <div className="detail-actions">{project.clientId && <button className="button button-secondary" onClick={() => setShowInviteClient(true)}><UserPlus size={15} />Invite client</button>}{project.isSetupComplete ? <button className="button button-secondary" onClick={onSetup}><FileText size={15} />Edit contract</button> : <button className="button button-primary" onClick={onSetup}><FileText size={15} />Set up contract</button>}</div>}
      </div>
    </div>
  </section>
    {projectStateError && <p className="form-error" role="alert">{projectStateError}</p>}
    <div className="detail-tabs" role="tablist" aria-label="Project sections">{projectDetailTabs.map((item) => <button key={item} className={tab === item ? 'tab is-selected' : 'tab'} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}</div>
    <Suspense fallback={<SkeletonRows rows={4} label="Loading" />}><div key={tab} className="detail-tab-transition">
    {(profitRisk.level === 'high' || profitRisk.level === 'critical') && <div className={`project-risk-callout risk-${profitRisk.level}`} role="status"><CircleAlert size={17} /><span><strong>Profit risk: {profitRisk.label}.</strong> {profitRisk.detail}.</span><button type="button" onClick={() => setTab('Forecast')}>Review forecast <ArrowRight size={14} /></button></div>}
    {tab === 'Overview' && <>
      <ProjectPulse progress={project.progress} startDate={project.startDate ?? project.createdAt} deadline={project.deadline} isClosed={project.status === 'completed' || project.status === 'closed'} milestones={project.milestones} costBudget={project.costBudget} recordedCosts={project.outflow} outstanding={due} pendingChangeOrders={project.changeOrders.filter((order) => order.status === 'pending_approval').length} receivables={receivables} readiness={billingReadiness} onOpenTab={setTab} />
      <section className="surface-card detail-progress-card"><div className="card-heading-row"><h2>Project health</h2><ProgressRing value={project.progress} /></div><div className="detail-progress-track"><span style={{ width: `${project.progress}%` }} /></div><div className="progress-caption"><span>Work accomplished</span><strong>{money.format(finance.earnedToDate)} earned</strong></div>{(() => {
        const todayKey = new Date().toLocaleDateString('en-CA')
        const next = [...project.milestones]
          .filter((milestone) => milestone.completionPercent < 100 && milestone.status !== 'complete')
          .sort((left, right) => (left.plannedDate ?? '9999').localeCompare(right.plannedDate ?? '9999'))[0]
        if (!next) return <button type="button" className="next-milestone is-done" onClick={() => setTab('Milestones')} aria-label="Open milestones">
          <span className="next-milestone-icon"><Check size={16} /></span>
          <span className="next-milestone-copy"><small>Milestones</small><strong>{project.milestones.length ? 'All milestones complete' : 'No milestones yet — add the first one'}</strong></span>
          <ChevronRight size={16} className="next-milestone-chevron" />
        </button>
        const days = next.plannedDate ? Math.round((new Date(`${next.plannedDate}T00:00:00`).getTime() - new Date(`${todayKey}T00:00:00`).getTime()) / 86_400_000) : null
        const tone = days === null ? 'calm' : days < 0 ? 'late' : days <= 3 ? 'soon' : 'calm'
        const due = days === null ? 'No target date' : days < 0 ? `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `In ${days} days`
        const percent = Math.round(next.completionPercent)
        return <button type="button" className={`next-milestone is-${tone}`} onClick={() => setTab('Milestones')} aria-label={`Open milestones. Next milestone: ${next.name}, ${due}, ${percent}% complete`}>
          <span className="next-milestone-icon"><CalendarDays size={16} /></span>
          <span className="next-milestone-copy">
            <span className="next-milestone-top"><small>Next milestone</small><em>{due}{next.plannedDate ? ` · ${shortDate(next.plannedDate)}` : ''}</em></span>
            <strong>{next.name}</strong>
            <span className="next-milestone-progress"><span><i style={{ width: `${percent}%` }} /></span><b>{percent}%</b></span>
          </span>
          <ChevronRight size={16} className="next-milestone-chevron" />
        </button>
      })()}</section>
      <ProjectProfitCard contractValue={finance.contractValue} recordedCosts={project.outflow} costBudget={project.costBudget} estimatedCostToComplete={project.estimatedCostToComplete} progressPercent={project.progress} onOpenForecast={() => setTab('Forecast')} onOpenExpenses={() => setTab('Expenses')} />
      <section className="detail-financial-section fin-section" aria-labelledby="detail-financial-heading">
        <div className="detail-financial-heading"><h2 id="detail-financial-heading">Financial overview</h2></div>
        <div className="surface-card fin-layout">
          <ContractImpactCard contractAmount={project.contract} specialDiscount={project.specialDiscount} changeOrders={project.changeOrders} changeOrderOutstanding={changeOrderReceivable} footnote={`${project.downPaymentPercent}% down payment · ${project.retentionRate}% retention`} onOpenChangeOrders={() => setTab('Change orders')} />
          <div className="detail-metrics fin-metrics">
            <div className="metric-card metric-blue">
              <div className="metric-top"><span className="metric-icon"><FileText size={16} /></span><span>Billed to date</span></div>
              <strong className="metric-value"><CountUp value={money.format(project.billed)} /></strong>
              <small>{finance.contractValue ? Math.round(project.billed / finance.contractValue * 100) : 0}% of revised contract</small>
              {approvedChangeOrderTotal > 0 && <ul className="fin-balance-lines">
                <li><span>Contract</span><span>{money.format(project.billed - approvedChangeOrderTotal)}</span></li>
                <li><span>Change orders</span><span>{money.format(approvedChangeOrderTotal)}</span></li>
              </ul>}
            </div>
            <div className="metric-card metric-green">
              <div className="metric-top"><span className="metric-icon"><CircleDollarSign size={16} /></span><span>Collected</span></div>
              <strong className="metric-value"><CountUp value={money.format(project.collected)} /></strong>
              <small>{finance.contractValue ? Math.round(project.collected / finance.contractValue * 100) : 0}% of revised contract</small>
              {approvedChangeOrderTotal > 0 && <ul className="fin-balance-lines">
                <li><span>Contract</span><span>{money.format(Math.max(0, project.collected - Math.max(0, approvedChangeOrderTotal - changeOrderReceivable)))}</span></li>
                <li><span>Change orders</span><span>{money.format(Math.max(0, approvedChangeOrderTotal - changeOrderReceivable))}</span></li>
              </ul>}
            </div>
            <Metric icon={<WalletCards size={16} />} label="Retention held" value={money.format(retentionHeld)} foot="Released one month after completion" tone="neutral" />
            <div className={`metric-card fin-balance ${due > 0 ? 'has-balance' : 'is-settled'}`}>
              <div className="metric-top"><span className="metric-icon">{due > 0 ? <CircleAlert size={16} /> : <Check size={16} />}</span><span>Balance outstanding</span></div>
              <strong className="metric-value">{due > 0 ? <CountUp value={money.format(due)} /> : 'Fully settled'}</strong>
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
            {canEdit && <button type="button" className="pay-action" aria-label={`Edit payment ${payment.receiptNumber ?? ''}`} title="Edit payment" onClick={() => { setShowPaymentDialog(false); setPaymentToEdit(payment) }}><Pencil size={14} /><span>Edit</span></button>}
            {payment.receiptNumber && <button type="button" className="pay-action" aria-label={`View acknowledgement receipt ${payment.receiptNumber}`} title="View receipt" onClick={() => { void viewAcknowledgementReceipt(payment) }}><Eye size={14} /><span>Receipt</span></button>}
            {payment.receiptNumber && <button type="button" className="pay-action is-icon" aria-label={`Download acknowledgement receipt ${payment.receiptNumber}`} title="Download receipt PDF" onClick={() => { void downloadAcknowledgementReceipt(payment) }}><Download size={14} /></button>}
          </span>
        </div>
      })}</div> : <div className="pr-empty"><EmptyArt kind="wallet" /><strong>No payments yet</strong><p>Payments you log for this project will appear here with their receipts.</p></div>}
    </section>}
    {tab === 'Expenses' && <ExpensePanel projectId={project.id} projectName={project.name} expenses={projectExpenses} inflow={project.collected} onChanged={onChanged} />}
    {tab === 'Forecast' && <ProjectForecastPanel projectId={project.id} contractValue={finance.contractValue} recordedCosts={project.outflow} costBudget={project.costBudget} estimatedCostToComplete={project.estimatedCostToComplete} onChanged={onChanged} />}
    {tab === 'Documents' && <ProjectDocumentPanel projectId={project.id} />}
    </div></Suspense>
  </div>
}

