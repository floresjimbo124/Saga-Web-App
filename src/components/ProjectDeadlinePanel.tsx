import { useState, type FormEvent } from 'react'
import { CalendarDays, Save } from 'lucide-react'
import type { ProjectStatus } from '../data/portfolio'
import { updateProjectDeadline } from '../data/portfolio'
import { getProjectDeadlineStatus } from '../finance/project-deadline'

export function ProjectDeadlinePanel({ projectId, deadline, status, onChanged }: {
  projectId: string
  deadline: string | null
  status: ProjectStatus
  onChanged: () => void
}) {
  const [date, setDate] = useState(deadline ?? '')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const deadlineStatus = getProjectDeadlineStatus(date || null, status)

  const saveDeadline = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSaving(true)
    try {
      await updateProjectDeadline(projectId, date || null)
      setMessage(date ? 'Project deadline saved.' : 'Project deadline cleared.')
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the project deadline.')
    } finally {
      setIsSaving(false)
    }
  }

  return <section className="surface-card project-deadline-panel">
    <div className="card-heading-row"><div><div className="section-kicker">Schedule</div><h2>Project deadline</h2></div><span className={`status-badge deadline-${deadlineStatus.level}`} title={deadlineStatus.detail}><span />{deadlineStatus.label}</span></div>
    <form className="project-deadline-form" onSubmit={(event) => { void saveDeadline(event) }}>
      <label className="form-field">Target completion date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={isSaving || status === 'completed' || status === 'closed'} /></label>
      <button className="button button-primary" type="submit" disabled={isSaving || status === 'completed' || status === 'closed'}><Save size={15} />{isSaving ? 'Saving…' : 'Save deadline'}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="document-success" role="status">{message}</p>}
    <p className="project-deadline-detail"><CalendarDays size={14} />{deadlineStatus.detail}</p>
  </section>
}