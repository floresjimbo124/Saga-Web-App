import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Banknote, ClipboardList, FileText, Flag, History, Receipt, Settings2, Wallet } from 'lucide-react'
import { loadActivityLog, loadClientErrors, type ActivityEntry, type ClientErrorEntry } from '../data/insights'
import { EmptyArt, SkeletonRows } from './Motion'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const timeFormat = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

type Described = { icon: React.ReactNode; tone: 'money' | 'billing' | 'change' | 'schedule' | 'cost' | 'danger' | 'neutral'; title: string; detail?: string }

const num = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
const peso = (value: unknown) => Number.isFinite(num(value)) ? money.format(num(value)) : ''
const text = (value: unknown) => typeof value === 'string' ? value : ''
const label = (value: unknown) => text(value).replaceAll('_', ' ')
const dateText = (value: unknown) => {
  const raw = text(value)
  if (!raw) return 'none'
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw)
  return Number.isNaN(date.getTime()) ? raw : shortDate.format(date)
}

function changed(entry: ActivityEntry, key: string) {
  return JSON.stringify(entry.oldData?.[key] ?? null) !== JSON.stringify(entry.newData?.[key] ?? null)
}

/** Turns a raw audit row into a plain-language sentence. */
export function describeActivity(entry: ActivityEntry): Described {
  const data = entry.newData ?? entry.oldData ?? {}
  const before = entry.oldData ?? {}
  const op = entry.operation
  switch (entry.tableName) {
    case 'payments':
      if (op === 'INSERT') return { icon: <Wallet size={15} />, tone: 'money', title: `Recorded a payment of ${peso(data.amount)}`, detail: [text(data.payer_name) && `from ${text(data.payer_name)}`, text(data.receipt_number)].filter(Boolean).join(' · ') }
      if (op === 'UPDATE' && data.voided_at && !before.voided_at) return { icon: <Wallet size={15} />, tone: 'danger', title: `Voided payment ${text(data.receipt_number)}`, detail: peso(data.amount) }
      if (op === 'UPDATE') return { icon: <Wallet size={15} />, tone: 'money', title: `Edited payment ${text(data.receipt_number)}`, detail: changed(entry, 'amount') ? `${peso(before.amount)} → ${peso(data.amount)}` : changed(entry, 'payment_type') ? `Type: ${label(before.payment_type)} → ${label(data.payment_type)}` : undefined }
      return { icon: <Wallet size={15} />, tone: 'danger', title: 'Deleted a payment', detail: peso(data.amount) }
    case 'progress_billings':
      if (op === 'INSERT') return { icon: <FileText size={15} />, tone: 'billing', title: `Issued Billing #${String(num(data.billing_number)).padStart(3, '0')}`, detail: `${peso(data.amount_for_billing)} · ${num(data.progress_percent)}% complete` }
      if (data.status === 'void' && before.status !== 'void') return { icon: <FileText size={15} />, tone: 'danger', title: `Voided Billing #${String(num(data.billing_number)).padStart(3, '0')}`, detail: text(data.void_reason) || undefined }
      return { icon: <FileText size={15} />, tone: 'billing', title: `Updated Billing #${String(num(data.billing_number)).padStart(3, '0')}` }
    case 'project_change_orders':
      if (op === 'INSERT') return { icon: <ClipboardList size={15} />, tone: 'change', title: `Created change order “${text(data.title) || 'Untitled'}”`, detail: peso(data.amount) }
      if (op === 'DELETE') return { icon: <ClipboardList size={15} />, tone: 'danger', title: `Deleted change order “${text(data.title) || 'Untitled'}”`, detail: peso(data.amount) }
      if (changed(entry, 'status')) return { icon: <ClipboardList size={15} />, tone: 'change', title: `Change order “${text(data.title)}” ${data.status === 'approved' ? 'was approved' : data.status === 'rejected' ? 'was declined' : data.status === 'pending_approval' ? 'was sent to the client' : `is now ${label(data.status)}`}`, detail: peso(data.amount) }
      return { icon: <ClipboardList size={15} />, tone: 'change', title: `Edited change order “${text(data.title)}”`, detail: peso(data.amount) }
    case 'project_financial_terms': {
      const parts = [
        changed(entry, 'contract_amount') && `Contract ${peso(before.contract_amount)} → ${peso(data.contract_amount)}`,
        changed(entry, 'special_discount') && `Discount ${peso(before.special_discount)} → ${peso(data.special_discount)}`,
        changed(entry, 'down_payment_percent') && `Down payment ${num(before.down_payment_percent)}% → ${num(data.down_payment_percent)}%`,
        changed(entry, 'retention_rate_percent') && `Retention ${num(before.retention_rate_percent)}% → ${num(data.retention_rate_percent)}%`,
      ].filter(Boolean) as string[]
      return { icon: <Settings2 size={15} />, tone: 'neutral', title: op === 'INSERT' ? `Set up the contract at ${peso(data.contract_amount)}` : 'Updated contract terms', detail: parts.join(' · ') || undefined }
    }
    case 'projects': {
      const parts = [
        changed(entry, 'progress_percent') && `Progress ${num(before.progress_percent)}% → ${num(data.progress_percent)}%`,
        changed(entry, 'status') && `Status ${label(before.status)} → ${label(data.status)}`,
        changed(entry, 'health_status') && `Health ${label(before.health_status)} → ${label(data.health_status)}`,
        changed(entry, 'deadline') && `Target date ${dateText(before.deadline)} → ${dateText(data.deadline)}`,
        changed(entry, 'start_date') && `Start date ${dateText(before.start_date)} → ${dateText(data.start_date)}`,
      ].filter(Boolean) as string[]
      return { icon: <Flag size={15} />, tone: 'schedule', title: 'Updated the project', detail: parts.join(' · ') || undefined }
    }
    case 'project_cost_forecasts':
      return { icon: <Banknote size={15} />, tone: 'cost', title: `Set the cost budget to ${peso(data.cost_budget)}`, detail: `Estimated cost to complete ${peso(data.estimated_cost_to_complete)}` }
    case 'retention_ledger':
      return { icon: <Banknote size={15} />, tone: 'money', title: `Retention ${text(data.entry_type) === 'released' ? 'released' : 'held'}`, detail: peso(data.amount) }
    case 'project_expenses':
      if (op === 'INSERT') return { icon: <Receipt size={15} />, tone: 'cost', title: `Added an expense of ${peso(data.amount)}`, detail: [text(data.description), label(data.category)].filter(Boolean).join(' · ') }
      if (op === 'DELETE') return { icon: <Receipt size={15} />, tone: 'danger', title: `Removed an expense of ${peso(data.amount)}`, detail: text(data.description) || undefined }
      return { icon: <Receipt size={15} />, tone: 'cost', title: 'Edited an expense', detail: changed(entry, 'amount') ? `${peso(before.amount)} → ${peso(data.amount)}` : text(data.description) || undefined }
    case 'project_milestones':
      if (op === 'INSERT') return { icon: <Flag size={15} />, tone: 'schedule', title: `Added milestone “${text(data.name)}”` }
      if (op === 'DELETE') return { icon: <Flag size={15} />, tone: 'danger', title: `Deleted milestone “${text(data.name)}”` }
      if (changed(entry, 'completion_percent')) return { icon: <Flag size={15} />, tone: 'schedule', title: `Milestone “${text(data.name)}” ${num(data.completion_percent) >= 100 ? 'completed' : 'progress updated'}`, detail: `${num(before.completion_percent)}% → ${num(data.completion_percent)}%` }
      return { icon: <Flag size={15} />, tone: 'schedule', title: `Edited milestone “${text(data.name)}”` }
    default:
      return { icon: <History size={15} />, tone: 'neutral', title: `${op === 'INSERT' ? 'Added' : op === 'DELETE' ? 'Deleted' : 'Updated'} ${label(entry.tableName)}` }
  }
}

