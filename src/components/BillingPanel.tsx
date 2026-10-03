import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Download, Eye, Plus, X } from 'lucide-react'
import {
  issueProjectBilling,
  loadProjectBillings,
  updateProjectProgress,
  voidProjectBilling,
  type ProjectBilling,
} from '../data/billing'
import { downloadBillingPdf, openBillingPdf } from '../lib/billing-pdf'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: '2-digit', year: 'numeric' })

export function BillingPanel({ projectId, projectName, clientName, location, progress, earned, ceiling, isSetupComplete, onChanged }: {
  projectId: string
  projectName: string
  clientName: string
  location: string
  progress: number
  earned: number
  ceiling: number
  isSetupComplete: boolean
  onChanged: () => void
}) {
  const [billings, setBillings] = useState<ProjectBilling[]>([])
  const [progressInput, setProgressInput] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [billingToVoid, setBillingToVoid] = useState<ProjectBilling | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setBillings(await loadProjectBillings(projectId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load billings.')
    }
  }, [projectId])

  // This list is populated from the database and intentionally refreshed after the async fetch resolves.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refresh() }, [refresh])

  const run = async (action: () => Promise<string>, onActionError = setError) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setMessage(await action())
      await refresh()
      onChanged()
    } catch (actionError) {
      onActionError(actionError instanceof Error ? actionError.message : 'Something went wrong.')
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
      await updateProjectProgress({ projectId, progressPercent: value })
      setProgressInput(null)
      return `Progress updated to ${value}%.`
    })
  }

  const issueBilling = () => {
    const pending = progressInput === null ? null : Number(progressInput)
    if (pending !== null && (!Number.isFinite(pending) || pending < 0 || pending > 100)) {
      setError('Enter a progress value from 0 to 100.')
      return
    }
    void run(async () => {
      // Save any progress value typed but not yet saved, so the billing uses it.
      if (pending !== null && pending !== progress) {
        await updateProjectProgress({ projectId, progressPercent: pending })
      }
      setProgressInput(null)
      const result = await issueProjectBilling(projectId, dueDate || null)
      let pdfStatus = 'PDF opened and downloaded.'
      try {
        await openBillingPdf({
          projectName,
          clientName,
          location,
          billingNumber: result.billingNumber,
          amount: result.amount,
          progressPercent: pending ?? progress,
          issuedAt: new Date().toISOString(),
          dueAt: dueDate || null,
        })
        await downloadBillingPdf({
          projectName,
          clientName,
          location,
          billingNumber: result.billingNumber,
          amount: result.amount,
          progressPercent: pending ?? progress,
          issuedAt: new Date().toISOString(),
          dueAt: dueDate || null,
        })
      } catch {
        pdfStatus = 'Use the buttons below if the PDF did not open or download.'
      }
      return `Billing #${result.billingNumber} issued for ${money.format(result.amount)}. ${pdfStatus}`
    })
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
      return `Billing #${billing.billingNumber} voided.`
    }, setVoidError)
  }

  return <>
  {billingToVoid && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setBillingToVoid(null) }}>
    <section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="void-billing-title">
      <div className="modal-heading"><div><div className="section-kicker">Billing adjustment</div><h2 id="void-billing-title">Void billing #{billingToVoid.billingNumber}</h2></div><button className="icon-button" type="button" onClick={() => setBillingToVoid(null)} aria-label="Close" disabled={busy}><X size={18} /></button></div>
      <p className="modal-intro">This billing will be marked void. Enter a reason for the project record.</p>
      <form onSubmit={confirmVoidBilling}>
        <label className="form-field">Reason for voiding<textarea autoFocus value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Enter the reason" minLength={3} maxLength={500} required /></label>
        {voidError && <p className="form-error" role="alert">{voidError}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setBillingToVoid(null)} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Voiding…' : 'Void billing'}</button></div>
      </form>
    </section>
  </div>}
  <section className="surface-card tab-content">
    <div className="card-heading-row"><div><div className="section-kicker">Billing</div><h2>Progress billing</h2></div></div>
    {isSetupComplete
      ? <p className="calculation-note">Earned at {progress}%: <strong>{money.format(earned)}</strong> · Billable ceiling: <strong>{money.format(ceiling)}</strong></p>
      : <p className="calculation-note">Set up the contract amount before issuing a billing.</p>}
    <div className="form-row">
      <label className="form-field">Work completed (%)<input type="number" min="0" max="100" step="0.01" value={progressInput ?? String(progress)} onChange={(event) => setProgressInput(event.target.value)} /></label>
      <label className="form-field">Due date (optional)<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    </div>
    <div className="modal-actions">
      <button type="button" className="button button-secondary" onClick={saveProgress} disabled={busy || progressInput === null}>Save progress</button>
      <button type="button" className="button button-primary" onClick={issueBilling} disabled={busy || !isSetupComplete}><Plus size={15} />Issue billing</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="calculation-note" role="status">{message}</p>}
    <div className="section-kicker">Billings issued</div>
    {billings.length ? <div className="billing-register-list">{billings.map((billing) => <div className="payment-detail-row" key={billing.id}>
      <span className="activity-copy"><strong>Billing #{billing.billingNumber} · {billing.progressPercent}% complete{billing.status === 'void' ? ' · VOID' : ''}</strong><small>{billing.issuedAt ? dateFormat.format(new Date(billing.issuedAt)) : 'Not issued'}{billing.dueAt ? ` · due ${dateFormat.format(new Date(`${billing.dueAt}T12:00:00`))}` : ''}{billing.voidReason ? ` · ${billing.voidReason}` : ''}</small></span>
      <strong className="activity-amount">{money.format(billing.amount)}</strong>
      {billing.status === 'issued' && <button type="button" className="text-button compact-button" onClick={() => { void openBillingPdf({ projectName, clientName, location, billingNumber: billing.billingNumber, amount: billing.amount, progressPercent: billing.progressPercent, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }).catch(() => setError('Could not preview the billing PDF.')) }}><Eye size={14} />View</button>}
      {billing.status === 'issued' && <button type="button" className="text-button compact-button" aria-label={`Download billing ${billing.billingNumber}`} title="Download billing PDF" onClick={() => { void downloadBillingPdf({ projectName, clientName, location, billingNumber: billing.billingNumber, amount: billing.amount, progressPercent: billing.progressPercent, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }).catch(() => setError('Could not download the billing PDF.')) }}><Download size={14} /></button>}
      {billing.status === 'issued' && <button type="button" className="text-button compact-button" onClick={() => { setVoidReason(''); setVoidError(''); setBillingToVoid(billing) }} disabled={busy}>Void</button>}
    </div>)}</div> : <div className="empty-state">No billings issued yet.</div>}
  </section>
  </>
}
