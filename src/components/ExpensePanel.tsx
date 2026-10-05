import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, WalletCards } from 'lucide-react'
import { type PortfolioExpense, type ProjectExpenseCategory } from '../data/portfolio'
import { ExpenseEntryDialog } from './ExpenseEntryDialog'

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

function ExpenseRow({ expense, onEdit }: { expense: PortfolioExpense; onEdit: (expense: PortfolioExpense) => void }) {
  const category = categories.find((item) => item.value === expense.category)?.label ?? 'Other'
  return <div className="payment-detail-row expense-row">
    <span className="activity-icon"><WalletCards size={15} /></span>
    <span className="activity-copy"><strong>{expense.description}</strong><small>{formatExpenseDate(expense.date)} · {category}{expense.vendor ? ` · ${expense.vendor}` : ''}</small></span>
    <strong className="activity-amount expense-amount">− {money.format(expense.amount)}</strong>
    <button type="button" className="icon-button expense-edit-button" onClick={() => onEdit(expense)} aria-label={`Edit expense: ${expense.description}`} title="Edit expense"><Pencil size={14} /></button>
  </div>
}

export function ExpensePanel({ projectId, projectName, expenses, inflow, onChanged }: {
  projectId: string
  projectName: string
  expenses: PortfolioExpense[]
  inflow: number
  onChanged: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<PortfolioExpense | undefined>()
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
      <div className="card-heading-row"><div><div className="section-kicker">Project cash flow</div><h2>Expenses</h2></div><button type="button" className="button button-primary button-danger" onClick={() => setShowForm(true)}><Plus size={15} />Add expense</button></div>
      <div className="expense-summary" aria-label="Project cash flow totals">
        <div className="expense-summary-item"><span><ArrowDownLeft size={14} />Inflow</span><strong>{money.format(inflow)}</strong></div>
        <div className="expense-summary-item"><span><ArrowUpRight size={14} />Outflow</span><strong>{money.format(totalOutflow)}</strong></div>
        <div className="expense-summary-item"><span>Net cash</span><strong className={net < 0 ? 'expense-net-negative' : 'expense-net-positive'}>{money.format(net)}</strong></div>
      </div>

      <div className="expense-category-summary" aria-label="Expense totals by category">
        <div className="section-kicker expense-register-heading">Expense by category</div>
        {categoryTotals.length ? <div className="expense-category-list">{categoryTotals.map((category) => <div key={category.value} className="expense-category-row"><span>{category.label}</span><strong>{money.format(category.total)}</strong></div>)}</div> : <div className="empty-state small">No category totals yet.</div>}
      </div>

      <div className="section-kicker expense-register-heading">Expense register</div>
      {expenses.length ? <div className="expense-register-list">{expenses.map((expense) => <ExpenseRow key={expense.id} expense={expense} onEdit={(item) => { setEditingExpense(item); setShowForm(true) }} />)}</div> : <div className="empty-state">No expenses recorded for this project yet.</div>}
    </section>
    {showForm && <ExpenseEntryDialog projects={[{ id: projectId, name: projectName }]} initialProjectId={projectId} editingExpense={editingExpense} onClose={() => { setShowForm(false); setEditingExpense(undefined) }} onSaved={() => { setShowForm(false); setEditingExpense(undefined); onChanged() }} />}
  </>
}