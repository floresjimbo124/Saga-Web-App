import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronDown, X } from 'lucide-react'
import type { PortfolioExpense } from '../data/portfolio'
import { ExpenseEntryDialog } from './ExpenseEntryDialog'
import { ExpenseRow, expenseCategories } from './ExpensePanel'
import { QuickExpenseSheet } from './QuickExpenseSheet'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const monthLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })

const isPayroll = (expense: PortfolioExpense) => expense.category === 'payroll' || expense.id.startsWith('payroll')
const isMissingReceipt = (expense: PortfolioExpense) => !expense.receiptStoragePath && !isPayroll(expense)

export function AllExpensesPanel({ projects, onChanged }: {
  projects: { id: string; name: string; expenses: PortfolioExpense[] }[]
  onChanged: () => void
}) {
  const [projectFilter, setProjectFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [showQuick, setShowQuick] = useState(false)
  const [editing, setEditing] = useState<PortfolioExpense | undefined>()
  const [receiptUrl, setReceiptUrl] = useState('')

  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const allExpenses = projects.flatMap((project) => project.expenses).sort((a, b) => b.date.localeCompare(a.date))
  const months = [...new Set(allExpenses.map((expense) => expense.date.slice(0, 7)))]
  const filtered = allExpenses.filter((expense) =>
    (!projectFilter || expense.projectId === projectFilter)
    && (!categoryFilter || expense.category === categoryFilter)
    && (!monthFilter || expense.date.startsWith(monthFilter))
    && (!missingOnly || isMissingReceipt(expense)))
  const total = filtered.reduce((sum, expense) => sum + expense.amount, 0)
  const missingCount = allExpenses.filter(isMissingReceipt).length
  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthTotal = allExpenses.filter((expense) => expense.date.startsWith(thisMonth)).reduce((sum, expense) => sum + expense.amount, 0)

  return <>
    <section className="page-heading all-expenses-heading">
      <div><h1>Expenses</h1><p>Every cost recorded across your projects, including payroll.</p></div>
      <div className="heading-actions"><button type="button" className="button button-primary" onClick={() => setShowQuick(true)} disabled={!projects.length}><Camera size={16} />Add expense</button></div>
    </section>

    <section className="all-expenses-summary" aria-label="Expense totals">
      <span><small>Showing</small><strong>{money.format(total)}</strong><em>{filtered.length} expense{filtered.length === 1 ? '' : 's'}</em></span>
      <span><small>This month</small><strong>{money.format(thisMonthTotal)}</strong></span>
      <button type="button" className={`all-expenses-missing${missingOnly ? ' is-active' : ''}${missingCount ? '' : ' is-clear'}`} onClick={() => setMissingOnly((value) => !value)} disabled={!missingCount} aria-pressed={missingOnly}>
        <small>Missing receipts</small><strong>{missingCount}</strong><em>{missingCount ? (missingOnly ? 'Showing only these' : 'Tap to review') : 'All receipts in'}</em>
      </button>
    </section>

    <div className="filter-bar all-expenses-filters">
      <label className="select-wrap"><span className="sr-only">Project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown size={13} /></label>
      <label className="select-wrap"><span className="sr-only">Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{expenseCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select><ChevronDown size={13} /></label>
      <label className="select-wrap"><span className="sr-only">Month</span><select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}><option value="">Any month</option>{months.map((month) => <option key={month} value={month}>{monthLabel.format(new Date(`${month}-01T12:00:00`))}</option>)}</select><ChevronDown size={13} /></label>
    </div>

    <section className="surface-card all-expenses-list">
      {filtered.length
        ? <div className="expense-register-list">{filtered.map((expense) => <div className="all-expenses-row" key={expense.id}>
          <span className="all-expenses-project">{projectNames.get(expense.projectId) ?? 'Project'}</span>
          <ExpenseRow expense={expense} onEdit={setEditing} onOpenReceipt={setReceiptUrl} onReceiptChanged={onChanged} />
        </div>)}</div>
        : <div className="empty-state">{allExpenses.length ? 'No expenses match those filters.' : 'No expenses recorded yet. Use “Add expense” to log your first one.'}</div>}
    </section>

    {showQuick && <QuickExpenseSheet projects={projects.map((project) => ({ id: project.id, name: project.name }))} initialProjectId={projectFilter || undefined} onClose={() => setShowQuick(false)} onSaved={() => { setShowQuick(false); onChanged() }} />}
    {editing && <ExpenseEntryDialog projects={[{ id: editing.projectId, name: projectNames.get(editing.projectId) ?? '' }]} initialProjectId={editing.projectId} editingExpense={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged() }} />}
    {receiptUrl && createPortal(<div className="modal-backdrop expense-receipt-viewer" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceiptUrl('') }}>
      <figure><img src={receiptUrl} alt="Expense receipt" /><button type="button" className="icon-button" onClick={() => setReceiptUrl('')} aria-label="Close receipt"><X size={18} /></button></figure>
    </div>, document.body)}
  </>
}
