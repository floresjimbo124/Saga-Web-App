import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EmptyArt } from './Motion'
import { createPortal } from 'react-dom'
import { Camera, ChevronRight, Eye, EyeOff, Image as ImageIcon, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import {
  createProjectMilestonePhotoUrl,
  createProjectMilestone,
  deleteProjectMilestonePhoto,
  deleteProjectMilestone,
  uploadProjectMilestonePhoto,
  updateProjectMilestone,
  type ProjectMilestone,
  type ProjectMilestoneStatus,
  type SaveProjectMilestoneInput,
} from '../data/project-milestones'
import { useToast } from './toast-context'

const statusOptions: { value: ProjectMilestoneStatus; label: string }[] = [
  { value: 'pending', label: 'Upcoming' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'blocked', label: 'Blocked' },
]

function todayLocal() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

function addMonth(value: string) {
  const date = new Date(`${value}T00:00:00`)
  date.setMonth(date.getMonth() + 1)
  date.setDate(date.getDate() - 1)
  return dateKey(date)
}

/** Status follows completion; only "blocked" is chosen by hand. */
function statusFor(completionPercent: number, blocked: boolean): ProjectMilestoneStatus {
  if (blocked) return 'blocked'
  if (completionPercent >= 100) return 'complete'
  if (completionPercent > 0) return 'in_progress'
  return 'pending'
}

const shortDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
function formatShort(value: string | null) {
  return value ? shortDate.format(new Date(`${value}T00:00:00`)) : ''
}

const durationShortcuts = [
  { label: '1 wk', end: (start: string) => addDays(start, 6) },
  { label: '2 wks', end: (start: string) => addDays(start, 13) },
  { label: '1 mo', end: (start: string) => addMonth(start) },
]

function MilestoneThumb({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    void createProjectMilestonePhotoUrl(path).then((signed) => { if (active) setUrl(signed) }).catch(() => undefined)
    return () => { active = false }
  }, [path])
  return url
    ? <img className="milestone-list-thumb" src={url} alt={`${name} photo`} loading="lazy" />
    : <span className="milestone-list-thumb is-loading" aria-hidden="true"><ImageIcon size={14} /></span>
}

