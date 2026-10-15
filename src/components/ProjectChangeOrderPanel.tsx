import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import type { ProjectChangeOrder, ProjectChangeOrderItem } from '../data/portfolio'
import { createProjectChangeOrder, submitProjectChangeOrder, updateProjectChangeOrderDraft } from '../data/change-orders'
import { MoneyInput } from './MoneyInput'
import { parseMoneyInput } from '../lib/money-input'
import { formatChangeOrderNumber } from '../lib/change-order-number'
import { useToast } from './toast-context'
import { CountUp, EmptyArt } from './Motion'

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

export function ContractImpactCard({ contractAmount, specialDiscount, changeOrders, changeOrderOutstanding, footnote, onOpenChangeOrders }: {
  contractAmount: number
  changeOrderOutstanding?: number
  footnote?: string
  specialDiscount: number
  changeOrders: ProjectChangeOrder[]
  onOpenChangeOrders?: () => void
}) {
  const sumOf = (status: ProjectChangeOrder['status']) => changeOrders.filter((order) => order.status === status).reduce((sum, order) => sum + order.amount, 0)
  const approvedTotal = sumOf('approved')
  const pendingTotal = sumOf('pending_approval')
  const draftTotal = sumOf('draft')
  const approvedCount = changeOrders.filter((order) => order.status === 'approved').length
  return <aside className="co-impact" aria-label="Contract impact">
    <div className="co-impact-heading">
      <h3>Contract impact</h3>
      {onOpenChangeOrders && <button type="button" onClick={onOpenChangeOrders}>Change orders ›</button>}
    </div>
    <dl>
      <div><dt>Original contract</dt><dd>{money.format(contractAmount)}</dd></div>
      <div><dt>Special discount</dt><dd>− {money.format(specialDiscount)}</dd></div>
      <div><dt>Approved changes{approvedCount ? ` (${approvedCount})` : ''}</dt><dd>+ {money.format(approvedTotal)}</dd></div>
      <div className="is-total"><dt>Revised contract</dt><dd><CountUp value={money.format(contractAmount - specialDiscount + approvedTotal)} /></dd></div>
    </dl>
    {changeOrderOutstanding !== undefined && approvedTotal > 0 && <div className="co-impact-status">
      <div className="co-impact-status-head"><span>Change orders total</span><strong>{money.format(approvedTotal)}</strong></div>
      <div className="co-impact-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, (approvedTotal - changeOrderOutstanding) / approvedTotal * 100))}%` }} /></div>
      <div className="co-impact-status-foot"><span><i className="is-paid" />Collected {money.format(approvedTotal - changeOrderOutstanding)}</span><span className={changeOrderOutstanding > 0 ? 'is-due' : ''}><i className="is-due" />To collect {money.format(changeOrderOutstanding)}</span></div>
    </div>}
    {(pendingTotal > 0 || draftTotal > 0) && <ul className="co-impact-other">
      {pendingTotal > 0 && <li><span>Awaiting sign-off</span><span>{money.format(pendingTotal)}</span></li>}
      {draftTotal > 0 && <li><span>Drafts</span><span>{money.format(draftTotal)}</span></li>}
    </ul>}
    {footnote && <p className="co-impact-foot">{footnote}</p>}
  </aside>
}

