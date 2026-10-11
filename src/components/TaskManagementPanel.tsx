import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, List, Mail, Pencil,
  Plus, RefreshCw, Trash2, UserRoundPlus, Users, X,
} from 'lucide-react'
import {
  deleteProjectTask, loadProjectTasks, saveProjectTask, updateProjectTaskStatus,
  type ProjectTask, type StaffTitle, type TaskAssignee, type TaskInput,
  type TaskPriority, type TaskStatus,
} from '../data/tasks'
import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'
import { inviteStaffMember, loadStaffMembers, resendStaffInvitation, revokeStaffAccess, type StaffAccount } from '../data/staff-invitations'
import { useToast } from './toast-context'

type ProjectOption = { id: string; name: string }
type StatusFilter = 'all' | TaskStatus

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
]
const priorityLabels: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }
const titleLabels: Record<StaffTitle, string> = {
  liaison_officer: 'Liaison officer',
  engineer: 'Engineer',
  architect: 'Architect',
}

function localDateText(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en-PH', options).format(new Date(`${date}T12:00:00`))
}

function isOverdue(task: ProjectTask, today: string) {
  return task.status !== 'done' && task.dueDate < today
}

export function TaskManagementPanel({ isOwner, currentUserId, projects = [] }: {
  isOwner: boolean
  currentUserId: string
  projects?: ProjectOption[]
}) {
  const { showToast } = useToast()
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [realtimeError, setRealtimeError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [layout, setLayout] = useState<'list' | 'calendar'>('list')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [today] = useState(() => localDateText(new Date()))
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showTeamDialog, setShowTeamDialog] = useState(false)
  const [workingTaskId, setWorkingTaskId] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([
      loadProjectTasks(),
      isOwner ? loadStaffMembers() : Promise.resolve([]),
    ]).then(([nextTasks, nextStaff]) => {
      if (!active) return
      setTasks(nextTasks)
      setStaff(nextStaff)
      setError('')
    }).catch((loadError: unknown) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load tasks.')
    }).finally(() => {
      if (active) setIsLoading(false)
    })
    return () => { active = false }
  }, [isOwner, reloadKey])

  useEffect(() => {
    if (!supabase) return

    const client = supabase
    let active = true
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const channel = client
      .channel(`project-tasks:${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'project_tasks',
        filter: `organization_id=eq.${SAGACT_ORGANIZATION_ID}`,
      }, () => {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          if (active) setReloadKey((current) => current + 1)
        }, 100)
      })
      .subscribe((status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          setRealtimeError('')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeError('Live task updates are unavailable. Use Refresh to check for changes.')
        }
      })

    return () => {
      active = false
      if (refreshTimer) clearTimeout(refreshTimer)
      void client.removeChannel(channel)
    }
  }, [currentUserId])

  const activeStaff = staff
  const staffById = useMemo(() => new Map(activeStaff.map((member) => [member.userId, member])), [activeStaff])
  const visibleTasks = tasks.filter((task) => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false
    if (isOwner && assigneeFilter !== 'all' && task.assignedTo !== assigneeFilter) return false
    return true
  })
  const monthLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(month)
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const calendarCells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]

  const refresh = () => {
    setIsLoading(true)
    setReloadKey((current) => current + 1)
  }

  const saveTask = async (input: TaskInput, taskId?: string) => {
    await saveProjectTask(input, taskId)
    showToast(taskId ? 'Task updated.' : 'Task created.')
    setShowTaskForm(false)
    setEditingTask(null)
    refresh()
  }

  const changeStatus = async (task: ProjectTask, status: TaskStatus) => {
    setWorkingTaskId(task.id)
    setError('')
    try {
      await updateProjectTaskStatus(task.id, status)
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status } : item))
      showToast('Task status updated.')
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update task status.')
    } finally {
      setWorkingTaskId('')
    }
  }

  const removeTask = async (task: ProjectTask) => {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return
    setWorkingTaskId(task.id)
    setError('')
    try {
      await deleteProjectTask(task.id)
      setTasks((current) => current.filter((item) => item.id !== task.id))
      showToast('Task deleted.', 'delete')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the task.')
    } finally {
      setWorkingTaskId('')
    }
  }

  const taskCountText = `${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'}`

  return <div className="task-workspace">
    {(showTaskForm || editingTask) && <TaskEditorDialog
      task={editingTask}
      projects={projects}
      staff={activeStaff}
      today={today}
      onClose={() => { setShowTaskForm(false); setEditingTask(null) }}
      onSave={saveTask}
    />}
    {showTeamDialog && <TeamDialog
      staff={staff}
      onClose={() => setShowTeamDialog(false)}
      onChanged={refresh}
    />}
    <section className="page-heading task-page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" />Team workspace</div>
        <h1>{isOwner ? 'Tasks & calendar' : 'My tasks'}</h1>
        <p>{isOwner ? 'Assign work to your team and keep project deadlines visible.' : 'Your assigned project work and upcoming deadlines.'}</p>
      </div>
      {isOwner && <div className="heading-actions task-heading-actions">
        <button type="button" className="button button-secondary" onClick={() => setShowTeamDialog(true)}><Users size={15} />Manage team</button>
        <button type="button" className="button button-primary" onClick={() => setShowTaskForm(true)} disabled={!projects.length || !activeStaff.length}><Plus size={15} />Add task</button>
      </div>}
    </section>

    {error && <div className="task-error" role="alert">{error}</div>}
    {realtimeError && <div className="task-error" role="status">{realtimeError}</div>}
    {isOwner && (!projects.length || !activeStaff.length) && <section className="task-setup-notice">
      <Users size={18} />
      <div><strong>{!activeStaff.length ? 'Invite your team to get started' : 'Add a project before creating tasks'}</strong>
        <p>{!activeStaff.length ? 'Invite the liaison officer, engineer, and architect. You can assign tasks once their accounts are set up.' : 'Tasks need to be linked to a project.'}</p>
      </div>
      {!activeStaff.length && <button type="button" className="button button-secondary" onClick={() => setShowTeamDialog(true)}><UserRoundPlus size={15} />Invite staff</button>}
    </section>}

    <section className="task-toolbar surface-card" aria-label="Task filters">
      <div className="task-toolbar-filters">
        <label className="task-filter-field">Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </label>
        {isOwner && <label className="task-filter-field">Assignee
          <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
            <option value="all">Everyone</option>
            {activeStaff.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
          </select>
        </label>}
      </div>
      <div className="task-view-switch" role="group" aria-label="Task view">
        <button type="button" className={layout === 'list' ? 'is-active' : ''} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={15} />List</button>
        <button type="button" className={layout === 'calendar' ? 'is-active' : ''} aria-pressed={layout === 'calendar'} onClick={() => setLayout('calendar')}><CalendarDays size={15} />Calendar</button>
      </div>
      <button type="button" className="button button-secondary task-refresh-button" onClick={refresh} disabled={isLoading} aria-label="Refresh tasks">
        <RefreshCw size={14} className={isLoading ? 'is-spinning' : ''} />Refresh
      </button>
    </section>

    {isLoading ? <div className="task-loading" role="status"><RefreshCw size={16} />Loading tasks…</div>
      : layout === 'list' ? <section className="task-list" aria-label="Tasks">
        <div className="task-list-heading"><h2>{isOwner ? 'Project tasks' : 'Assigned to me'}</h2><span>{taskCountText}</span></div>
        {visibleTasks.length ? visibleTasks.map((task) => <TaskCard
          key={task.id}
          task={task}
          assignee={task.assignedTo ? staffById.get(task.assignedTo) : undefined}
          today={today}
          isOwner={isOwner}
          currentUserId={currentUserId}
          isWorking={workingTaskId === task.id}
          onStatusChange={(status) => { void changeStatus(task, status) }}
          onEdit={() => { setEditingTask(task); setShowTaskForm(true) }}
          onDelete={() => { void removeTask(task) }}
        />) : <div className="empty-state task-empty">{tasks.length ? 'No tasks match these filters.' : isOwner ? 'No tasks yet. Add a task and assign it to a team member.' : 'No tasks have been assigned to you yet.'}</div>}
      </section> : <section className="task-calendar-panel surface-card" aria-label="Task calendar">
        <div className="task-calendar-heading">
          <div><div className="section-kicker">Deadline calendar</div><h2>{monthLabel}</h2></div>
          <div className="task-calendar-controls">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
            <button type="button" className="text-button compact-button" onClick={() => setMonth(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1))}>Today</button>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
          </div>
        </div>
        <div className="task-calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div className="task-calendar-weekday" key={day}>{day}</div>)}
          {calendarCells.map((day, index) => {
            if (day === null) return <div className="task-calendar-day task-calendar-blank" key={`blank-${index}`} aria-hidden="true" />
            const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayTasks = visibleTasks.filter((task) => task.dueDate === date)
            const isToday = date === today
            return <div className={`task-calendar-day ${isToday ? 'is-today' : ''}`} key={date}>
              <span className="task-calendar-date">{day}</span>
              <div className="task-calendar-items">{dayTasks.slice(0, 3).map((task) => isOwner ? <button
                type="button"
                key={task.id}
                className={`task-calendar-item task-status-${task.status} ${isOverdue(task, today) ? 'is-overdue' : ''}`}
                title={`${task.title} · ${task.projectName}`}
                onClick={() => { setEditingTask(task); setShowTaskForm(true) }}
              >{task.title}</button> : <span
                key={task.id}
                className={`task-calendar-item task-status-${task.status} ${isOverdue(task, today) ? 'is-overdue' : ''}`}
                title={`${task.title} · ${task.projectName}`}
              >{task.title}</span>)}
                {dayTasks.length > 3 && <span className="task-calendar-more">+{dayTasks.length - 3} more</span>}
              </div>
            </div>
          })}
        </div>
        <div className="task-calendar-legend"><span><i className="task-legend-dot task-legend-open" />Open</span><span><i className="task-legend-dot task-legend-complete" />Complete</span><span><i className="task-legend-dot task-legend-overdue" />Overdue</span></div>
        {!visibleTasks.some((task) => task.dueDate.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`)) && <p className="task-calendar-empty">No deadlines this month.</p>}
      </section>}
  </div>
}

function TaskCard({ task, assignee, today, isOwner, currentUserId, isWorking, onStatusChange, onEdit, onDelete }: {
  task: ProjectTask
  assignee?: TaskAssignee
  today: string
  isOwner: boolean
  currentUserId: string
  isWorking: boolean
  onStatusChange: (status: TaskStatus) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const overdue = isOverdue(task, today)
  const canUpdateStatus = isOwner || task.assignedTo === currentUserId
  return <article className={`task-card ${overdue ? 'is-overdue' : ''}`}>
    <div className="task-card-main">
      <div className="task-card-topline"><span className={`task-priority task-priority-${task.priority}`}>{priorityLabels[task.priority]} priority</span>{overdue && <span className="task-overdue-label">Overdue</span>}</div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-card-description">{task.description}</p>}
      <div className="task-card-meta"><span><CalendarDays size={14} />{formatDate(task.dueDate)}</span><span><span className="task-meta-project">{task.projectName}</span></span>{assignee && <span><Users size={14} />{assignee.name}</span>}</div>
    </div>
    <div className="task-card-actions">
      {canUpdateStatus && <label className={`task-status-control task-status-${task.status}`}><span className="sr-only">Status for {task.title}</span><select value={task.status} disabled={isWorking} onChange={(event) => onStatusChange(event.target.value as TaskStatus)}>{statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>}
      {isOwner && <><button type="button" className="icon-button task-action" aria-label={`Edit ${task.title}`} title="Edit task" onClick={onEdit} disabled={isWorking}><Pencil size={15} /></button><button type="button" className="icon-button task-action task-delete-action" aria-label={`Delete ${task.title}`} title="Delete task" onClick={onDelete} disabled={isWorking}><Trash2 size={15} /></button></>}
    </div>
  </article>
}

function TaskEditorDialog({ task, projects, staff, today, onClose, onSave }: {
  task: ProjectTask | null
  projects: ProjectOption[]
  staff: TaskAssignee[]
  today: string
  onClose: () => void
  onSave: (input: TaskInput, taskId?: string) => Promise<void>
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [projectId, setProjectId] = useState(task?.projectId ?? projects[0]?.id ?? '')
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? staff[0]?.userId ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? today)
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      await onSave({ projectId, assignedTo, title, description, dueDate, priority }, task?.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this task.')
    } finally {
      setIsSaving(false)
    }
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose() }}>
    <section className="project-modal task-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
      <div className="modal-heading"><div><div className="section-kicker">{task ? 'Update assignment' : 'New assignment'}</div><h2 id="task-editor-title">{task ? 'Edit task' : 'Create a task'}</h2></div><button type="button" className="icon-button" aria-label="Close" disabled={isSaving} onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={(event) => { void submit(event) }}>
        <label className="form-field">Task title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} minLength={2} placeholder="e.g. Prepare permit drawings" required /></label>
        <label className="form-field">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} placeholder="Add useful context or completion details" /></label>
        <div className="form-row">
          <label className="form-field">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="form-field">Assign to<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} required>{staff.map((member) => <option key={member.userId} value={member.userId}>{member.name} · {titleLabels[member.title]}</option>)}</select></label>
        </div>
        <div className="form-row">
          <label className="form-field">Deadline<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
          <label className="form-field">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSaving}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving || !projects.length || !staff.length}><Plus size={15} />{isSaving ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button></div>
      </form>
    </section>
  </div>, document.body)
}

function TeamDialog({ staff, onClose, onChanged }: {
  staff: StaffAccount[]
  onClose: () => void
  onChanged: () => void
}) {
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const freeTitles = (['liaison_officer', 'engineer', 'architect'] as StaffTitle[])
    .filter((title) => !staff.some((member) => member.title === title))
  const [title, setTitle] = useState<StaffTitle>(freeTitles[0] ?? 'liaison_officer')
  const selectedTitle = freeTitles.includes(title) ? title : freeTitles[0] ?? title
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workingUserId, setWorkingUserId] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setResult('')
    setIsSubmitting(true)
    try {
      const response = await inviteStaffMember({ name, email, title: selectedTitle })
      setResult(response.emailSent
        ? `Invitation or sign-in email sent to ${email.trim()}.`
        : `Staff access is ready for ${email.trim()}, but the email could not be sent${response.emailError ? `: ${response.emailError}` : '.'}`)
      showToast(response.emailError ? 'Staff access updated, but the email could not be sent.' : 'Staff invitation sent.')
      setName('')
      setEmail('')
      onChanged()
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Could not invite this staff member.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resend = async (member: StaffAccount) => {
    setWorkingUserId(member.userId)
    setError('')
    setResult('')
    try {
      const response = await resendStaffInvitation(member.userId)
      setResult(response.type === 'invitation' ? `Invitation resent to ${member.email}.` : `Sign-in link sent to ${member.email}.`)
      showToast(response.type === 'invitation' ? 'Staff invitation resent.' : 'Staff sign-in link sent.')
      onChanged()
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Could not resend this email.')
    } finally {
      setWorkingUserId('')
    }
  }

  const revoke = async (member: StaffAccount) => {
    if (!window.confirm(`Revoke workspace access for ${member.name} (${member.email})? Their account will remain, but they will no longer be able to access staff tasks.`)) return
    setWorkingUserId(member.userId)
    setError('')
    setResult('')
    try {
      await revokeStaffAccess(member.userId)
      setResult(`Workspace access revoked for ${member.name}.`)
      showToast(`Access revoked for ${member.name}.`, 'delete')
      onChanged()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke staff access.')
    } finally {
      setWorkingUserId('')
    }
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting && !workingUserId) onClose() }}>
    <section className="project-modal task-team-dialog" role="dialog" aria-modal="true" aria-labelledby="task-team-title">
      <div className="modal-heading"><div><div className="section-kicker">Workspace team</div><h2 id="task-team-title">Manage staff</h2></div><button type="button" className="icon-button" aria-label="Close" disabled={isSubmitting || Boolean(workingUserId)} onClick={onClose}><X size={18} /></button></div>
      <p className="modal-intro">Invite the liaison officer, engineer, and architect. Each role has one team account, and staff can access only their assigned tasks.</p>
      <section className="task-team-list" aria-label="Current staff">
        {(['liaison_officer', 'engineer', 'architect'] as StaffTitle[]).map((role) => {
          const member = staff.find((item) => item.title === role)
          return <div className="task-team-member" key={role}>
            <span className="task-team-avatar">{role === 'liaison_officer' ? 'L' : role === 'engineer' ? 'E' : 'A'}</span>
            <span className="task-team-identity"><strong>{member?.name ?? titleLabels[role]}</strong><small>{member ? member.email : 'Role available'}</small></span>
            {member ? <><span className={`task-team-status ${member.status}`}>{member.status === 'accepted' ? 'Active' : 'Pending'}</span><button type="button" className="text-button compact-button" disabled={Boolean(workingUserId) || isSubmitting} onClick={() => { void resend(member) }}><Mail size={14} />{workingUserId === member.userId ? 'Sending…' : member.status === 'pending' ? 'Resend' : 'Sign-in link'}</button><button type="button" className="text-button compact-button task-revoke-access" disabled={Boolean(workingUserId) || isSubmitting} onClick={() => { void revoke(member) }}>{workingUserId === member.userId ? 'Revoking…' : 'Revoke access'}</button></> : <span className="task-team-status available">Available</span>}
          </div>
        })}
      </section>
      {freeTitles.length ? <form className="task-invite-form" onSubmit={(event) => { void submit(event) }}>
        <h3><UserRoundPlus size={16} />Invite an approved team member</h3>
        <div className="form-row"><label className="form-field">Full name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required /></label><label className="form-field">Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label></div>
        <label className="form-field">Team role<select value={selectedTitle} onChange={(event) => setTitle(event.target.value as StaffTitle)}>{freeTitles.map((role) => <option key={role} value={role}>{titleLabels[role]}</option>)}</select></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {result && <p className="document-success" role="status">{result}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting || Boolean(workingUserId)}>Close</button><button type="submit" className="button button-primary" disabled={isSubmitting || Boolean(workingUserId)}><Mail size={15} />{isSubmitting ? 'Sending…' : 'Send invitation'}</button></div>
      </form> : <div className="task-team-complete"><strong>All three team roles are assigned.</strong><p>Use the resend action to send a new invitation or sign-in link.</p>{error && <p className="form-error" role="alert">{error}</p>}{result && <p className="document-success" role="status">{result}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div></div>}
    </section>
  </div>, document.body)
}
