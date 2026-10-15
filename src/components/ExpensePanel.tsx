import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownLeft, ArrowUpRight, Camera, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createExpenseReceiptUrl, setProjectExpenseReceipt, uploadExpenseReceipt, type PortfolioExpense, type ProjectExpenseCategory } from '../data/portfolio'
import { ExpenseEntryDialog } from './ExpenseEntryDialog'
import { QuickExpenseSheet } from './QuickExpenseSheet'
import { useToast } from './toast-context'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const categories: { value: ProjectExpenseCategory; label: string }[] = [
  { value: 'materials', label: 'Materials' },
  { value: 'labor', label: 'Labor' },
  { value: 'operational_expenses', label: 'Operational Expenses' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'sub_contract', label: 'Sub Contract' },
  { value: 'rent', label: 'Rent' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'transport', label: 'Transport' },
  { value: 'permits', label: 'Permits' },
  { value: 'other', label: 'Other' },
]

function formatExpenseDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

function ReceiptThumb({ storagePath, label, onOpen }: { storagePath: string; label: string; onOpen: (url: string) => void }) {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)
  useEffect(() => {
    let active = true
    void createExpenseReceiptUrl(storagePath)
      .then((url) => { if (active) setLoaded({ path: storagePath, url }) })
      .catch((error: unknown) => console.error('Could not load expense receipt.', error))
    return () => { active = false }
  }, [storagePath])
  const url = loaded?.path === storagePath ? loaded.url : ''
  return <button type="button" className="expense-receipt-thumb" onClick={() => url && onOpen(url)} aria-label={`View receipt for ${label}`} disabled={!url}>
    {url ? <img src={url} alt="" /> : <RefreshCw size={13} />}
  </button>
}

function ExpenseRow({ expense, onEdit, onOpenReceipt, onReceiptChanged }: {
  expense: PortfolioExpense
  onEdit: (expense: PortfolioExpense) => void
  onOpenReceipt: (url: string) => void
  onReceiptChanged: () => void
}) {
  const { showToast } = useToast()
  const [isUploading, setIsUploading] = useState(false)
  const [rowError, setRowError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const category = categories.find((item) => item.value === expense.category)?.label ?? 'Other'
  const isPayroll = expense.id.startsWith('payroll') || expense.category === 'payroll'

  const attachReceipt = async (file: File | undefined) => {
    if (!file) return
    setIsUploading(true)
    setRowError('')
    try {
      const path = await uploadExpenseReceipt(expense.projectId, file)
      await setProjectExpenseReceipt(expense.id, path)
      showToast('Receipt attached.', 'update')
      onReceiptChanged()
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Could not attach the receipt.')
    } finally {
      setIsUploading(false)
    }
  }

  return <div className="payment-detail-row expense-row">
    {expense.receiptStoragePath
      ? <ReceiptThumb storagePath={expense.receiptStoragePath} label={expense.description} onOpen={onOpenReceipt} />
      : isPayroll
        ? <span className="expense-receipt-thumb is-empty" aria-hidden="true" />
        : <button type="button" className="expense-receipt-thumb is-missing" onClick={() => fileInput.current?.click()} disabled={isUploading} aria-label={`Attach receipt for ${expense.description}`} title="Attach receipt">{isUploading ? <RefreshCw size={14} /> : <Camera size={14} />}</button>}
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { void attachReceipt(event.target.files?.[0]); event.target.value = '' }} />
    <span className="activity-copy"><strong>{expense.description}{!expense.receiptStoragePath && !isPayroll && <span className="expense-no-receipt">No receipt</span>}</strong><small>{formatExpenseDate(expense.date)} · {category}{expense.vendor ? ` · ${expense.vendor}` : ''}</small>{rowError && <small className="form-error" role="alert">{rowError}</small>}</span>
    <strong className="activity-amount expense-amount">− {money.format(expense.amount)}</strong>
    {!isPayroll && <button type="button" className="icon-button expense-edit-button" onClick={() => onEdit(expense)} aria-label={`Edit expense: ${expense.description}`} title="Edit expense"><Pencil size={14} /></button>}
  </div>
}