export function ProjectChangeOrderPanel({ projectId, projectPrefix, projectName, clientName, location, changeOrders, onChanged }: {
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
  const [viewingOrderId, setViewingOrderId] = useState('')
  const [rows, setRows] = useState<ChangeOrderItemDraft[]>([newItemDraft(1)])
  const [timeAdjustmentInput, setTimeAdjustmentInput] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(parseMoneyInput(row.cost)) ? parseMoneyInput(row.cost) : 0), 0)

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

  const viewingOrder = changeOrders.find((order) => order.id === viewingOrderId) ?? null
  const shortDate = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(date)
  }
  const daysLabel = (days: number) => days === 0 ? 'No time change' : `${days > 0 ? '+' : '−'}${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`

  return <section className="tab-content project-change-order-panel co-layout is-single">
    <div className="surface-card co-main">
      <header className="co-header">
        <div><h2>Change orders</h2><p>{changeOrders.length} order{changeOrders.length === 1 ? '' : 's'}</p></div>
        <button type="button" className="button button-primary change-order-open-dialog" onClick={openCreateDialog}><Plus size={15} />New change order</button>
      </header>
      {error && !isCreateOpen && !viewingOrder && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="document-success change-order-success" role="status">{message}</p>}
      {changeOrders.length ? <div className="co-table" role="table" aria-label="Change orders">
        <div className="co-table-head" role="row"><span role="columnheader">No.</span><span role="columnheader">Description</span><span role="columnheader">Status</span><span role="columnheader">Amount</span></div>
        {changeOrders.map((order) => <button type="button" role="row" key={order.id} className={`co-table-row is-${order.status}`} onClick={() => { setError(''); setViewingOrderId(order.id) }} aria-label={`Open ${formatChangeOrderNumber(projectPrefix, order.orderNumber)}`}>
          <span className="co-number" role="cell">{formatChangeOrderNumber(projectPrefix, order.orderNumber)}</span>
          <span className="co-desc" role="cell"><strong>{order.title}</strong><small>{order.items.length} item{order.items.length === 1 ? '' : 's'} · {daysLabel(order.contractTimeAdjustmentDays)} · {shortDate(order.createdAt)}</small></span>
          <span role="cell"><span className={`co-status is-${order.status}`}>{statusLabels[order.status]}</span></span>
          <strong className="co-amount" role="cell">{money.format(order.amount)}</strong>
        </button>)}
      </div> : <div className="pr-empty">
        <EmptyArt kind="document" />
        <strong>No change orders yet</strong>
        <p>Create one when the client asks for extra work or a scope change.</p>
      </div>}
    </div>


    {viewingOrder && createPortal(<div className="modal-backdrop payroll-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setViewingOrderId('') }}>
      <section className="project-modal payroll-worker-drawer co-drawer" role="dialog" aria-modal="true" aria-labelledby="co-drawer-title">
        <div className="modal-heading">
          <div><div className="section-kicker">{formatChangeOrderNumber(projectPrefix, viewingOrder.orderNumber)}</div><h2 id="co-drawer-title">{viewingOrder.title}</h2></div>
          <button className="icon-button" type="button" onClick={() => setViewingOrderId('')} aria-label="Close" disabled={isSaving}><X size={18} /></button>
        </div>
        <div className="co-drawer-summary">
          <span className={`co-status is-${viewingOrder.status}`}>{statusLabels[viewingOrder.status]}</span>
          <strong>{money.format(viewingOrder.amount)}</strong>
        </div>
        <dl className="co-drawer-facts">
          <div><dt>Contract time</dt><dd>{formatTimeAdjustment(viewingOrder.contractTimeAdjustmentDays)}</dd></div>
          <div><dt>Created</dt><dd>{formatDate(viewingOrder.createdAt)}</dd></div>
          {viewingOrder.decidedAt && <div><dt>Decided</dt><dd>{formatDate(viewingOrder.decidedAt)}</dd></div>}
        </dl>
        <div className="co-drawer-items">
          <div className="section-kicker">Items</div>
          {viewingOrder.items.map((item, index) => <div className="co-drawer-item" key={index}>
            <div><strong>{item.item}</strong>{item.description && <p>{item.description}</p>}{item.remarks && <small>{item.remarks}</small>}</div>
            <span>{money.format(item.cost)}</span>
          </div>)}
        </div>
        {viewingOrder.decisionNote && <p className="co-note">Client note: {viewingOrder.decisionNote}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="milestone-drawer-actions">
          <button type="button" className="button button-secondary" onClick={() => { void previewDraftPdf(viewingOrder) }} disabled={isSaving || previewingOrderId === viewingOrder.id}><Eye size={14} />{previewingOrderId === viewingOrder.id ? 'Preparing…' : 'View PDF'}</button>
          <span />
          {viewingOrder.status === 'draft' && <>
            <button type="button" className="button button-secondary" onClick={() => { setViewingOrderId(''); openEditDialog(viewingOrder) }} disabled={isSaving}><Pencil size={14} />Edit draft</button>
            <button type="button" className="button button-primary" onClick={() => { void submitForApproval(viewingOrder).then(() => setViewingOrderId('')) }} disabled={isSaving}><Send size={14} />{isSaving ? 'Submitting…' : 'Submit to client'}</button>
          </>}
        </div>
      </section>
    </div>, document.body)}
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
