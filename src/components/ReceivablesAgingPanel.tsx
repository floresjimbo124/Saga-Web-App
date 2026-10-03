import { ArrowRight, Clock3 } from 'lucide-react'
import type { ReceivableAgingBucket, ReceivableAgingItem } from '../finance/receivables-aging'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const bucketLabels: { bucket: ReceivableAgingBucket; label: string }[] = [
  { bucket: 'not-due', label: 'Not due' },
  { bucket: '1-30', label: '1-30 days' },
  { bucket: '31-60', label: '31-60 days' },
  { bucket: '61+', label: '61+ days' },
  { bucket: 'no-due-date', label: 'No due date' },
]

function dueLabel(item: ReceivableAgingItem) {
  if (item.dueAt === null) return 'No due date'
  if (item.daysUntilDue === 0) return 'Due today'
  if (item.daysUntilDue !== null && item.daysUntilDue > 0) return `Due in ${item.daysUntilDue} days`
  return `${item.daysOverdue} days overdue`
}

function formatDate(value: string | null) {
  if (!value) return 'Date not set'
  return dateFormat.format(new Date(`${value.slice(0, 10)}T12:00:00`))
}

export function ReceivablesAgingPanel({ items, onOpenProject }: {
  items: ReceivableAgingItem[]
  onOpenProject: (projectId: string) => void
}) {
  const totals = new Map(bucketLabels.map(({ bucket }) => [bucket, 0]))
  for (const item of items) totals.set(item.bucket, (totals.get(item.bucket) ?? 0) + item.outstandingAmount)
  const totalOutstanding = items.reduce((sum, item) => sum + item.outstandingAmount, 0)
  const totalOverdue = items.reduce((sum, item) => sum + (item.daysOverdue > 0 ? item.outstandingAmount : 0), 0)

  return <section className="surface-card receivables-aging-panel">
    <div className="card-heading-row"><div><div className="section-kicker">Billing follow-up</div><h2>Receivables aging</h2></div><div className="aging-totals"><span><small>Outstanding</small><strong>{money.format(totalOutstanding)}</strong></span><span className="aging-overdue-total"><small>Overdue</small><strong>{money.format(totalOverdue)}</strong></span></div></div>
    <div className="aging-buckets" aria-label="Outstanding amounts by age">{bucketLabels.map(({ bucket, label }) => <div className={`aging-bucket aging-${bucket.replaceAll('+', 'plus').replaceAll('-', '-')}`} key={bucket}><span>{label}</span><strong>{money.format(totals.get(bucket) ?? 0)}</strong></div>)}</div>
    {items.length ? <div className="aging-list">{items.map((item) => <button className="aging-row" type="button" key={item.id} onClick={() => onOpenProject(item.projectId)}>
      <span className="aging-project"><strong>{item.projectName} · {item.kind === 'retention'
        ? 'Retention release'
        : item.kind === 'down-payment'
          ? 'Contract down payment'
          : `Billing #${item.billingNumber}`}</strong><small>{item.clientName}</small></span>
      <span className="aging-due"><strong className={item.daysUntilDue === 0 ? 'aging-due-today' : undefined}>{dueLabel(item)}</strong><small>Due {formatDate(item.dueAt)}</small></span>
      <strong className="aging-amount">{money.format(item.outstandingAmount)}</strong>
      <ArrowRight className="aging-row-arrow" size={15} />
    </button>)}</div> : <div className="aging-empty"><Clock3 size={16} /><span>No open receivables to age.</span></div>}
    <p className="aging-note">Payments are applied to the down payment and issued billings in date order. Retention releases are excluded.</p>
  </section>
}