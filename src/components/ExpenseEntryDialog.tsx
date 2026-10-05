import { useState, type FormEvent } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { recordProjectExpenses, updateProjectExpense, type PortfolioExpense, type ProjectExpenseCategory } from '../data/portfolio'
import { MoneyInput } from './MoneyInput'
import { parseMoneyInput } from '../lib/money-input'

type ExpenseProjectOption = { id: string; name: string }
type ExpenseDraft = {
  id: number
  projectId: string
  date: string
  category: ProjectExpenseCategory
  amount: string
  description: string
  vendor: string
}

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

const now = new Date()
const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

function createExpenseDraft(id: number, projectId: string, expense?: PortfolioExpense): ExpenseDraft {
  return {
    id,
    projectId,
    date: expense?.date ?? localToday,
    category: expense?.category ?? 'materials',
    amount: expense ? String(expense.amount) : '',
    description: expense?.description ?? '',
    vendor: expense?.vendor ?? '',
  }
}

export function ExpenseEntryDialog({ projects, initialProjectId, editingExpense, onClose, onSaved }: {
  projects: ExpenseProjectOption[]
  initialProjectId?: string
  editingExpense?: PortfolioExpense
  onClose: () => void
  onSaved: () => void
}) {
  const [rows, setRows] = useState<ExpenseDraft[]>([createExpenseDraft(1, initialProjectId ?? '', editingExpense)])
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const canChooseProject = initialProjectId === undefined
  const isEditing = editingExpense !== undefined

  const updateRow = (id: number, updates: Partial<ExpenseDraft>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...updates } : row))
  }

  const addRow = () => {
    setRows((current) => {
      const nextId = Math.max(...current.map((row) => row.id), 0) + 1
      return [...current, createExpenseDraft(nextId, initialProjectId ?? '')]
    })
  }

  const removeRow = (id: number) => {
    setRows((current) => current.length > 1 ? current.filter((row) => row.id !== id) : current)
  }

  const submitExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const missingProjectIndex = rows.findIndex((row) => !row.projectId)
    if (missingProjectIndex >= 0) {
      setError(`Choose a project for expense ${missingProjectIndex + 1}.`)
      return
    }
    const invalidAmountIndex = rows.findIndex((row) => !Number.isFinite(parseMoneyInput(row.amount)) || parseMoneyInput(row.amount) <= 0)
    if (invalidAmountIndex >= 0) {
      setError(`Enter an amount greater than zero for expense ${invalidAmountIndex + 1}.`)
      return
    }

    setError('')
    setIsSaving(true)
    try {
      const expenseInputs = rows.map((row) => ({
        projectId: row.projectId,
        date: row.date,
        category: row.category,
        description: row.description,
        vendor: row.vendor,
        amount: parseMoneyInput(row.amount),
      }))
      if (editingExpense) {
        const [expense] = expenseInputs
        await updateProjectExpense({ ...expense, id: editingExpense.id })
      } else {
        await recordProjectExpenses(expenseInputs)
      }
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not record these expenses.')
    } finally {
      setIsSaving(false)
    }
  }

  const closeDialog = () => {
    if (!isSaving) onClose()
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
    <section className="project-modal expense-batch-modal" role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title">
      <div className="modal-heading">
        <div><div className="section-kicker">Project expenses</div><h2 id="expense-dialog-title">{isEditing ? `Edit expense · ${projects[0]?.name ?? ''}` : canChooseProject ? 'Add expenses' : `Add expenses · ${projects[0]?.name ?? ''}`}</h2></div>
        <button className="icon-button" type="button" onClick={closeDialog} aria-label="Close" disabled={isSaving}><X size={18} /></button>
      </div>
      <form onSubmit={(event) => { void submitExpense(event) }}>
        <div className="expense-entry-list">
          {rows.map((row, index) => <section className="expense-entry-row" key={row.id}>
            <div className="expense-entry-row-heading"><strong>{isEditing ? 'Expense details' : `Expense ${index + 1}`}</strong>{rows.length > 1 && <button type="button" className="icon-button" aria-label={`Remove expense ${index + 1}`} title="Remove row" onClick={() => removeRow(row.id)} disabled={isSaving}><X size={16} /></button>}</div>
            <div className={`expense-entry-fields ${canChooseProject ? 'has-project-select' : 'project-fixed'}`}>
              {canChooseProject && <label className="form-field expense-field-project">Project<select value={row.projectId} onChange={(event) => updateRow(row.id, { projectId: event.target.value })} required><option value="">Choose a project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <label className="form-field">Expense date<input type="date" value={row.date} onChange={(event) => updateRow(row.id, { date: event.target.value })} required /></label>
              <label className="form-field">Category<select value={row.category} onChange={(event) => updateRow(row.id, { category: event.target.value as ProjectExpenseCategory })}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="form-field">Amount<MoneyInput min="0.01" step="0.01" value={row.amount} onChange={(value) => updateRow(row.id, { amount: value })} placeholder="0.00" required /></label>
              <label className="form-field expense-field-description">Description<input value={row.description} onChange={(event) => updateRow(row.id, { description: event.target.value })} minLength={2} maxLength={500} placeholder="What was this expense for?" required /></label>
              <label className="form-field expense-field-vendor">Vendor (optional)<input value={row.vendor} onChange={(event) => updateRow(row.id, { vendor: event.target.value })} maxLength={150} placeholder="Supplier or payee" /></label>
            </div>
          </section>)}
        </div>
        {!isEditing && <button type="button" className="button button-secondary expense-add-row" onClick={addRow} disabled={isSaving}><Plus size={15} />Add another row</button>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeDialog} disabled={isSaving}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}>{isSaving ? <><RefreshCw size={15} />Saving…</> : isEditing ? 'Save changes' : <><Plus size={15} />Save {rows.length} expense{rows.length === 1 ? '' : 's'}</>}</button></div>
      </form>
    </section>
  </div>
}