function MilestoneEditor({ projectId, milestone, defaultStartDate, onClose, onChanged }: {
  projectId: string
  milestone: ProjectMilestone | null
  defaultStartDate: string
  onClose: () => void
  onChanged: () => void
}) {
  const { showToast } = useToast()
  const isNew = milestone === null
  const [name, setName] = useState(milestone?.name ?? '')
  const [startDate, setStartDate] = useState(milestone ? milestone.startDate ?? '' : defaultStartDate)
  const [plannedDate, setPlannedDate] = useState(milestone?.plannedDate ?? '')
  const [actualDate, setActualDate] = useState(milestone?.actualDate ?? '')
  const [completionPercent, setCompletionPercent] = useState(String(milestone?.completionPercent ?? 0))
  const [blocked, setBlocked] = useState(milestone?.status === 'blocked')
  const [clientVisible, setClientVisible] = useState(milestone?.clientVisible ?? true)
  const [newPhoto, setNewPhoto] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [isPhotoWorking, setIsPhotoWorking] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  const percentValue = Math.min(100, Math.max(0, Number(completionPercent) || 0))
  const status = statusFor(percentValue, blocked)
  const isComplete = status === 'complete'
  const statusLabel = statusOptions.find((option) => option.value === status)?.label ?? ''

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isSaving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSaving, onClose])

  useEffect(() => {
    let active = true
    if (milestone?.photoStoragePath) {
      void createProjectMilestonePhotoUrl(milestone.photoStoragePath)
        .then((url) => { if (active) setPhotoUrl(url) })
        .catch((photoLoadError: unknown) => {
          if (active) setPhotoError(photoLoadError instanceof Error ? photoLoadError.message : 'Could not load this milestone photo.')
        })
    }
    return () => { active = false }
  }, [milestone?.photoStoragePath])

  const buildInput = (): SaveProjectMilestoneInput => ({
    projectId,
    name,
    startDate: startDate || null,
    plannedDate: plannedDate || null,
    actualDate: isComplete ? actualDate || plannedDate || todayLocal() : null,
    completionPercent: percentValue,
    status,
    clientVisible,
  })

  const uploadPhoto = async (file: File) => {
    if (!milestone) return
    setPhotoError('')
    setIsPhotoWorking(true)
    try {
      const storagePath = await uploadProjectMilestonePhoto(projectId, milestone.id, file, milestone.photoStoragePath)
      setPhotoUrl(await createProjectMilestonePhotoUrl(storagePath))
      showToast(milestone.photoStoragePath ? 'Milestone photo updated.' : 'Milestone photo attached.', milestone.photoStoragePath ? 'update' : 'create')
      onChanged()
    } catch (uploadError) {
      setPhotoError(uploadError instanceof Error ? uploadError.message : 'Could not upload this milestone photo.')
      onChanged()
    } finally {
      if (photoInput.current) photoInput.current.value = ''
      setIsPhotoWorking(false)
    }
  }

  const removePhoto = async () => {
    if (!milestone?.photoStoragePath) return
    setPhotoError('')
    setIsPhotoWorking(true)
    try {
      await deleteProjectMilestonePhoto(projectId, milestone.id, milestone.photoStoragePath)
      setPhotoUrl('')
      showToast('Milestone photo removed.', 'delete')
      onChanged()
    } catch (removeError) {
      setPhotoError(removeError instanceof Error ? removeError.message : 'Could not remove this milestone photo.')
      onChanged()
    } finally {
      setIsPhotoWorking(false)
    }
  }

  const save = async (addAnother: boolean) => {
    setError('')
    setIsSaving(true)
    try {
      const input = buildInput()
      if (milestone) {
        await updateProjectMilestone(milestone.id, input)
        showToast('Milestone updated.', 'update')
      } else {
        const newId = await createProjectMilestone(input)
        if (newPhoto && input.status === 'complete') {
          try {
            await uploadProjectMilestonePhoto(projectId, newId, newPhoto, null)
          } catch (uploadError) {
            showToast(uploadError instanceof Error ? `Milestone created, but the photo failed: ${uploadError.message}` : 'Milestone created, but the photo could not be uploaded.', 'update')
          }
        }
        showToast('Milestone created.')
      }
      onChanged()
      if (addAnother && !milestone) {
        const nextStart = input.plannedDate ? addDays(input.plannedDate, 1) : startDate
        setName('')
        setStartDate(nextStart)
        setPlannedDate('')
        setActualDate('')
        setCompletionPercent('0')
        setBlocked(false)
        setNewPhoto(null)
        nameInput.current?.focus()
      } else {
        onClose()
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this milestone.')
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    if (!milestone || !window.confirm(`Delete the "${milestone.name}" milestone?`)) return
    setError('')
    setIsSaving(true)
    try {
      await deleteProjectMilestone(projectId, milestone.id)
      showToast('Milestone deleted.', 'delete')
      onChanged()
      onClose()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this milestone.')
      setIsSaving(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void save(false)
  }

  return createPortal(<div className="modal-backdrop payroll-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose() }}>
    <form className="project-modal payroll-worker-drawer milestone-drawer" role="dialog" aria-modal="true" aria-labelledby="milestone-drawer-title" onSubmit={onSubmit}>
      <div className="modal-heading">
        <div><div className="section-kicker">{isNew ? 'New milestone' : 'Edit milestone'}</div><h2 id="milestone-drawer-title">{isNew ? 'Add a milestone' : milestone.name}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close" disabled={isSaving}><X size={18} /></button>
      </div>

      <label className="form-field">Milestone name<input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Second floor slab" maxLength={120} required autoFocus={isNew} /></label>

      <div className="milestone-drawer-dates">
        <label className="form-field">Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label className="form-field">End date / target<input type="date" value={plannedDate} min={startDate || undefined} onChange={(event) => setPlannedDate(event.target.value)} /></label>
      </div>
      <div className="milestone-duration-chips" role="group" aria-label="Set end date from start date">
        <span>Duration</span>
        {durationShortcuts.map((shortcut) => {
          const end = startDate ? shortcut.end(startDate) : ''
          return <button key={shortcut.label} type="button" className={`gantt-chip${end && end === plannedDate ? ' is-selected' : ''}`} disabled={!startDate} onClick={() => setPlannedDate(end)}>{shortcut.label}</button>
        })}
      </div>

      <div className="milestone-progress-field">
        <label htmlFor="milestone-percent">Completion</label>
        <div className="milestone-progress-inputs">
          <input type="range" min="0" max="100" step="1" value={percentValue} onChange={(event) => setCompletionPercent(event.target.value)} aria-label="Completion slider" />
          <span className="milestone-percent-box"><input id="milestone-percent" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={completionPercent} onChange={(event) => { const next = event.target.value; if (/^d{0,3}(.d{0,2})?$/.test(next)) setCompletionPercent(next) }} onBlur={() => setCompletionPercent(String(percentValue))} placeholder="0.00" required />%</span>
        </div>
        <small className="milestone-percent-hint">Type an exact value with up to 2 decimals, e.g. 42.75</small>
        <div className="milestone-status-line">
          <span className={`milestone-status-pill is-${status}`}>{statusLabel}</span>
          <label className="milestone-blocked-toggle"><input type="checkbox" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} />Mark as blocked</label>
        </div>
      </div>

      {isComplete && <label className="form-field">Completed on<input type="date" value={actualDate || plannedDate || todayLocal()} onChange={(event) => setActualDate(event.target.value)} /></label>}

      {isComplete && <div className="milestone-photo-control">
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="Attach a completion photo" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          if (milestone) void uploadPhoto(file)
          else setNewPhoto(file)
        }} />
        {photoUrl && <a className="milestone-photo-link" href={photoUrl} target="_blank" rel="noreferrer" title="Open full size"><img className="milestone-photo-preview" src={photoUrl} alt={`${milestone?.name ?? 'Milestone'} completion`} /></a>}
        <div className="milestone-photo-actions">
          <button className="button button-secondary" type="button" disabled={isPhotoWorking || (Boolean(milestone) && milestone?.status !== 'complete')} onClick={() => photoInput.current?.click()} aria-busy={isPhotoWorking}>
            {milestone?.photoStoragePath || newPhoto ? <Camera size={14} /> : <Upload size={14} />}
            {isPhotoWorking ? 'Saving photo…' : milestone?.photoStoragePath || newPhoto ? 'Change photo' : 'Attach photo'}
          </button>
          {milestone?.photoStoragePath && <button className="button button-secondary" type="button" disabled={isPhotoWorking} onClick={() => { void removePhoto() }}><Trash2 size={14} />Remove photo</button>}
          {newPhoto && <span className="milestone-photo-name">{newPhoto.name}</span>}
        </div>
        <small className="milestone-photo-note">{milestone && milestone.status !== 'complete' ? 'Save this milestone as complete first, then attach a photo.' : 'JPG, PNG, or WebP · 10 MB max. Shared with the client automatically.'}</small>
        {photoError && <p className="form-error" role="alert">{photoError}</p>}
      </div>}

      <label className="milestone-client-visible"><input type="checkbox" checked={clientVisible} onChange={(event) => setClientVisible(event.target.checked)} /><span>{clientVisible ? <Eye size={14} /> : <EyeOff size={14} />}Show in client portal</span></label>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="milestone-drawer-actions">
        {!isNew && <button className="button button-secondary milestone-delete-button" type="button" onClick={() => { void remove() }} disabled={isSaving}><Trash2 size={14} />Delete</button>}
        <span />
        {isNew && <button className="button button-secondary" type="button" disabled={isSaving} onClick={(event) => { if (event.currentTarget.form?.reportValidity()) void save(true) }}>Save & add another</button>}
        <button className="button button-primary" type="submit" disabled={isSaving} aria-busy={isSaving}><Save size={14} />{isSaving ? 'Saving…' : isNew ? 'Add milestone' : 'Save changes'}</button>
      </div>
    </form>
  </div>, document.body)
}

