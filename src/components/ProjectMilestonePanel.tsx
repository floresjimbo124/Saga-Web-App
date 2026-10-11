import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-react'
import {
  createProjectMilestone,
  deleteProjectMilestone,
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

function milestoneInput(projectId: string, name: string, startDate: string, plannedDate: string, actualDate: string, completionPercent: number, status: ProjectMilestoneStatus, clientVisible: boolean): SaveProjectMilestoneInput {
  return {
    projectId,
    name,
    startDate: startDate || null,
    plannedDate: plannedDate || null,
    actualDate: status === 'complete' ? actualDate || todayLocal() : null,
    completionPercent: status === 'complete' ? 100 : completionPercent,
    status,
    clientVisible,
  }
}

function ProjectMilestoneRow({ projectId, milestone, onChanged }: {
  projectId: string
  milestone: ProjectMilestone
  onChanged: () => void
}) {
  const { showToast } = useToast()
  const [name, setName] = useState(milestone.name)
  const [startDate, setStartDate] = useState(milestone.startDate ?? '')
  const [plannedDate, setPlannedDate] = useState(milestone.plannedDate ?? '')
  const [actualDate, setActualDate] = useState(milestone.actualDate ?? '')
  const [completionPercent, setCompletionPercent] = useState(String(milestone.completionPercent))
  const [status, setStatus] = useState(milestone.status)
  const [clientVisible, setClientVisible] = useState(milestone.clientVisible)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      await updateProjectMilestone(milestone.id, milestoneInput(projectId, name, startDate, plannedDate, actualDate, Number(completionPercent), status, clientVisible))
      showToast('Milestone updated.', 'update')
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this milestone.')
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete the "${milestone.name}" milestone?`)) return
    setError('')
    setIsSaving(true)
    try {
      await deleteProjectMilestone(projectId, milestone.id)
      showToast('Milestone deleted.', 'delete')
      onChanged()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this milestone.')
    } finally {
      setIsSaving(false)
    }
  }

  return <form className="milestone-manage-row" onSubmit={(event) => { void save(event) }}>
    <label className="form-field">Milestone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <label className="form-field">Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
    <label className="form-field">End date / target<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
    <label className="form-field">Completion %<input type="number" min="0" max="100" step="1" value={completionPercent} onChange={(event) => setCompletionPercent(event.target.value)} required /></label>
    <label className="form-field">Status<select value={status} onChange={(event) => {
      const nextStatus = event.target.value as ProjectMilestoneStatus
      setStatus(nextStatus)
      if (nextStatus === 'complete') setCompletionPercent('100')
    }}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    {status === 'complete' && <label className="form-field">Completed on<input type="date" value={actualDate} onChange={(event) => setActualDate(event.target.value)} /></label>}
    <label className="milestone-client-visible"><input type="checkbox" checked={clientVisible} onChange={(event) => setClientVisible(event.target.checked)} /><span>{clientVisible ? <Eye size={14} /> : <EyeOff size={14} />}Show in client portal</span></label>
    {error && <p className="form-error milestone-manage-error" role="alert">{error}</p>}
    <div className="milestone-manage-actions">
      <button className="button button-primary" type="submit" disabled={isSaving}><Save size={14} />{isSaving ? 'Saving…' : 'Save changes'}</button>
      <button className="button button-secondary milestone-delete-button" type="button" onClick={() => { void remove() }} disabled={isSaving}><Trash2 size={14} />Delete</button>
    </div>
  </form>
}

export function ProjectMilestonePanel({ projectId, milestones, onChanged }: {
  projectId: string
  milestones: ProjectMilestone[]
  onChanged: () => void
}) {
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [completionPercent, setCompletionPercent] = useState('0')
  const [clientVisible, setClientVisible] = useState(true)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const addMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      await createProjectMilestone({
        projectId,
        name,
        startDate: startDate || null,
        plannedDate: plannedDate || null,
        actualDate: null,
        completionPercent: Number(completionPercent),
        status: 'pending',
        clientVisible,
      })
      setName('')
      setStartDate('')
      setPlannedDate('')
      setCompletionPercent('0')
      setClientVisible(true)
      showToast('Milestone created.')
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add this milestone.')
    } finally {
      setIsSaving(false)
    }
  }

  return <section className="surface-card tab-content project-milestone-panel">
    <div className="card-heading-row"><div><div className="section-kicker">Project schedule</div><h2>Manage milestones</h2></div><span className="project-milestone-count">{milestones.length} milestone{milestones.length === 1 ? '' : 's'}</span></div>
    <p className="project-milestone-help">Add a start and end date to show a milestone on the Gantt chart. The end date also remains the client portal target date.</p>
    <MilestoneGantt milestones={milestones} />
    {milestones.length ? <div className="milestone-manage-list">{milestones.map((milestone) => (
      <ProjectMilestoneRow key={milestone.id} projectId={projectId} milestone={milestone} onChanged={onChanged} />
    ))}</div> : <p className="client-empty-note">No milestones yet. Add the first one below.</p>}
    <form className="milestone-create-form" onSubmit={(event) => { void addMilestone(event) }}>
      <h3><Plus size={15} />Add a milestone</h3>
      <label className="form-field">Milestone name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Foundation complete" maxLength={120} required /></label>
      <label className="form-field">Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label className="form-field">End date / target<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
      <label className="form-field">Completion %<input type="number" min="0" max="100" step="1" value={completionPercent} onChange={(event) => setCompletionPercent(event.target.value)} required /></label>
      <label className="milestone-client-visible"><input type="checkbox" checked={clientVisible} onChange={(event) => setClientVisible(event.target.checked)} /><span><Eye size={14} />Show in client portal</span></label>
      {error && <p className="form-error milestone-manage-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={isSaving}><Plus size={14} />{isSaving ? 'Adding…' : 'Add milestone'}</button>
    </form>
  </section>
}

function MilestoneGantt({ milestones }: { milestones: ProjectMilestone[] }) {
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
  const dateLabel = (offset: number) => {
    const date = new Date(firstDate)
    date.setDate(date.getDate() + offset)
    return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(date)
  }

  return <section className="milestone-gantt" aria-label="Project milestone Gantt chart">
    <div className="milestone-gantt-heading"><h3>Project timeline</h3><span>{dateLabel(0)} – {dateLabel(totalDays - 1)}</span></div>
    <div className="milestone-gantt-rows">{scheduledMilestones.map((milestone) => {
      const startOffset = Math.round((new Date(`${milestone.startDate}T00:00:00`).getTime() - firstDate.getTime()) / 86_400_000)
      const duration = Math.max(1, Math.round((new Date(`${milestone.plannedDate}T00:00:00`).getTime() - new Date(`${milestone.startDate}T00:00:00`).getTime()) / 86_400_000) + 1)
      return <div className="milestone-gantt-row" key={milestone.id}>
        <span className="milestone-gantt-name" title={milestone.name}>{milestone.name}</span>
        <div className="milestone-gantt-track" aria-label={`${milestone.name}: ${milestone.startDate} to ${milestone.plannedDate}`}>
          <span className={`milestone-gantt-bar status-${milestone.status}`} style={{ left: `${startOffset / totalDays * 100}%`, width: `${duration / totalDays * 100}%` }} title={`${milestone.completionPercent}% complete`}>
            <span className="milestone-gantt-progress" style={{ width: `${milestone.completionPercent}%` }} />
          </span>
        </div>
        <span className="milestone-gantt-dates">{milestone.completionPercent}% · {dateLabel(startOffset)} – {dateLabel(startOffset + duration - 1)}</span>
      </div>
    })}</div>
    <div className="milestone-gantt-legend">{statusOptions.map((option) => <span key={option.value}><i className={`status-${option.value}`} />{option.label}</span>)}</div>
  </section>
}
