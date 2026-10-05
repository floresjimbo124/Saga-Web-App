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

function milestoneInput(projectId: string, name: string, plannedDate: string, actualDate: string, status: ProjectMilestoneStatus, clientVisible: boolean): SaveProjectMilestoneInput {
  return {
    projectId,
    name,
    plannedDate: plannedDate || null,
    actualDate: status === 'complete' ? actualDate || todayLocal() : null,
    status,
    clientVisible,
  }
}

function ProjectMilestoneRow({ projectId, milestone, onChanged }: {
  projectId: string
  milestone: ProjectMilestone
  onChanged: () => void
}) {
  const [name, setName] = useState(milestone.name)
  const [plannedDate, setPlannedDate] = useState(milestone.plannedDate ?? '')
  const [actualDate, setActualDate] = useState(milestone.actualDate ?? '')
  const [status, setStatus] = useState(milestone.status)
  const [clientVisible, setClientVisible] = useState(milestone.clientVisible)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      await updateProjectMilestone(milestone.id, milestoneInput(projectId, name, plannedDate, actualDate, status, clientVisible))
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
      onChanged()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this milestone.')
    } finally {
      setIsSaving(false)
    }
  }

  return <form className="milestone-manage-row" onSubmit={(event) => { void save(event) }}>
    <label className="form-field">Milestone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <label className="form-field">Target date<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
    <label className="form-field">Status<select value={status} onChange={(event) => setStatus(event.target.value as ProjectMilestoneStatus)}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
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
  const [name, setName] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
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
        plannedDate: plannedDate || null,
        actualDate: null,
        status: 'pending',
        clientVisible,
      })
      setName('')
      setPlannedDate('')
      setClientVisible(true)
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add this milestone.')
    } finally {
      setIsSaving(false)
    }
  }

  return <section className="surface-card tab-content project-milestone-panel">
    <div className="card-heading-row"><div><div className="section-kicker">Project schedule</div><h2>Manage milestones</h2></div><span className="project-milestone-count">{milestones.length} milestone{milestones.length === 1 ? '' : 's'}</span></div>
    <p className="project-milestone-help">Milestones are ordered by target date. Choose whether each one is visible in the client portal.</p>
    {milestones.length ? <div className="milestone-manage-list">{milestones.map((milestone) => (
      <ProjectMilestoneRow key={milestone.id} projectId={projectId} milestone={milestone} onChanged={onChanged} />
    ))}</div> : <p className="client-empty-note">No milestones yet. Add the first one below.</p>}
    <form className="milestone-create-form" onSubmit={(event) => { void addMilestone(event) }}>
      <h3><Plus size={15} />Add a milestone</h3>
      <label className="form-field">Milestone name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Foundation complete" maxLength={120} required /></label>
      <label className="form-field">Target date<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
      <label className="milestone-client-visible"><input type="checkbox" checked={clientVisible} onChange={(event) => setClientVisible(event.target.checked)} /><span><Eye size={14} />Show in client portal</span></label>
      {error && <p className="form-error milestone-manage-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={isSaving}><Plus size={14} />{isSaving ? 'Adding…' : 'Add milestone'}</button>
    </form>
  </section>
}