export function ProjectMilestonePanel({ projectId, milestones, onChanged }: {
  projectId: string
  milestones: ProjectMilestone[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<ProjectMilestone | 'new' | null>(null)
  const latestEnd = milestones.reduce((latest, milestone) => milestone.plannedDate && milestone.plannedDate > latest ? milestone.plannedDate : latest, '')
  const defaultStartDate = latestEnd ? addDays(latestEnd, 1) : todayLocal()
  const ordered = [...milestones].sort((left, right) => (left.startDate ?? left.plannedDate ?? '9999').localeCompare(right.startDate ?? right.plannedDate ?? '9999'))

  return <section className="surface-card tab-content project-milestone-panel">
    <div className="card-heading-row milestone-panel-heading">
      <div><div className="section-kicker">Project schedule</div><h2>Milestones</h2><p className="project-milestone-help">Start and end dates place a milestone on the timeline. The end date is the client portal target.</p></div>
      <button type="button" className="button button-primary" onClick={() => setEditing('new')}><Plus size={15} />Add milestone</button>
    </div>
    <MilestoneGantt milestones={milestones} />
    {ordered.length ? <div className="milestone-list" role="list">{ordered.map((milestone) => {
      const percent = Math.round(milestone.completionPercent)
      const label = statusOptions.find((option) => option.value === milestone.status)?.label ?? ''
      return <button type="button" role="listitem" key={milestone.id} className={`milestone-list-row${milestone.photoStoragePath ? ' has-photo' : ''}`} onClick={() => setEditing(milestone)} aria-label={`Edit ${milestone.name}`}>
        {milestone.photoStoragePath && <MilestoneThumb path={milestone.photoStoragePath} name={milestone.name} />}
        <span className="milestone-list-name"><strong>{milestone.name}</strong><small>{milestone.startDate || milestone.plannedDate ? `${formatShort(milestone.startDate)}${milestone.startDate && milestone.plannedDate ? ' – ' : ''}${formatShort(milestone.plannedDate)}` : 'No dates yet'}</small></span>
        <span className={`milestone-status-pill is-${milestone.status}`}>{milestone.status === 'complete' || milestone.status === 'pending' ? label : `${label} · ${percent}%`}</span>
        <span className="milestone-list-icons">
          {milestone.clientVisible ? <Eye size={15} aria-label="Visible to client" /> : <EyeOff size={15} aria-label="Hidden from client" className="is-muted" />}
        </span>
        <ChevronRight size={16} className="milestone-list-open" aria-hidden="true" />
      </button>
    })}</div> : <div className="pr-empty">
      <EmptyArt kind="blueprint" />
      <strong>No milestones yet</strong>
      <p>Add the first milestone to start the project timeline.</p>
      <button type="button" className="button button-primary" onClick={() => setEditing('new')}><Plus size={15} />Add milestone</button>
    </div>}
    {editing && <MilestoneEditor
      key={editing === 'new' ? 'new' : editing.id}
      projectId={projectId}
      milestone={editing === 'new' ? null : editing}
      defaultStartDate={defaultStartDate}
      onClose={() => setEditing(null)}
      onChanged={onChanged}
    />}
  </section>
}

type GanttState = 'complete' | 'active' | 'upcoming' | 'overdue' | 'blocked'

const ganttStates: { key: GanttState; label: string }[] = [
  { key: 'complete', label: 'Done' },
  { key: 'active', label: 'In progress' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'blocked', label: 'Blocked' },
]

function MilestoneGantt({ milestones }: { milestones: ProjectMilestone[] }) {
  const [filter, setFilter] = useState<GanttState | 'all'>('all')
  const [showCompleted, setShowCompleted] = useState(false)
  const scheduledMilestones = milestones.filter((milestone) => milestone.startDate && milestone.plannedDate)
  if (!scheduledMilestones.length) {
    return <section className="milestone-gantt" aria-label="Project milestone Gantt chart">
      <div className="milestone-gantt-heading"><h3>Project timeline</h3></div>
      <div className="milestone-gantt-empty">
        {milestones.length
          ? 'Add a start and end date to at least one milestone to display it on the Gantt chart.'
          : 'Add a milestone with start and end dates to display it on the Gantt chart.'}
      </div>
    </section>
  }

  const dates = scheduledMilestones.flatMap((milestone) => [milestone.startDate!, milestone.plannedDate!]).sort()
  const firstDate = new Date(`${dates[0]}T00:00:00`)
  const lastDate = new Date(`${dates[dates.length - 1]}T00:00:00`)
  const totalDays = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / 86_400_000) + 1)
  const shortDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
  const dateLabel = (offset: number) => {
    const date = new Date(firstDate)
    date.setDate(date.getDate() + offset)
    return shortDate.format(date)
  }
  const daysFrom = (date: Date) => Math.round((date.getTime() - firstDate.getTime()) / 86_400_000)
  const dayOffset = (value: string) => daysFrom(new Date(`${value}T00:00:00`))
  const percentOf = (offset: number) => `${Math.min(100, Math.max(0, offset / totalDays * 100))}%`
  const todayKey = new Date().toLocaleDateString('en-CA')
  const todayOffset = dayOffset(todayKey)
  const showToday = todayOffset >= 0 && todayOffset < totalDays

  const months: { key: string; start: number; end: number; label: string }[] = []
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1)
  while (cursor <= lastDate) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const start = Math.max(0, daysFrom(cursor))
    const end = Math.min(totalDays, daysFrom(next))
    months.push({ key: `${cursor.getFullYear()}-${cursor.getMonth()}`, start, end, label: new Intl.DateTimeFormat('en-PH', { month: 'short' }).format(cursor) })
    cursor.setTime(next.getTime())
  }

  const stateOf = (milestone: ProjectMilestone): GanttState => {
    if (milestone.status === 'blocked') return 'blocked'
    if (milestone.completionPercent >= 100 || milestone.status === 'complete') return 'complete'
    if (milestone.plannedDate! < todayKey) return 'overdue'
    if (milestone.completionPercent > 0 || milestone.startDate! <= todayKey) return 'active'
    return 'upcoming'
  }
  const rows = scheduledMilestones
    .map((milestone) => ({ milestone, state: stateOf(milestone) }))
    .sort((left, right) => left.milestone.startDate!.localeCompare(right.milestone.startDate!) || left.milestone.plannedDate!.localeCompare(right.milestone.plannedDate!))
  const counts = Object.fromEntries(ganttStates.map((item) => [item.key, rows.filter((row) => row.state === item.key).length])) as Record<GanttState, number>
  const completedRows = rows.filter((row) => row.state === 'complete')
  const openRows = rows.filter((row) => row.state !== 'complete')
  const visibleRows = filter === 'all' ? openRows : rows.filter((row) => row.state === filter)
  const collapseCompleted = filter === 'all' && completedRows.length > 0
  const completedStart = completedRows.length ? completedRows.reduce((min, row) => row.milestone.startDate! < min ? row.milestone.startDate! : min, completedRows[0].milestone.startDate!) : ''
  const completedEnd = completedRows.length ? completedRows.reduce((max, row) => row.milestone.plannedDate! > max ? row.milestone.plannedDate! : max, completedRows[0].milestone.plannedDate!) : ''

  const backdrop = <>
    {months.map((month, index) => index % 2 === 1 && <i key={month.key} className="gantt-month-band" style={{ left: percentOf(month.start), width: percentOf(month.end - month.start) }} />)}
    {showToday && <i className="gantt-today-line" style={{ left: percentOf(todayOffset + 0.5) }} />}
  </>

  const renderRow = ({ milestone, state }: { milestone: ProjectMilestone; state: GanttState }) => {
    const startOffset = dayOffset(milestone.startDate!)
    const duration = Math.max(1, dayOffset(milestone.plannedDate!) - startOffset + 1)
    const range = `${dateLabel(startOffset)} – ${dateLabel(startOffset + duration - 1)}`
    const percent = Math.round(milestone.completionPercent)
    const lateStart = state === 'active' && percent === 0
    return <div className={`milestone-gantt-row is-${state}${lateStart ? ' is-late-start' : ''}`} key={milestone.id} title={`${milestone.name} · ${range} · ${percent}% complete`}>
      <span className="milestone-gantt-name">{milestone.name}</span>
      <div className="milestone-gantt-track" aria-label={`${milestone.name}: ${range}, ${percent}% complete`}>
        {backdrop}
        <span className="milestone-gantt-bar" style={{ left: percentOf(startOffset), width: percentOf(duration) }}>
          <span className="milestone-gantt-progress" style={{ width: `${Math.min(100, milestone.completionPercent)}%` }} />
        </span>
      </div>
      <span className="milestone-gantt-dates">{(state === 'active' || state === 'overdue' || state === 'blocked') && <b>{percent}%</b>}{dateLabel(startOffset + duration - 1)}</span>
    </div>
  }

  return <section className="milestone-gantt" aria-label="Project milestone Gantt chart">
    <div className="milestone-gantt-heading"><h3>Project timeline</h3><span>{dateLabel(0)} – {dateLabel(totalDays - 1)}</span></div>
    <div className="milestone-gantt-summary" role="group" aria-label="Filter milestones by status">
      {ganttStates.filter((item) => item.key !== 'blocked' || counts.blocked > 0).map((item) => <button
        type="button"
        key={item.key}
        className={`gantt-chip is-${item.key}${filter === item.key ? ' is-selected' : ''}`}
        aria-pressed={filter === item.key}
        onClick={() => setFilter(filter === item.key ? 'all' : item.key)}
      ><i /><strong>{counts[item.key]}</strong>{item.label}</button>)}
    </div>
    <div className="milestone-gantt-scale" aria-hidden="true">
      <span />
      <div className="milestone-gantt-axis">
        {months.map((month) => <span key={month.key} style={{ left: percentOf((month.start + month.end) / 2) }}>{month.end - month.start >= 10 ? month.label : ''}</span>)}
        {showToday && <b style={{ left: percentOf(todayOffset + 0.5) }}>Today</b>}
      </div>
      <span />
    </div>
    <div className="milestone-gantt-rows">
      {collapseCompleted && <button type="button" className="milestone-gantt-row is-complete gantt-completed-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted((open) => !open)}>
        <span className="milestone-gantt-name"><span className="gantt-toggle-caret" aria-hidden="true">{showCompleted ? '▾' : '▸'}</span>{completedRows.length} completed</span>
        <div className="milestone-gantt-track">
          {backdrop}
          <span className="milestone-gantt-bar" style={{ left: percentOf(dayOffset(completedStart)), width: percentOf(dayOffset(completedEnd) - dayOffset(completedStart) + 1) }}><span className="milestone-gantt-progress" style={{ width: '100%' }} /></span>
        </div>
        <span className="milestone-gantt-dates">{showCompleted ? 'Hide' : 'Show'}</span>
      </button>}
      {collapseCompleted && showCompleted && <div className="gantt-completed-group">{completedRows.map(renderRow)}</div>}
      {visibleRows.map(renderRow)}
      {!visibleRows.length && !collapseCompleted && <p className="milestone-gantt-none">No milestones in this status.</p>}
    </div>
    <div className="milestone-gantt-legend">
      <span><i className="is-today" />Today</span>
      <span><i className="is-late-start" />Should have started</span>
      <span className="milestone-gantt-legend-note">Hover a bar for full dates</span>
    </div>
  </section>
}
