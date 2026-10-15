import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, Download, Eye, Plus, X } from 'lucide-react'
import { loadOpenProjectBillings, type OpenProjectBilling } from '../data/billing'
import { recordProjectPayment, updateProjectPayment, type PortfolioPayment } from '../data/portfolio'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from '../lib/payment-receipt-pdf'
import { formatBillingNumber } from '../lib/billing-number'
import type { PaymentType } from '../lib/payment-type'
import { MoneyInput } from './MoneyInput'
import { parseMoneyInput } from '../lib/money-input'
import { useToast } from './toast-context'

type PaymentProject = { id: string; name: string; client: string }

const today = new Date()
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })

type PaymentMode = 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'
type GeneralPaymentType = Exclude<PaymentType, 'retention_release' | 'change_order'>
type PaymentChoice = GeneralPaymentType | `change_order:${string}` | `billing:${string}`

export function PaymentEntryDialog({ project, contractId, changeOrderLabel, changeOrderContracts = [], payment, onClose, onSaved }: {
  project: PaymentProject
  contractId?: string
  changeOrderLabel?: string
  changeOrderContracts?: { id: string; label: string }[]
  payment?: PortfolioPayment
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>(contractId ? `change_order:${contractId}` : 'progress')
  const [editedPaymentType, setEditedPaymentType] = useState<PaymentType>(payment?.paymentType ?? 'progress')
  const [editedContractId, setEditedContractId] = useState<string>(payment?.paymentType === 'change_order' ? payment.contractId ?? '' : '')
  const editedChoice = editedPaymentType === 'change_order' ? `change_order:${editedContractId}` : editedPaymentType
  const movesContract = Boolean(payment) && (payment?.contractId ?? '') !== (editedPaymentType === 'change_order' ? editedContractId : '')
  const [amount, setAmount] = useState(payment?.amount.toFixed(2) ?? '')
  const [receivedDate, setReceivedDate] = useState(payment?.date.slice(0, 10) ?? localToday)
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(payment?.paymentMode ?? 'bank_transfer')
  const [payerName, setPayerName] = useState(payment?.payer ?? (project.client === 'Client not set' ? '' : project.client))
  const [reference, setReference] = useState(payment?.paymentReference ?? '')
  const [openBillings, setOpenBillings] = useState<OpenProjectBilling[]>([])
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [isLoadingBillings, setIsLoadingBillings] = useState(!payment)
  const [allocationLoadError, setAllocationLoadError] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [receiptError, setReceiptError] = useState('')
  const selectedBilling = paymentChoice.startsWith('billing:')
    ? openBillings.find((billing) => billing.id === paymentChoice.slice('billing:'.length)) ?? null
    : null
  const newPaymentType: Exclude<PaymentType, 'retention_release'> = selectedBilling?.contractId
    ? 'change_order'
    : paymentChoice.startsWith('change_order:')
      ? 'change_order'
      : paymentChoice === 'progress' || paymentChoice === 'down_payment' || paymentChoice === 'other'
      ? paymentChoice
      : 'progress'
  const paymentType = payment ? editedPaymentType : newPaymentType
  const paymentContractId = selectedBilling
    ? selectedBilling.contractId ?? undefined
    : paymentChoice.startsWith('change_order:')
      ? paymentChoice.slice('change_order:'.length)
      : paymentType === 'change_order' ? contractId : undefined
  const receiptChangeOrderLabel = changeOrderLabel
    ?? changeOrderContracts.find((order) => order.id === paymentContractId)?.label
  const selectableBillings = openBillings.filter((billing) =>
    billing.contractId === null || changeOrderContracts.some((order) => order.id === billing.contractId),
  )
  const paymentScopeBillings = selectedBilling
    ? [selectedBilling]
    : openBillings.filter((billing) => billing.contractId === (paymentContractId ?? null))

  useEffect(() => {
    if (payment) return
    let active = true
    void loadOpenProjectBillings(project.id)
      .then((billings) => { if (active) setOpenBillings(billings) })
      .catch((loadError: unknown) => {
        if (active) setAllocationLoadError(loadError instanceof Error ? loadError.message : 'Could not load open billings.')
      })
      .finally(() => { if (active) setIsLoadingBillings(false) })
    return () => { active = false }
  }, [project.id, payment])

  const downloadReceipt = async (number: string) => {
    setIsSaving(true)
    setReceiptError('')
    try {
      await downloadPaymentReceiptPdf(getReceiptDetails(number))
    } catch {
      setReceiptError('Payment was recorded, but the receipt PDF could not be created. Try downloading it again.')
    } finally {
      setIsSaving(false)
    }
  }

  const getReceiptDetails = (number: string) => {
    const receiptAllocations = selectedBilling
      ? [{
        billingNumber: formatBillingNumber(selectedBilling.billingNumber),
      }]
      : Object.entries(allocations).flatMap(([billingId, rawAmount]) => {
        const billing = paymentScopeBillings.find((item) => item.id === billingId)
        const appliedAmount = parseMoneyInput(rawAmount)
        if (!billing || !Number.isFinite(appliedAmount) || appliedAmount <= 0) return []
        return [{ billingNumber: formatBillingNumber(billing.billingNumber) }]
      })

    return {
        projectName: project.name,
        payerName: payerName.trim(),
        receiptNumber: number,
        amount: parseMoneyInput(amount),
        receivedDate,
        paymentType,
        changeOrderLabel: paymentType === 'change_order' ? receiptChangeOrderLabel : undefined,
        billingAllocations: receiptAllocations,
        paymentMode,
        reference: reference.trim(),
    }
  }

  const previewReceipt = async (number: string) => {
    setIsSaving(true)
    setReceiptError('')
    try {
      await openPaymentReceiptPdf(getReceiptDetails(number))
    } catch {
      setReceiptError('Payment was recorded, but the receipt PDF could not be previewed. Try downloading it again.')
    } finally {
      setIsSaving(false)
    }
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amountValue = parseMoneyInput(amount)
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    if (payment) {
      if (editedPaymentType === 'change_order' && !editedContractId) {
        setError('Choose which approved change order this payment is for.')
        return
      }
      const allocatedAmount = movesContract ? 0 : payment.billingAllocations.reduce((total, allocation) => total + allocation.amount, 0)
      if (amountValue < allocatedAmount) {
        setError(`Amount received cannot be less than the ${money.format(allocatedAmount)} already allocated to billings.`)
        return
      }
      setError('')
      setIsSaving(true)
      try {
        await updateProjectPayment({
          paymentId: payment.id,
          paymentType,
          amount: amountValue,
          receivedDate,
          paymentMode,
          payerName,
          reference,
          contractId: editedPaymentType === 'change_order' ? editedContractId : null,
        })
        showToast('Payment updated.', 'update')
        onSaved()
        onClose()
      } catch (paymentError) {
        setError(paymentError instanceof Error ? paymentError.message : 'Could not update this payment.')
      } finally {
        setIsSaving(false)
      }
      return
    }
    if (paymentType === 'change_order' && !paymentContractId) {
      setError('Select an approved change order for this payment.')
      return
    }
    const paymentAllocations = selectedBilling
      ? [{ billingId: selectedBilling.id, amount: amountValue }]
      : Object.entries(allocations)
        .map(([billingId, rawAmount]) => ({ billingId, amount: parseMoneyInput(rawAmount) }))
        .filter((allocation) => Number.isFinite(allocation.amount) && allocation.amount > 0)
    const allocationTotal = paymentAllocations.reduce((total, allocation) => total + allocation.amount, 0)
    if (allocationTotal > amountValue) {
      setError('Amounts allocated to billings cannot exceed the payment amount.')
      return
    }
    if (selectedBilling && amountValue > selectedBilling.outstandingAmount) {
      setError(`Amount received cannot exceed the remaining balance of Billing #${formatBillingNumber(selectedBilling.billingNumber)}.`)
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
        contractId: paymentContractId,
        paymentType: newPaymentType,
        amount: amountValue,
        receivedDate,
        paymentMode,
        payerName,
        reference,
        allocations: paymentAllocations,
      })
      setReceiptNumber(receipt.receiptNumber)
      showToast('Payment recorded.')
      onSaved()
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Could not record this payment.')
    } finally {
      setIsSaving(false)
    }
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose() }}>
    <section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title">
      <div className="modal-heading">
        <div><div className="section-kicker">{payment ? 'Edit receipt details' : receiptNumber ? 'Payment recorded' : 'New receipt'}</div><h2 id="payment-dialog-title">{payment ? `Edit payment · ${payment.receiptNumber ?? project.name}` : receiptNumber || `Log payment · ${project.name}`}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close" disabled={isSaving}><X size={18} /></button>
      </div>
      {receiptNumber ? <div className="payment-success">
        <div className="payment-success-message">
          <span className="activity-icon"><CircleCheck size={18} /></span>
          <p>Payment saved to {project.name}. Receipt number <strong>{receiptNumber}</strong> has been reserved.</p>
        </div>
        {receiptError && <p className="form-error" role="alert">{receiptError}</p>}
        <div className="modal-actions payment-success-actions"><button className="button button-secondary" onClick={() => { void previewReceipt(receiptNumber) }} disabled={isSaving}><Eye size={15} />View</button><button className="button button-secondary" onClick={() => { void downloadReceipt(receiptNumber) }} disabled={isSaving}><Download size={15} />Download</button><button className="button button-primary" onClick={onClose}>Done</button></div>
      </div> : <form onSubmit={submitPayment}>
        {payment
          ? <p className="modal-intro">Update the payment details. Its acknowledgement receipt will reflect these saved values when viewed or downloaded.</p>
          : <>
            <label className="form-field payment-choice-field">Payment type or billing<select value={paymentChoice} onChange={(event) => { setPaymentChoice(event.target.value as PaymentChoice); setAllocations({}) }}>
            <option value="progress">Progress payment</option>
            <option value="down_payment">Down payment</option>
            <option value="other">Other payment</option>
            {changeOrderContracts.length > 0 && <optgroup label="Approved change orders">
              {changeOrderContracts.map((order) => <option key={order.id} value={`change_order:${order.id}`}>{order.label} payment</option>)}
            </optgroup>}
            {selectableBillings.some((billing) => billing.contractId === null) && <optgroup label="Outstanding billings">
              {selectableBillings.filter((billing) => billing.contractId === null).map((billing) => <option key={billing.id} value={`billing:${billing.id}`}>Billing #{formatBillingNumber(billing.billingNumber)} · {money.format(billing.outstandingAmount)} due</option>)}
            </optgroup>}
            {selectableBillings.some((billing) => billing.contractId !== null) && <optgroup label="Outstanding change-order billings">
              {selectableBillings.filter((billing) => billing.contractId !== null).map((billing) => {
                const orderLabel = changeOrderContracts.find((order) => order.id === billing.contractId)?.label
                return <option key={billing.id} value={`billing:${billing.id}`}>{orderLabel ? `${orderLabel} · ` : ''}Billing #{formatBillingNumber(billing.billingNumber)} · {money.format(billing.outstandingAmount)} due</option>
              })}
            </optgroup>}
            </select></label>
          </>}
        <label className="form-field">Amount received<MoneyInput id="payment-amount-received" min="0.01" step="0.01" value={amount} onChange={setAmount} placeholder="0.00" required /></label>
        {payment && <label className="form-field">Payment type<select
          value={editedChoice}
          onChange={(event) => {
            const value = event.target.value
            if (value.startsWith('change_order:')) {
              setEditedPaymentType('change_order')
              setEditedContractId(value.slice('change_order:'.length))
            } else {
              setEditedPaymentType(value as PaymentType)
              setEditedContractId('')
            }
          }}
          disabled={payment.paymentType === 'retention_release'}
        >
          {payment.paymentType === 'retention_release'
            ? <option value="retention_release">Retention release</option>
            : <>
              <option value="down_payment">Down payment</option>
              <option value="progress">Progress payment</option>
              <option value="other">Other payment</option>
              {(changeOrderContracts.length > 0 || (payment.paymentType === 'change_order' && payment.contractId)) && <optgroup label="Approved change orders">
                {changeOrderContracts.map((contract) => <option key={contract.id} value={`change_order:${contract.id}`}>Change order · {contract.label}</option>)}
                {payment.paymentType === 'change_order' && payment.contractId && !changeOrderContracts.some((contract) => contract.id === payment.contractId) && <option value={`change_order:${payment.contractId}`}>Change order payment</option>}
              </optgroup>}
            </>}
        </select></label>}
        {payment && movesContract && payment.billingAllocations.length > 0 && <p className="payment-move-note" role="note">This payment is currently applied to {payment.billingAllocations.length === 1 ? 'a billing' : `${payment.billingAllocations.length} billings`} under its old type. Saving will remove {payment.billingAllocations.length === 1 ? 'that allocation' : 'those allocations'} so the payment counts toward the new type instead.</p>}
        {!payment && selectedBilling && <fieldset className="payment-single-billing">
          <legend>Payment for</legend>
          <div className="payment-single-billing-summary">
            <strong>{selectedBilling.contractId ? `${changeOrderContracts.find((order) => order.id === selectedBilling.contractId)?.label ?? 'Change order'} · ` : ''}Billing #{formatBillingNumber(selectedBilling.billingNumber)}</strong>
            <span>Balance due <strong>{money.format(selectedBilling.outstandingAmount)}</strong>{selectedBilling.dueAt ? ` · due ${selectedBilling.dueAt}` : ''}</span>
          </div>
          <button type="button" className="text-button compact-button payment-use-full-balance" onClick={() => setAmount(selectedBilling.outstandingAmount.toFixed(2))}>Use full balance</button>
        </fieldset>}
        <div className="form-row">
          <label className="form-field">Received date<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required /></label>
          <label className="form-field">Payment method<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="other">Other</option></select></label>
        </div>
        <label className="form-field">Payer name<input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Enter payer name" minLength={2} required /></label>
        <label className="form-field">Reference (optional)<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank reference or check number" /></label>
        {!payment && !selectedBilling && paymentScopeBillings.length > 0 && <fieldset className="payment-allocation-fieldset">
          <legend>Apply payment to billings</legend>
          <div className="payment-allocation-list">{paymentScopeBillings.map((billing) => <label className="payment-allocation-row" key={billing.id}><span><strong>Billing #{formatBillingNumber(billing.billingNumber)}</strong><small>{money.format(billing.outstandingAmount)} outstanding{billing.dueAt ? ` · due ${billing.dueAt}` : ''}</small></span><MoneyInput min="0" max={billing.outstandingAmount} step="0.01" value={allocations[billing.id] ?? ''} onChange={(value) => setAllocations((current) => ({ ...current, [billing.id]: value }))} aria-label={`Amount allocated to billing ${formatBillingNumber(billing.billingNumber)}`} placeholder="0.00" /></label>)}</div>
          {paymentScopeBillings.length > 1 && <p className="payment-allocation-note">You can split one payment across multiple bills. Any unallocated remainder is applied oldest-first.</p>}
        </fieldset>}
        {!payment && isLoadingBillings && <p className="payment-allocation-empty" role="status">Checking outstanding billings…</p>}
        {!payment && allocationLoadError && <p className="form-error" role="alert">Could not load outstanding billings: {allocationLoadError}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSaving}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving || (!payment && (isLoadingBillings || Boolean(allocationLoadError)))}>{!payment && <Plus size={15} />}{isSaving ? payment ? 'Saving…' : 'Recording…' : payment ? 'Save changes' : 'Record payment'}</button></div>
      </form>}
    </section>
  </div>, document.body)
}
