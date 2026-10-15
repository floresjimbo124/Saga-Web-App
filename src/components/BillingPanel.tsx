import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useBillingReadiness } from '../data/insights'
import { createPortal } from 'react-dom'
import { Download, Eye, Plus, X } from 'lucide-react'
import {
  issueProjectBilling,
  loadProjectBillings,
  updateProjectProgress,
  voidProjectBilling,
  type ProjectBilling,
} from '../data/billing'
import { downloadBillingPdf, openBillingPdf } from '../lib/billing-pdf'
import { formatBillingNumber } from '../lib/billing-number'
import { useToast } from './toast-context'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: '2-digit', year: 'numeric' })

export function BillingPanel({ projectId, contractId, projectName, clientName, location, progress, earned, ceiling, isSetupComplete, downPaymentAmount = 0, downPaymentPercent, onChanged }: {
  projectId: string
  contractId?: string
  projectName: string
  clientName: string
  location: string
  progress: number
  earned: number
  ceiling: number
  isSetupComplete: boolean
  downPaymentAmount?: number
  downPaymentPercent?: number
  onChanged: () => void
}) {
  const { showToast } = useToast()
  const [billings, setBillings] = useState<ProjectBilling[]>([])
  const readiness = useBillingReadiness(projectId, `${progress}:${billings.length}:${billings.filter((billing) => billing.status === 'issued').length}`)
  const showReadiness = !contractId && readiness !== null
  const [progressInput, setProgressInput] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [isCreateBillingOpen, setIsCreateBillingOpen] = useState(false)
  const [billingToVoid, setBillingToVoid] = useState<ProjectBilling | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setBillings(await loadProjectBillings(projectId, contractId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load billings.')
    }
  }, [projectId, contractId])

  // This list is populated from the database and intentionally refreshed after the async fetch resolves.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refresh() }, [refresh])

  const run = async (
    action: () => Promise<string>,
    onActionError = setError,
    toastAction: 'create' | 'update' | 'delete' = 'create',
  ): Promise<boolean> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const successMessage = await action()
      setMessage(successMessage)
      showToast(successMessage, toastAction)
      await refresh()
      onChanged()
      return true
    } catch (actionError) {
      onActionError(actionError instanceof Error ? actionError.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveProgress = () => {
    const value = Number(progressInput ?? progress)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError('Enter a progress value from 0 to 100.')
      return
    }
    void run(async () => {
      await updateProjectProgress({ projectId, contractId, progressPercent: value })
      setProgressInput(null)
      return `Progress updated to ${value}%.`
    }, setError, 'update')
  }

  const issueBilling = async () => {
    const pending = progressInput === null ? null : Number(progressInput)
    if (pending !== null && (!Number.isFinite(pending) || pending < 0 || pending > 100)) {
      setError('Enter a progress value from 0 to 100.')
      return
    }
    const issued = await run(async () => {
      // Save any progress value typed but not yet saved, so the billing uses it.
      if (pending !== null && pending !== progress) {
        await updateProjectProgress({ projectId, contractId, progressPercent: pending })
      }
      setProgressInput(null)
      const result = await issueProjectBilling(projectId, dueDate || null, contractId)
      return `Billing #${formatBillingNumber(result.billingNumber)} issued for ${money.format(result.amount)}.`
    })
    if (issued) setIsCreateBillingOpen(false)
  }

  const confirmVoidBilling = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!billingToVoid) return
    const reason = voidReason.trim()
    if (reason.length < 3) {
      setVoidError('Enter a reason with at least three characters.')
      return
    }
    const billing = billingToVoid
    setVoidError('')
    void run(async () => {
      await voidProjectBilling(billing.id, reason)
      setBillingToVoid(null)
      setVoidReason('')
      return `Billing #${formatBillingNumber(billing.billingNumber)} voided.`
    }, setVoidError, 'update')
  }

  const issuedBillings = billings.filter((billing) => billing.status === 'issued')
  const issuedCount = issuedBillings.length
  const billedTotal = downPaymentAmount + issuedBillings.reduce((sum, billing) => sum + billing.amount, 0)

  return <>
  {isCreateBillingOpen && createPortal(<div className="modal-backdrop billing-create-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setIsCreateBillingOpen(false) }}>
    <section className="project-modal billing-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-billing-title">
      <div className="modal-heading">
        <div><div className="section-kicker">Progress billing</div><h2 id="create-billing-title">Create billing</h2></div>
        <button className="icon-button" type="button" onClick={() => setIsCreateBillingOpen(false)} aria-label="Close" disabled={busy}><X size={18} /></button>
      </div>
      <p className="modal-intro">Update completed work and choose an optional due date before issuing a billing.</p>
      <div className="billing-dialog-summary">
        <span>Current progress<strong>{progress}%</strong></span>
        <span>Earned to date<strong>{money.format(earned)}</strong></span>
        <span>Billable ceiling<strong>{money.format(ceiling)}</strong></span>
      </div>
      <div className="form-row billing-create-fields">
        <label className="form-field">Work completed (%)<input type="number" min="0" max="100" step="0.01" value={progressInput ?? String(progress)} onChange={(event) => setProgressInput(event.target.value)} /></label>
        <label className="form-field">Due date (optional)<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="calculation-note" role="status">{message}</p>}
      <div className="modal-actions billing-create-actions">
        <button type="button" className="button button-secondary" onClick={saveProgress} disabled={busy || progressInput === null}>Save progress</button>
        <button type="button" className="button button-primary" onClick={() => { void issueBilling() }} disabled={busy || !isSetupComplete}><Plus size={15} />{busy ? 'Issuing…' : 'Issue billing'}</button>
      </div>
    </section>
  </div>, document.body)}
  {billingToVoid && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setBillingToVoid(null) }}>
    <section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="void-billing-title">
      <div className="modal-heading"><div><div className="section-kicker">Billing adjustment</div><h2 id="void-billing-title">Void billing #{formatBillingNumber(billingToVoid.billingNumber)}</h2></div><button className="icon-button" type="button" onClick={() => setBillingToVoid(null)} aria-label="Close" disabled={busy}><X size={18} /></button></div>
      <p className="modal-intro">This billing will be marked void. Enter a reason for the project record.</p>
      <form onSubmit={confirmVoidBilling}>
        <label className="form-field">Reason for voiding<textarea autoFocus value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Enter the reason" minLength={3} maxLength={500} required /></label>
        {voidError && <p className="form-error" role="alert">{voidError}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setBillingToVoid(null)} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Voiding…' : 'Void billing'}</button></div>
      </form>
    </section>
  </div>, document.body)}
  <section className="surface-card tab-content billing-panel bl-panel">
    <div className="card-heading-row billing-panel-heading">
      <div><h2>{contractId ? 'Contract progress billing' : 'Progress billing'}</h2><p>{progress}% complete · {money.format(earned)} earned</p></div>
      <button type="button" className="button button-primary" onClick={() => { setProgressInput(null); setError(''); setIsCreateBillingOpen(true) }} disabled={!isSetupComplete}><Plus size={15} />Create billing</button>
    </div>
    {isSetupComplete ? <div className={`ex-stats bl-stats${showReadiness ? ' has-ready' : ''}`} aria-label="Billing summary">
      <div><span>Earned to date</span><strong>{money.format(earned)}</strong><small>{progress}% of work complete</small></div>
      <div><span>Billed so far</span><strong>{money.format(billedTotal)}</strong><small>Down payment + {issuedCount} billing{issuedCount === 1 ? '' : 's'}</small></div>
      <div><span>Billable ceiling</span><strong>{money.format(ceiling)}</strong><small>Most you can bill before retention</small></div>
      {showReadiness && <div className={readiness.readyAmount > 0 ? 'bl-ready is-ready' : 'bl-ready'}><span>Ready to bill</span><strong>{money.format(readiness.readyAmount)}</strong><small>{readiness.readyAmount > 0 ? 'Create a billing to send this now' : readiness.progressNeededPercent !== null ? `Bill again once progress passes ${Math.ceil(readiness.progressNeededPercent)}%` : 'Everything billable is covered'}</small></div>}
    </div> : <p className="calculation-note">Set up the contract amount before issuing a billing.</p>}
    {message && <p className="calculation-note" role="status">{message}</p>}
    <div className="bl-list-heading"><h3>Billings issued</h3></div>
    {billings.length || downPaymentAmount > 0 ? <div className="billing-register-list billing-timeline" role="list" aria-label="Issued billings">
      {downPaymentAmount > 0 && <div className="payment-detail-row billing-register-row" role="listitem">
        <span className="activity-copy"><strong>Contract down payment{downPaymentPercent === undefined ? '' : ` · ${downPaymentPercent}%`}</strong><small>Part of contract</small></span>
        <strong className="activity-amount">{money.format(downPaymentAmount)}</strong>
        <span className="billing-row-actions">
          <button type="button" className="text-button compact-button" aria-label="Preview contract down-payment billing" onClick={() => { void openBillingPdf({ projectName, clientName, location, billingType: 'down-payment', amount: downPaymentAmount, downPaymentPercent, progressPercent: 0, issuedAt: new Date().toISOString(), dueAt: null }).catch(() => setError('Could not preview the down-payment billing PDF.')) }}><Eye size={14} />View</button>
          <button type="button" className="text-button compact-button" aria-label="Download contract down-payment billing" title="Download down-payment billing PDF" onClick={() => { void downloadBillingPdf({ projectName, clientName, location, billingType: 'down-payment', amount: downPaymentAmount, downPaymentPercent, progressPercent: 0, issuedAt: new Date().toISOString(), dueAt: null }).catch(() => setError('Could not download the down-payment billing PDF.')) }}><Download size={14} /></button>
        </span>
      </div>}
      {billings.map((billing) => <div className={`payment-detail-row billing-register-row${billing.status === 'void' ? ' is-void' : ''}`} key={billing.id} role="listitem">
      <span className="activity-copy"><strong>Billing #{formatBillingNumber(billing.billingNumber)} · {billing.progressPercent}% complete{billing.status === 'void' ? ' · VOID' : ''}</strong><small>{billing.issuedAt ? dateFormat.format(new Date(billing.issuedAt)) : 'Not issued'}{billing.dueAt ? ` · due ${dateFormat.format(new Date(`${billing.dueAt}T12:00:00`))}` : ''}{billing.voidReason ? ` · ${billing.voidReason}` : ''}</small></span>
      <strong className="activity-amount">{money.format(billing.amount)}</strong>
      <span className="billing-row-actions">
      {billing.status === 'issued' && <button type="button" className="text-button compact-button" onClick={() => { void openBillingPdf({ projectName, clientName, location, billingNumber: billing.billingNumber, amount: billing.amount, progressPercent: billing.progressPercent, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }).catch(() => setError('Could not preview the billing PDF.')) }}><Eye size={14} />View</button>}
      {billing.status === 'issued' && <button type="button" className="text-button compact-button" aria-label={`Download billing ${formatBillingNumber(billing.billingNumber)}`} title="Download billing PDF" onClick={() => { void downloadBillingPdf({ projectName, clientName, location, billingNumber: billing.billingNumber, amount: billing.amount, progressPercent: billing.progressPercent, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }).catch(() => setError('Could not download the billing PDF.')) }}><Download size={14} /></button>}
      {billing.status === 'issued' && <button type="button" className="text-button compact-button" onClick={() => { setVoidReason(''); setVoidError(''); setBillingToVoid(billing) }} disabled={busy}>Void</button>}
      </span>
    </div>)}
    </div> : <div className="empty-state">No billings issued yet.</div>}
  </section>
  </>
}