export function ExpensePanel({ projectId, contractId, projectName, expenses, inflow, onChanged }: {
  projectId: string
  contractId?: string
  projectName: string
  expenses: PortfolioExpense[]
  inflow: number
  onChanged: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [showQuick, setShowQuick] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState('')
  const [showMissingOnly, setShowMissingOnly] = useState(false)
  const [editingExpense, setEditingExpense] = useState<PortfolioExpense | undefined>()
  const isMissingReceipt = (expense: PortfolioExpense) => !expense.receiptStoragePath && expense.category !== 'payroll' && !expense.id.startsWith('payroll')
  const missingCount = expenses.filter(isMissingReceipt).length
  const visibleExpenses = showMissingOnly ? expenses.filter(isMissingReceipt) : expenses
  const totalOutflow = expenses.reduce((total, expense) => total + expense.amount, 0)
  const net = inflow - totalOutflow
  const categoryTotals = categories.map((category) => ({
    ...category,
    total: expenses
      .filter((expense) => expense.category === category.value)
      .reduce((sum, expense) => sum + expense.amount, 0),
  })).filter((category) => category.total > 0)

  return <>
    <section className="surface-card tab-content expense-panel">
      <div className="card-heading-row"><h2>Expenses</h2><div className="expense-heading-actions">{contractId
        ? <button type="button" className="button button-primary" onClick={() => setShowForm(true)}><Plus size={15} />Add expense</button>
        : <><button type="button" className="button button-secondary" onClick={() => setShowForm(true)}>Add several</button><button type="button" className="button button-primary" onClick={() => setShowQuick(true)}><Camera size={15} />Add expense</button></>}</div></div>
      <div className="expense-summary" aria-label="Project cash flow totals">
        <div className="expense-summary-item"><span><ArrowDownLeft size={14} />Inflow</span><strong>{money.format(inflow)}</strong></div>
        <div className="expense-summary-item"><span><ArrowUpRight size={14} />Outflow</span><strong>{money.format(totalOutflow)}</strong></div>
        <div className="expense-summary-item"><span>Net cash</span><strong className={net < 0 ? 'expense-net-negative' : 'expense-net-positive'}>{money.format(net)}</strong></div>
      </div>

      <div className="expense-category-summary" aria-label="Expense totals by category">
        <div className="section-kicker expense-register-heading">Expenses by category</div>
        {categoryTotals.length ? <div className="expense-category-list">{categoryTotals.map((category) => <div key={category.value} className="expense-category-row"><span>{category.label}</span><strong>{money.format(category.total)}</strong></div>)}</div> : <div className="empty-state small">No category totals yet.</div>}
      </div>

      <div className="expense-register-toolbar">
        <div className="section-kicker expense-register-heading">Expense register</div>
        {missingCount > 0 && <button type="button" className={`expense-missing-filter${showMissingOnly ? ' is-active' : ''}`} onClick={() => setShowMissingOnly((value) => !value)} aria-pressed={showMissingOnly}>{missingCount} without receipt</button>}
      </div>
      {visibleExpenses.length ? <div className="expense-register-list">{visibleExpenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} onEdit={(item) => { setEditingExpense(item); setShowForm(true) }} onOpenReceipt={setReceiptUrl} onReceiptChanged={onChanged} />)}</div> : <div className="empty-state">{showMissingOnly ? 'Every expense has a receipt.' : 'No expenses recorded for this project yet.'}</div>}
    </section>
    {showQuick && <QuickExpenseSheet projects={[{ id: projectId, name: projectName }]} initialProjectId={projectId} onClose={() => setShowQuick(false)} onSaved={() => { setShowQuick(false); onChanged() }} />}
    {receiptUrl && createPortal(<div className="modal-backdrop expense-receipt-viewer" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceiptUrl('') }}>
      <figure><img src={receiptUrl} alt="Expense receipt" /><button type="button" className="icon-button" onClick={() => setReceiptUrl('')} aria-label="Close receipt"><X size={18} /></button></figure>
    </div>, document.body)}
    {showForm && <ExpenseEntryDialog projects={[{ id: projectId, name: projectName }]} initialProjectId={projectId} contractId={contractId} editingExpense={editingExpense} onClose={() => { setShowForm(false); setEditingExpense(undefined) }} onSaved={() => { setShowForm(false); setEditingExpense(undefined); onChanged() }} />}
  </>
}