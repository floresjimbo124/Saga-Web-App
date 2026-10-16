import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownLeft, ArrowUpRight, Camera, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createExpenseReceiptUrl, discardExpenseReceipt, setProjectExpenseReceipt, uploadExpenseReceipt, type PortfolioExpense, type ProjectExpenseCategory } from '../data/portfolio'
import { ExpenseEntryDialog } from './ExpenseEntryDialog'
import { QuickExpenseSheet } from './QuickExpenseSheet'
import { useToast } from './toast-context'
import { CountUp, EmptyArt } from './Motion'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
export const expenseCategories: { value: ProjectExpenseCategory; label: string }[] = [
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

export function ExpenseRow({ expense, onEdit, onOpenReceipt, onReceiptChanged }: {
  expense: PortfolioExpense
  onEdit: (expense: PortfolioExpense) => void
  onOpenReceipt: (url: string) => void
  onReceiptChanged: () => void
}) {
  const { showToast } = useToast()
  const [isUploading, setIsUploading] = useState(false)
  const [rowError, setRowError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const category = expenseCategories.find((item) => item.value === expense.category)?.label ?? 'Other'
  const isPayroll = expense.id.startsWith('payroll') || expense.category === 'payroll'

  const attachReceipt = async (file: File | undefined) => {
    if (!file) return
    setIsUploading(true)
    setRowError('')
    try {
      const path = await uploadExpenseReceipt(expense.projectId, file)
      try {
        await setProjectExpenseReceipt(expense.id, path)
      } catch (attachError) {
        await discardExpenseReceipt(path)
        throw attachError
      }
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
  const categoryTotals = expenseCategories.map((category) => ({
    ...category,
    total: expenses
      .filter((expense) => expense.category === category.value)
      .reduce((sum, expense) => sum + expense.amount, 0),
  })).filter((category) => category.total > 0)

  return <>
    <section className="surface-card tab-content expense-panel ex-panel">
      <header className="ex-header">
        <div><h2>Expenses</h2><p>{expenses.length ? `${expenses.length} expense${expenses.length === 1 ? '' : 's'} recorded` : 'Track materials, labor and other project costs'}</p></div>
        <div className="expense-heading-actions">{contractId
          ? <button type="button" className="button button-primary" onClick={() => setShowForm(true)}><Plus size={15} />Add expense</button>
          : <><button type="button" className="button button-secondary" onClick={() => setShowForm(true)}><Plus size={15} />Add several</button><button type="button" className="button button-primary" onClick={() => setShowQuick(true)}><Camera size={15} />Add expense</button></>}</div>
      </header>

      <div className="ex-stats" aria-label="Project cash flow totals">
        <div><span><ArrowDownLeft size={14} />Inflow</span><strong><CountUp value={money.format(inflow)} /></strong><small>Payments collected</small></div>
        <div><span><ArrowUpRight size={14} />Outflow</span><strong><CountUp value={money.format(totalOutflow)} /></strong><small>{inflow > 0 ? `${Math.round(totalOutflow / inflow * 100)}% of inflow` : 'Recorded expenses'}</small></div>
        <div className={net < 0 ? 'is-negative' : 'is-positive'}><span>Net cash</span><strong><CountUp value={money.format(net)} /></strong><small>{net < 0 ? 'Spending exceeds collections' : 'Cash on hand for this project'}</small></div>
      </div>

      {expenses.length ? <>
        <div className="ex-section">
          <div className="ex-section-heading"><h3>By category</h3></div>
          <div className="ex-category-bar" aria-hidden="true">{categoryTotals.map((category, index) => <i key={category.value} className={`tone-${index % 6}`} style={{ width: `${category.total / totalOutflow * 100}%` }} />)}</div>
          <div className="ex-category-list">{categoryTotals.map((category, index) => <div key={category.value} className="ex-category-row">
            <span><i className={`tone-${index % 6}`} />{category.label}</span>
            <small>{Math.round(category.total / totalOutflow * 100)}%</small>
            <strong>{money.format(category.total)}</strong>
          </div>)}</div>
        </div>

        <div className="ex-section">
          <div className="ex-section-heading">
            <h3>Expense register</h3>
            {missingCount > 0 && <button type="button" className={`expense-missing-filter${showMissingOnly ? ' is-active' : ''}`} onClick={() => setShowMissingOnly((value) => !value)} aria-pressed={showMissingOnly}>{missingCount} without receipt</button>}
          </div>
          {visibleExpenses.length ? <div className="expense-register-list ex-register">{visibleExpenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} onEdit={(item) => { setEditingExpense(item); setShowForm(true) }} onOpenReceipt={setReceiptUrl} onReceiptChanged={onChanged} />)}</div> : <div className="empty-state">Every expense has a receipt.</div>}
        </div>
      </> : <div className="pr-empty">
        <EmptyArt kind="receipt" />
        <strong>No expenses yet</strong>
        <p>Snap a receipt or enter costs to see spending by category.</p>
        <button type="button" className="button button-primary" onClick={() => contractId ? setShowForm(true) : setShowQuick(true)}><Camera size={15} />Add first expense</button>
      </div>}
    </section>
    {showQuick && <QuickExpenseSheet projects={[{ id: projectId, name: projectName }]} initialProjectId={projectId} onClose={() => setShowQuick(false)} onSaved={() => { setShowQuick(false); onChanged() }} />}
    {receiptUrl && createPortal(<div className="modal-backdrop expense-receipt-viewer" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceiptUrl('') }}>
      <figure><img src={receiptUrl} alt="Expense receipt" /><button type="button" className="icon-button" onClick={() => setReceiptUrl('')} aria-label="Close receipt"><X size={18} /></button></figure>
    </div>, document.body)}
    {showForm && <ExpenseEntryDialog projects={[{ id: projectId, name: projectName }]} initialProjectId={projectId} contractId={contractId} editingExpense={editingExpense} onClose={() => { setShowForm(false); setEditingExpense(undefined) }} onSaved={() => { setShowForm(false); setEditingExpense(undefined); onChanged() }} />}
  </>
}