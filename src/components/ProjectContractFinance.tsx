import { useState } from 'react'
import { ArrowDownLeft, Download, Eye, Plus } from 'lucide-react'
import type { PortfolioExpense, PortfolioPayment, ProjectChangeOrder } from '../data/portfolio'
import { BillingPanel } from './BillingPanel'
import { ExpensePanel } from './ExpensePanel'
import { PaymentEntryDialog } from './PaymentEntryDialog'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from '../lib/payment-receipt-pdf'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const shortDate = (value: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  .format(new Date(value.length === 10 ? `${value}T12:00:00` : value))

export function ProjectContractFinance({ order, projectName, clientName, location, payments, expenses, retentionRatePercent, onChanged }: {
  order: ProjectChangeOrder
  projectName: string
  clientName: string
  location: string
  payments: PortfolioPayment[]
  expenses: PortfolioExpense[]
  retentionRatePercent: number
  onChanged: () => void
}) {
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const contractPayments = payments.filter((payment) => payment.contractId === order.contractId)
  const contractExpenses = expenses.filter((expense) => expense.contractId === order.contractId)
  const contractName = `${projectName} · ${order.title}`
  const retention = order.retentionRatePercent ?? retentionRatePercent
  const earned = Math.round(order.amount * order.contractProgress) / 100
  const ceiling = Math.round(order.amount * (100 - retention)) / 100

  const receiptDetails = (payment: PortfolioPayment) => ({
    projectName: contractName,
    payerName: payment.payer,
    receiptNumber: payment.receiptNumber ?? '',
    amount: payment.amount,
    receivedDate: payment.date,
    paymentType: payment.paymentType,
    paymentMode: payment.paymentMode,
    reference: payment.paymentReference,
  })

  const viewReceipt = async (payment: PortfolioPayment) => {
    setReceiptError('')
    try {
      await openPaymentReceiptPdf(receiptDetails(payment))
    } catch {
      setReceiptError('Could not preview the acknowledgement receipt.')
    }
  }

  const downloadReceipt = async (payment: PortfolioPayment) => {
    setReceiptError('')
    try {
      await downloadPaymentReceiptPdf(receiptDetails(payment))
    } catch {
      setReceiptError('Could not download the acknowledgement receipt.')
    }
  }

  return <section className="change-order-contract">
    <div className="change-order-contract-heading">
      <div><div className="section-kicker">Separate contract</div><h3>{order.title}</h3></div>
      <strong>{money.format(order.amount)}</strong>
    </div>
    <BillingPanel
      projectId={order.projectId}
      contractId={order.contractId ?? undefined}
      projectName={contractName}
      clientName={clientName}
      location={location}
      progress={order.contractProgress}
      earned={earned}
      ceiling={ceiling}
      isSetupComplete
      onChanged={onChanged}
    />
    <section className="surface-card tab-content payment-register-card">
      <div className="card-heading-row">
        <div><div className="section-kicker">Contract payments</div><h2>Received payments</h2></div>
        <button className="button button-primary" onClick={() => setShowPaymentDialog(true)}><Plus size={15} />Log payment</button>
      </div>
      {showPaymentDialog && <PaymentEntryDialog
        project={{ id: order.projectId, name: contractName, client: clientName }}
        contractId={order.contractId ?? undefined}
        onClose={() => setShowPaymentDialog(false)}
        onSaved={onChanged}
      />}
      {receiptError && <p className="form-error" role="alert">{receiptError}</p>}
      {contractPayments.length ? <div className="payment-register-list">{contractPayments.map((payment) => <div className="payment-detail-row" key={payment.id}>
        <span className="activity-icon"><ArrowDownLeft size={15} /></span>
        <span className="activity-copy"><strong>{payment.payer}</strong><small>{shortDate(payment.date)} · {payment.mode} · {payment.reference}</small></span>
        <strong className="activity-amount">{money.format(payment.amount)}</strong>
        {payment.receiptNumber && <button type="button" className="text-button compact-button" aria-label={`View acknowledgement receipt ${payment.receiptNumber}`} onClick={() => { void viewReceipt(payment) }}><Eye size={14} />View</button>}
        {payment.receiptNumber && <button type="button" className="text-button compact-button" aria-label={`Download acknowledgement receipt ${payment.receiptNumber}`} onClick={() => { void downloadReceipt(payment) }}><Download size={14} /></button>}
      </div>)}</div> : <div className="empty-state">No payments recorded for this contract.</div>}
    </section>
    <ExpensePanel
      projectId={order.projectId}
      contractId={order.contractId ?? undefined}
      projectName={contractName}
      expenses={contractExpenses}
      inflow={contractPayments.reduce((total, payment) => total + payment.amount, 0)}
      onChanged={onChanged}
    />
  </section>
}
