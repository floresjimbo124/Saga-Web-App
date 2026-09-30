import { useState, type FormEvent } from 'react'
import { CircleCheck, Plus, X } from 'lucide-react'
import { recordProjectPayment } from '../data/portfolio'

type PaymentProject = { id: string; name: string; client: string }

const today = new Date()
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

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
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState('')

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amountValue = Number(amount)
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
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
      })
      setReceiptNumber(receipt.receiptNumber)
      onSaved()
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
        <button className="button button-primary" onClick={onClose}>Done</button>
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
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSaving}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}><Plus size={15} />{isSaving ? 'Recording…' : 'Record payment'}</button></div>
      </form>}
    </section>
  </div>
}
