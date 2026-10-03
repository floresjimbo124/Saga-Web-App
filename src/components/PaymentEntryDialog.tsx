import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, Download, Eye, Plus, X } from 'lucide-react'
import { loadOpenProjectBillings, type OpenProjectBilling } from '../data/billing'
import { recordProjectPayment } from '../data/portfolio'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from '../lib/payment-receipt-pdf'

type PaymentProject = { id: string; name: string; client: string }

const today = new Date()
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })

type PaymentType = 'down_payment' | 'progress' | 'other'
type PaymentMode = 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'

export function PaymentEntryDialog({ project, onClose, onSaved }: {
  project: PaymentProject
  onClose: () => void
  onSaved: () => void
}) {
  const [paymentType, setPaymentType] = useState<PaymentType>('progress')
  const [amount, setAmount] = useState('')
  const [receivedDate, setReceivedDate] = useState(localToday)
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer')
  const [payerName, setPayerName] = useState(project.client === 'Client not set' ? '' : project.client)
  const [reference, setReference] = useState('')
  const [openBillings, setOpenBillings] = useState<OpenProjectBilling[]>([])
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [isLoadingBillings, setIsLoadingBillings] = useState(true)
  const [allocationLoadError, setAllocationLoadError] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [receiptError, setReceiptError] = useState('')

  useEffect(() => {
    let active = true
    void loadOpenProjectBillings(project.id)
      .then((billings) => { if (active) setOpenBillings(billings) })
      .catch((loadError: unknown) => {
        if (active) setAllocationLoadError(loadError instanceof Error ? loadError.message : 'Could not load open billings.')
      })
      .finally(() => { if (active) setIsLoadingBillings(false) })
    return () => { active = false }
  }, [project.id])

  const downloadReceipt = async (number: string) => {
    setIsSaving(true)
    setReceiptError('')
    try {
      await downloadPaymentReceiptPdf({
        projectName: project.name,
        payerName: payerName.trim(),
        receiptNumber: number,
        amount: Number(amount),
        paymentType,
        paymentMode,
        reference: reference.trim(),
      })
    } catch {
      setReceiptError('Payment was recorded, but the receipt PDF could not be created. Try downloading it again.')
    } finally {
      setIsSaving(false)
    }
  }

  const previewReceipt = async (number: string) => {
    setIsSaving(true)
    setReceiptError('')
    try {
      await openPaymentReceiptPdf({
        projectName: project.name,
        payerName: payerName.trim(),
        receiptNumber: number,
        amount: Number(amount),
        paymentType,
        paymentMode,
        reference: reference.trim(),
      })
    } catch {
      setReceiptError('Payment was recorded, but the receipt PDF could not be previewed. Try downloading it again.')
    } finally {
      setIsSaving(false)
    }
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amountValue = Number(amount)
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    const paymentAllocations = Object.entries(allocations)
      .map(([billingId, rawAmount]) => ({ billingId, amount: Number(rawAmount) }))
      .filter((allocation) => Number.isFinite(allocation.amount) && allocation.amount > 0)
    const allocationTotal = paymentAllocations.reduce((total, allocation) => total + allocation.amount, 0)
    if (allocationTotal > amountValue) {
      setError('Amounts allocated to billings cannot exceed the payment amount.')
      return
    }
    for (const allocation of paymentAllocations) {
      const billing = openBillings.find((item) => item.id === allocation.billingId)
      if (!billing || allocation.amount > billing.outstandingAmount) {
        setError('An allocation exceeds the remaining balance on a selected billing.')
        return
      }
    }

    setError('')
    setIsSaving(true)
    try {
      const receipt = await recordProjectPayment({
        projectId: project.id,
        paymentType,
        amount: amountValue,
        receivedDate,
        paymentMode,
        payerName,
        reference,
        allocations: paymentAllocations,
      })
      setReceiptNumber(receipt.receiptNumber)
      onSaved()
      await downloadReceipt(receipt.receiptNumber)
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record this payment.')
    } finally {
      setIsSaving(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose() }}>
    <section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title">
      <div className="modal-heading">
        <div><div className="section-kicker">{receiptNumber ? 'Payment recorded' : 'New receipt'}</div><h2 id="payment-dialog-title">{receiptNumber || `Log payment · ${project.name}`}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close" disabled={isSaving}><X size={18} /></button>
      </div>
      {receiptNumber ? <div className="payment-success">
        <span className="activity-icon"><CircleCheck size={18} /></span>
        <p>Payment saved to {project.name}. Receipt number <strong>{receiptNumber}</strong> has been reserved.</p>
        {receiptError && <p className="form-error" role="alert">{receiptError}</p>}
        <div className="modal-actions"><button className="button button-secondary" onClick={() => { void previewReceipt(receiptNumber) }} disabled={isSaving}><Eye size={15} />View receipt</button><button className="button button-secondary" onClick={() => { void downloadReceipt(receiptNumber) }} disabled={isSaving}><Download size={15} />Download receipt</button><button className="button button-primary" onClick={onClose}>Done</button></div>
      </div> : <form onSubmit={submitPayment}>
        <div className="form-row">
          <label className="form-field">Payment type<select value={paymentType} onChange={(event) => setPaymentType(event.target.value as PaymentType)}><option value="progress">Progress payment</option><option value="down_payment">Down payment</option><option value="other">Other payment</option></select></label>
          <label className="form-field">Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
        </div>
        <div className="form-row">
          <label className="form-field">Received date<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required /></label>
          <label className="form-field">Payment method<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="other">Other</option></select></label>
        </div>
        <label className="form-field">Payer name<input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Enter payer name" minLength={2} required /></label>
        <label className="form-field">Reference (optional)<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank reference or check number" /></label>
        <fieldset className="payment-allocation-fieldset">
          <legend>Apply payment to billings</legend>
          {allocationLoadError ? <p className="form-error" role="alert">{allocationLoadError} Payment can still be recorded without allocations.</p> : isLoadingBillings ? <p className="payment-allocation-empty">Loading open billings…</p> : openBillings.length ? <div className="payment-allocation-list">{openBillings.map((billing) => <label className="payment-allocation-row" key={billing.id}><span><strong>Billing #{billing.billingNumber}</strong><small>{money.format(billing.outstandingAmount)} outstanding{billing.dueAt ? ` · due ${billing.dueAt}` : ''}</small></span><input type="number" min="0" max={billing.outstandingAmount} step="0.01" value={allocations[billing.id] ?? ''} onChange={(event) => setAllocations((current) => ({ ...current, [billing.id]: event.target.value }))} aria-label={`Amount allocated to billing ${billing.billingNumber}`} placeholder="0.00" /></label>)}</div> : <p className="payment-allocation-empty">No open issued billings.</p>}
          <p className="payment-allocation-note">You can split one payment across multiple bills. Any unallocated remainder is applied oldest-first.</p>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSaving}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}><Plus size={15} />{isSaving ? 'Recording…' : 'Record payment'}</button></div>
      </form>}
    </section>
  </div>
}
