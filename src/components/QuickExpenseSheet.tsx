import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronDown, ImagePlus, RefreshCw, X } from 'lucide-react'
import { discardExpenseReceipt, recordQuickProjectExpense, uploadExpenseReceipt, type ProjectExpenseCategory } from '../data/portfolio'
import { MoneyInput } from './MoneyInput'
import { parseMoneyInput } from '../lib/money-input'
import { useToast } from './toast-context'

const quickCategories: { value: ProjectExpenseCategory; label: string }[] = [
  { value: 'materials', label: 'Materials' },
  { value: 'labor', label: 'Labor' },
  { value: 'sub_contract', label: 'Sub-con' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'transport', label: 'Transport' },
  { value: 'hauling', label: 'Hauling' },
  { value: 'permits', label: 'Permits' },
  { value: 'rent', label: 'Rent' },
  { value: 'operational_expenses', label: 'Operations' },
  { value: 'other', label: 'Other' },
]

const lastProjectKey = 'sagact.quickExpense.lastProjectId'

const todayLocal = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function readLastProject() {
  try {
    return window.localStorage.getItem(lastProjectKey) ?? ''
  } catch {
    return ''
  }
}

export function QuickExpenseSheet({ projects, initialProjectId, onClose, onSaved }: {
  projects: { id: string; name: string }[]
  initialProjectId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const remembered = readLastProject()
  const [projectId, setProjectId] = useState(initialProjectId ?? (projects.some((item) => item.id === remembered) ? remembered : projects.length === 1 ? projects[0].id : ''))
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ProjectExpenseCategory>('materials')
  const [note, setNote] = useState('')
  const [vendor, setVendor] = useState('')
  const todayKey = new Date().toLocaleDateString('en-CA')
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 641px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 641px)')
    const update = () => setIsDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [date, setDate] = useState(todayLocal)
  const [showMore, setShowMore] = useState(false)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const projectFixed = initialProjectId !== undefined

  useEffect(() => {
    if (!receipt) return
    const url = URL.createObjectURL(receipt)
    setReceiptPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [receipt])

  const pickReceipt = (file: File | undefined) => {
    if (!file) return
    setReceipt(file)
    setError('')
  }

  const close = () => {
    if (!isSaving) onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedAmount = parseMoneyInput(amount)
    if (!projectId) {
      setError('Choose a project.')
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setError('')
    setIsSaving(true)
    try {
      const receiptStoragePath = receipt ? await uploadExpenseReceipt(projectId, receipt) : null
      const categoryLabel = quickCategories.find((item) => item.value === category)?.label ?? 'Expense'
      try {
        await recordQuickProjectExpense({
          projectId,
          date,
          category,
          description: note.trim().length >= 2 ? note.trim() : `${categoryLabel} expense`,
          vendor,
          amount: parsedAmount,
          receiptStoragePath,
        })
      } catch (saveError) {
        if (receiptStoragePath) await discardExpenseReceipt(receiptStoragePath)
        throw saveError
      }
      try {
        window.localStorage.setItem(lastProjectKey, projectId)
      } catch {
        // Remembering the project is a convenience only.
      }
      showToast(receipt ? 'Expense saved with receipt.' : 'Expense saved — no receipt attached.', 'create')
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this expense.')
    } finally {
      setIsSaving(false)
    }
  }

  return createPortal(<div className="modal-backdrop quick-expense-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="quick-expense-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-expense-title">
      <span className="quick-expense-grabber" aria-hidden="true" />
      <div className="quick-expense-heading">
        <h2 id="quick-expense-title">Add expense</h2>
        <button className="icon-button" type="button" onClick={close} aria-label="Close" disabled={isSaving}><X size={18} /></button>
      </div>
      <form onSubmit={(event) => { void submit(event) }}>
        <label className="quick-expense-amount">
          <span>Amount</span>
          <MoneyInput min="0.01" step="0.01" value={amount} onChange={setAmount} placeholder="0.00" required inputMode="decimal" autoFocus />
        </label>

        <fieldset className="quick-expense-categories">
          <legend>Category</legend>
          <div>
            {quickCategories.map((item) => <button type="button" key={item.value} className={category === item.value ? 'is-selected' : ''} aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
          </div>
        </fieldset>

        {!projectFixed && <label className="form-field">Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
            <option value="">Choose a project</option>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}

        <div className="quick-expense-receipt">
          <span className="quick-expense-label">Receipt</span>
          {receiptPreview
            ? <div className="quick-expense-receipt-preview">
              <img src={receiptPreview} alt="Receipt preview" />
              <button type="button" className="icon-button" onClick={() => { setReceipt(null); setReceiptPreview('') }} aria-label="Remove receipt" disabled={isSaving}><X size={15} /></button>
            </div>
            : <div className="quick-expense-receipt-actions">
              <button type="button" onClick={() => cameraInput.current?.click()} disabled={isSaving}><Camera size={17} />Take photo</button>
              <button type="button" onClick={() => galleryInput.current?.click()} disabled={isSaving}><ImagePlus size={17} />Upload</button>
            </div>}
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { pickReceipt(event.target.files?.[0]); event.target.value = '' }} />
          <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(event) => { pickReceipt(event.target.files?.[0]); event.target.value = '' }} />
          {!receiptPreview && <small>Optional — expenses without a receipt are flagged for follow-up.</small>}
        </div>

        {isDesktop ? <>
          <div className="quick-expense-more-fields">
            <label className="form-field"><span className="quick-expense-date-label">Date{date === todayKey && <em>Today</em>}</span><input type="date" value={date} max={todayKey} onChange={(event) => setDate(event.target.value)} required /></label>
            <label className="form-field">Vendor<input value={vendor} onChange={(event) => setVendor(event.target.value)} maxLength={150} placeholder="Supplier or payee" /></label>
          </div>
          <label className="form-field">Note (optional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="e.g. 20 bags cement" /></label>
        </> : <>
          <label className="form-field">Note (optional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="e.g. 20 bags cement" /></label>
          <button type="button" className="quick-expense-more" onClick={() => setShowMore((open) => !open)} aria-expanded={showMore}>
            More details <ChevronDown size={14} />
          </button>
          {showMore && <div className="quick-expense-more-fields">
            <label className="form-field"><span className="quick-expense-date-label">Date{date === todayKey && <em>Today</em>}</span><input type="date" value={date} max={todayKey} onChange={(event) => setDate(event.target.value)} required /></label>
            <label className="form-field">Vendor<input value={vendor} onChange={(event) => setVendor(event.target.value)} maxLength={150} placeholder="Supplier or payee" /></label>
          </div>}
        </>}

        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="button button-primary quick-expense-save" disabled={isSaving} aria-busy={isSaving}>
          {isSaving ? <><RefreshCw size={15} />{receipt ? 'Uploading receipt…' : 'Saving…'}</> : 'Save expense'}
        </button>
      </form>
    </section>
  </div>, document.body)
}
