import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import type { ProjectChangeOrder, ProjectChangeOrderItem } from '../data/portfolio'
import { createProjectChangeOrder, submitProjectChangeOrder, updateProjectChangeOrderDraft } from '../data/change-orders'
import { MoneyInput } from './MoneyInput'
import { parseMoneyInput } from '../lib/money-input'
import { formatChangeOrderNumber } from '../lib/change-order-number'
import { useToast } from './toast-context'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

const statusLabels: Record<ProjectChangeOrder['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting client sign-off',
  approved: 'Signed off by client',
  rejected: 'Declined by client',
  void: 'Void',
}

type ChangeOrderItemDraft = {
  id: number
  item: string
  description: string
  remarks: string
  cost: string
}

function newItemDraft(id: number): ChangeOrderItemDraft {
  return { id, item: '', description: '', remarks: '', cost: '' }
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

function formatTimeAdjustment(days: number) {
  if (days === 0) return 'No adjustment'
  return `${Math.abs(days)} calendar day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'added' : 'deducted'}`
}

export function ProjectChangeOrderPanel({ projectId, projectPrefix, projectName, clientName, location, contractAmount, specialDiscount, changeOrders, onChanged }: {
  projectId: string
  projectPrefix: string
  projectName: string
  clientName: string
  location: string
  contractAmount: number
  specialDiscount: number
  changeOrders: ProjectChangeOrder[]
  onChanged: () => void
}) {
  const { showToast } = useToast()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<ProjectChangeOrder | null>(null)
  const [previewingOrderId, setPreviewingOrderId] = useState('')
  const [rows, setRows] = useState<ChangeOrderItemDraft[]>([newItemDraft(1)])
  const [timeAdjustmentInput, setTimeAdjustmentInput] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(parseMoneyInput(row.cost)) ? parseMoneyInput(row.cost) : 0), 0)
  const approvedTotal = changeOrders.filter((order) => order.status === 'approved').reduce((sum, order) => sum + order.amount, 0)
  const pendingTotal = changeOrders.filter((order) => order.status === 'pending_approval').reduce((sum, order) => sum + order.amount, 0)
  const draftTotal = changeOrders.filter((order) => order.status === 'draft').reduce((sum, order) => sum + order.amount, 0)
  const rejectedTotal = changeOrders.filter((order) => order.status === 'rejected').reduce((sum, order) => sum + order.amount, 0)
  const voidTotal = changeOrders.filter((order) => order.status === 'void').reduce((sum, order) => sum + order.amount, 0)

  const updateRow = (id: number, updates: Partial<ChangeOrderItemDraft>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...updates } : row))
  }

  const addRow = () => {
    setRows((current) => [...current, newItemDraft(Math.max(...current.map((row) => row.id), 0) + 1)])
  }

  const removeRow = (id: number) => {
    setRows((current) => current.length > 1 ? current.filter((row) => row.id !== id) : current)
  }

  const closeCreateDialog = () => {
    if (!isSaving) {
      setIsCreateOpen(false)
      setEditingOrder(null)
      setRows([newItemDraft(1)])
      setTimeAdjustmentInput('')
      setError('')
    }
  }

  const openCreateDialog = () => {
    setEditingOrder(null)
    setRows([newItemDraft(1)])
    setTimeAdjustmentInput('')
    setError('')
    setIsCreateOpen(true)
  }

  const openEditDialog = (order: ProjectChangeOrder) => {
    setEditingOrder(order)
    setRows(order.items.map((item, index) => ({
      id: index + 1,
      item: item.item,
      description: item.description,
      remarks: item.remarks,
      cost: String(item.cost),
    })))
    setTimeAdjustmentInput(String(order.contractTimeAdjustmentDays))
    setError('')
    setIsCreateOpen(true)
  }

  const addDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    const invalidItemIndex = rows.findIndex((row) => !row.item.trim())
    if (invalidItemIndex >= 0) {
      setError(`Enter an item name for row ${invalidItemIndex + 1}.`)
      return
    }
    const invalidCostIndex = rows.findIndex((row) => !Number.isFinite(parseMoneyInput(row.cost)) || parseMoneyInput(row.cost) <= 0)
    if (invalidCostIndex >= 0) {
      setError(`Enter a cost greater than zero for row ${invalidCostIndex + 1}.`)
      return
    }
    if (!/^-?\d+$/.test(timeAdjustmentInput)) {
      setError('Enter the contract time adjustment as a whole number of days. Use a negative number to deduct days.')
      return
    }
    const items: ProjectChangeOrderItem[] = rows.map(({ item, description, remarks, cost }) => ({
      item: item.trim(),
      description: description.trim(),
      remarks: remarks.trim(),
      cost: parseMoneyInput(cost),
    }))
    setIsSaving(true)
    try {
      if (editingOrder) {
        await updateProjectChangeOrderDraft({
          projectId,
          changeOrderId: editingOrder.id,
          items,
          contractTimeAdjustmentDays: Number(timeAdjustmentInput),
        })
      } else {
        await createProjectChangeOrder({
          projectId,
          items,
          contractTimeAdjustmentDays: Number(timeAdjustmentInput),
        })
      }
      setRows([newItemDraft(1)])
      setTimeAdjustmentInput('')
      setIsCreateOpen(false)
      setEditingOrder(null)
      const successMessage = editingOrder ? 'Draft change order updated.' : 'Change order saved as a draft.'
      setMessage(successMessage)
      showToast(successMessage, editingOrder ? 'update' : 'create')
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this change order.')
    } finally {
      setIsSaving(false)
    }
  }

  const previewDraftPdf = async (order: ProjectChangeOrder) => {
    const previewWindow = window.open('', '_blank')
    if (!previewWindow) {
      setError('Allow pop-ups to view the change-order PDF.')
      return
    }
    previewWindow.document.title = 'Preparing change-order PDF'
    previewWindow.document.body.textContent = 'Preparing change-order PDF…'
    setPreviewingOrderId(order.id)
    setError('')
    try {
      const { createChangeOrderPdf } = await import('../lib/change-order-pdf')
      const pdf = await createChangeOrderPdf({
        projectName,
        clientName,
        location,
        changeOrderNumber: formatChangeOrderNumber(projectPrefix, order.orderNumber),
        title: order.title,
        description: order.description,
        amount: order.amount,
        items: order.items,
        contractTimeAdjustmentDays: order.contractTimeAdjustmentDays,
        issuedAt: order.createdAt,
      })
      const objectUrl = URL.createObjectURL(pdf.output('blob'))
      previewWindow.location.href = objectUrl
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (previewError) {
      previewWindow.close()
      setError(previewError instanceof Error ? previewError.message : 'Could not prepare the change-order PDF.')
    } finally {
      setPreviewingOrderId('')
    }
  }

  const submitForApproval = async (order: ProjectChangeOrder) => {
    setError('')
    setIsSaving(true)
    try {
      await submitProjectChangeOrder({
        projectId,
        changeOrderId: order.id,
        projectPrefix,
        orderNumber: order.orderNumber,
        projectName,
        clientName,
        location,
        title: order.title,
        description: order.description,
        amount: order.amount,
        items: order.items,
        contractTimeAdjustmentDays: order.contractTimeAdjustmentDays,
      })
      showToast('Change order submitted to the client for sign-off.', 'update')
      onChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit this change order.')
    } finally {
      setIsSaving(false)
    }
  }

  return <section className="surface-card tab-content project-change-order-panel">
    <div className="card-heading-row"><h2>Change orders</h2><span className="project-milestone-count">{changeOrders.length} order{changeOrders.length === 1 ? '' : 's'}</span></div>
    <div className="change-order-totals">
      <div><span>Original contract</span><strong>{money.format(contractAmount)}</strong></div>
      <div><span>Special discount</span><strong>− {money.format(specialDiscount)}</strong></div>
      <div><span>Approved extras</span><strong>{money.format(approvedTotal)}</strong></div>
      <div><span>Pending approval</span><strong>{money.format(pendingTotal)}</strong></div>
      <div><span>Drafts</span><strong>{money.format(draftTotal)}</strong></div>
      <div><span>Rejected</span><strong>{money.format(rejectedTotal)}</strong></div>
      <div><span>Void</span><strong>{money.format(voidTotal)}</strong></div>
      <div><span>Current contract total</span><strong>{money.format(contractAmount - specialDiscount + approvedTotal)}</strong></div>
    </div>
    <div className="change-order-create-action">
      <button type="button" className="button button-primary change-order-open-dialog" onClick={openCreateDialog}><Plus size={15} />Create a change order</button>
    </div>
    {error && !isCreateOpen && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="document-success change-order-success" role="status">{message}</p>}
    <div className="section-kicker change-order-history-heading">Change-order history</div>
    {changeOrders.length ? <div className="change-order-list">{changeOrders.map((order) => (
      <div className="change-order-item" key={order.id}>
        <article className={`change-order-row${order.status === 'draft' ? ' change-order-row-draft' : ''}`}>
          <div className="change-order-copy">
            <strong>{order.title}</strong>
            <span className="change-order-number">{formatChangeOrderNumber(projectPrefix, order.orderNumber)}</span>
            <small>{order.items.length} item{order.items.length === 1 ? '' : 's'} · {formatTimeAdjustment(order.contractTimeAdjustmentDays)}</small>
            <small>Created {formatDate(order.createdAt)}{order.decidedAt ? ` · Decided ${formatDate(order.decidedAt)}` : ''}</small>
            <span className={`change-order-status change-order-status-${order.status}`}>{statusLabels[order.status]}</span>
            {order.decisionNote && <p className="change-order-decision-note">Client note: {order.decisionNote}</p>}
          </div>
          <strong className="change-order-amount">{money.format(order.amount)}</strong>
          {order.status === 'draft' && <div className="change-order-draft-actions">
            <button type="button" className="button button-secondary" onClick={() => openEditDialog(order)} disabled={isSaving}><Pencil size={14} />Edit draft</button>
            <button type="button" className="button button-secondary" onClick={() => { void previewDraftPdf(order) }} disabled={isSaving || previewingOrderId === order.id}><Eye size={14} />{previewingOrderId === order.id ? 'Preparing…' : 'View PDF'}</button>
            <button type="button" className="button button-secondary" onClick={() => { void submitForApproval(order) }} disabled={isSaving}><Send size={14} />{isSaving ? 'Submitting…' : 'Submit to client'}</button>
          </div>}
        </article>
      </div>
    ))}</div> : <p className="client-empty-note">No change orders yet.</p>}
    {isCreateOpen && createPortal(<div className="modal-backdrop change-order-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreateDialog() }}>
      <section className="project-modal change-order-dialog" role="dialog" aria-modal="true" aria-labelledby="change-order-dialog-title">
        <div className="modal-heading">
          <div><div className="section-kicker">Additional project work</div><h2 id="change-order-dialog-title">{editingOrder ? 'Edit change-order draft' : 'Create a change order'}</h2></div>
          <button className="icon-button" type="button" onClick={closeCreateDialog} aria-label="Close" disabled={isSaving}><X size={18} /></button>
        </div>
        <p className="modal-intro">Add each item with its description, remarks, and cost. The total is calculated automatically.</p>
        <form onSubmit={(event) => { void addDraft(event) }}>
          <div className="change-order-line-items">
            {rows.map((row, index) => <fieldset className="change-order-line-item" key={row.id}>
              <legend>Item {index + 1}</legend>
              <div className="change-order-line-item-fields">
                <label className="form-field">Item<input value={row.item} onChange={(event) => updateRow(row.id, { item: event.target.value })} maxLength={150} placeholder="e.g. Temporary fencing" required /></label>
                <label className="form-field">Cost<MoneyInput min="0.01" step="0.01" value={row.cost} onChange={(value) => updateRow(row.id, { cost: value })} placeholder="0.00" required /></label>
                <label className="form-field change-order-item-description">Description<textarea value={row.description} onChange={(event) => updateRow(row.id, { description: event.target.value })} maxLength={2000} rows={5} placeholder="Describe the work or material" /></label>
                <label className="form-field change-order-item-remarks">Remarks<textarea value={row.remarks} onChange={(event) => updateRow(row.id, { remarks: event.target.value })} maxLength={2000} rows={3} placeholder="Include cost notes, coordination, or context" /></label>
              </div>
              <button type="button" className="icon-button change-order-remove-item" onClick={() => removeRow(row.id)} aria-label={`Remove item ${index + 1}`} title="Remove item" disabled={rows.length === 1 || isSaving}><Trash2 size={16} /></button>
            </fieldset>)}
          </div>
          <button type="button" className="button button-secondary change-order-add-item" onClick={addRow} disabled={isSaving}><Plus size={15} />Add another item</button>
          <div className="change-order-form-summary">
            <label className="form-field">Contract time adjustment (calendar days)<input type="number" min="-2147483648" max="2147483647" step="1" value={timeAdjustmentInput} onChange={(event) => setTimeAdjustmentInput(event.target.value)} placeholder="Enter days; use a negative number to deduct" required /></label>
            <div className="change-order-form-total"><span>Total change-order cost</span><strong>{money.format(total)}</strong></div>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="change-order-help">Drafts do not change contract totals until the client approves them.</p>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeCreateDialog} disabled={isSaving}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}><Plus size={15} />{isSaving ? 'Saving…' : editingOrder ? 'Save draft changes' : 'Save as draft'}</button></div>
        </form>
      </section>
    </div>, document.body)}
  </section>
}