export function ActivityPanel({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [errors, setErrors] = useState<ClientErrorEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const [activity, clientErrors] = await Promise.all([loadActivityLog(undefined, 60), loadClientErrors(10).catch(() => [])])
      setEntries(activity)
      setErrors(clientErrors)
      setHasMore(activity.length === 60)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load activity.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const loadMore = async () => {
    const last = entries[entries.length - 1]
    if (!last) return
    setIsLoadingMore(true)
    try {
      const more = await loadActivityLog(last.occurredAt, 60)
      setEntries((current) => [...current, ...more.filter((item) => !current.some((existing) => existing.id === item.id))])
      setHasMore(more.length === 60)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load more activity.')
    } finally {
      setIsLoadingMore(false)
    }
  }

  const projects = Array.from(new Map(entries.filter((entry) => entry.projectId).map((entry) => [entry.projectId!, entry.projectName ?? 'Project'])).entries())
  const visible = projectFilter === 'all' ? entries : entries.filter((entry) => entry.projectId === projectFilter)
  const groups: { day: string; items: ActivityEntry[] }[] = []
  for (const entry of visible) {
    const day = dayFormat.format(new Date(entry.occurredAt))
    const group = groups[groups.length - 1]
    if (group?.day === day) group.items.push(entry)
    else groups.push({ day, items: [entry] })
  }

  return <div className="act-page">
    <section className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" />Workspace</div>
        <h1>Activity history</h1>
        <p className="act-intro">Every change to money, contracts and schedules — who made it and when.</p>
      </div>
      {projects.length > 1 && <label className="select-wrap act-filter"><span className="sr-only">Filter by project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    </section>

    {errors.length > 0 && <section className="act-errors" aria-label="Recent app errors">
      <div className="act-errors-head"><AlertTriangle size={16} aria-hidden="true" /><strong>{errors.length} recent app error{errors.length === 1 ? '' : 's'}</strong><span>Reported automatically from users’ browsers</span></div>
      <ul>{errors.slice(0, 5).map((error) => <li key={error.id}><span>{error.message}</span><small>{shortDate.format(new Date(error.occurredAt))} · {timeFormat.format(new Date(error.occurredAt))}{error.pageUrl ? ` · ${/\/\/(localhost|127\.0\.0\.1)/.test(error.pageUrl) ? 'Local preview' : 'Live app'} · ${new URL(error.pageUrl, window.location.origin).pathname}` : ''}</small></li>)}</ul>
    </section>}

    {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="text-button" onClick={() => { void load() }}>Retry</button></p>}

    {isLoading ? <SkeletonRows rows={6} label="Loading activity" />
      : !visible.length ? <div className="pr-empty"><EmptyArt kind="clipboard" /><strong>No activity yet</strong><p>Payments, billings, change orders and contract changes will be listed here as they happen.</p></div>
        : <div className="act-groups">{groups.map((group) => <section key={group.day} className="act-group" aria-label={group.day}>
          <h2>{group.day}</h2>
          <ol className="act-list">{group.items.map((entry) => {
            const described = describeActivity(entry)
            return <li key={entry.id} className={`act-item tone-${described.tone}`}>
              <span className="act-icon" aria-hidden="true">{described.icon}</span>
              <span className="act-copy">
                <strong>{described.title}</strong>
                {described.detail && <span className="act-detail">{described.detail}</span>}
                <small>
                  {entry.actorName}{entry.projectName && <> · {entry.projectId ? <button type="button" className="act-project" onClick={() => onOpenProject(entry.projectId!)}>{entry.projectName}</button> : entry.projectName}</>}
                </small>
              </span>
              <time dateTime={entry.occurredAt}>{timeFormat.format(new Date(entry.occurredAt))}</time>
            </li>
          })}</ol>
        </section>)}</div>}

    {!isLoading && hasMore && visible.length > 0 && <div className="act-more"><button type="button" className="button button-secondary" disabled={isLoadingMore} onClick={() => { void loadMore() }} aria-busy={isLoadingMore}>{isLoadingMore ? 'Loading…' : 'Load older activity'}</button></div>}
  </div>
}
