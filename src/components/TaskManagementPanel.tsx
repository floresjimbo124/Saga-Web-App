import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Columns3, Filter, Mail, MessageCircle, Pencil,
  Plus, RefreshCw, Trash2, UserRoundPlus, Users, X,
} from 'lucide-react'
import { TaskActivityPanel } from './TaskActivityPanel'
import {
  deleteProjectTask, loadProjectTasks, saveProjectTask, updateProjectTaskStatus,
  summarizeStaffTasksForWeek,
  type ProjectTask, type StaffTitle, type TaskAssignee, type TaskInput,
  type TaskPriority, type TaskStatus,
} from '../data/tasks'
import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'
import { inviteStaffMember, loadStaffMembers, resendStaffInvitation, revokeStaffAccess, type StaffAccount } from '../data/staff-invitations'
import { getPhilippineHoliday } from '../data/philippine-holidays'
import { useToast } from './toast-context'

type ProjectOption = { id: string; name: string }
type StatusFilter = 'all' | TaskStatus
type PriorityFilter = 'all' | TaskPriority
type MobileStatusDirection = 'next' | 'previous'

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

function startOfLocalWeek(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

function shiftDateText(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00`)
  shifted.setDate(shifted.getDate() + days)
  return localDateText(shifted)
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en-PH', options).format(new Date(`${date}T12:00:00`))
}

function isOverdue(task: ProjectTask, today: string) {
  return task.status !== 'done' && task.dueDate < today
}

export function TaskManagementPanel({ isOwner, currentUserId, projects = [], notificationTaskId, onNotificationTaskClosed }: {
  isOwner: boolean
  currentUserId: string
  projects?: ProjectOption[]
  notificationTaskId?: string
  onNotificationTaskClosed?: () => void
}) {
  const { showToast } = useToast()
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [realtimeError, setRealtimeError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [layout, setLayout] = useState<'kanban' | 'calendar'>('kanban')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [mobileStatusFilter, setMobileStatusFilter] = useState<StatusFilter>('todo')
  const [mobileTaskListMinHeight, setMobileTaskListMinHeight] = useState(0)
  const [mobileStatusDirection, setMobileStatusDirection] = useState<MobileStatusDirection>('next')
  const mobileTaskListRef = useRef<HTMLElement | null>(null)
  const [isUpcomingOpen, setIsUpcomingOpen] = useState(false)
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [today, setToday] = useState(() => localDateText(new Date()))
  const [weekStart, setWeekStart] = useState(() => localDateText(startOfLocalWeek(new Date())))
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showTeamDialog, setShowTeamDialog] = useState(false)
  const [workingTaskId, setWorkingTaskId] = useState('')
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateText(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isUpcomingOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setIsUpcomingOpen(false)
    }
    window.document.addEventListener('keydown', closeOnEscape)
    return () => window.document.removeEventListener('keydown', closeOnEscape)
  }, [isUpcomingOpen])

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
  const notificationTask = notificationTaskId
    ? tasks.find((task) => task.id === notificationTaskId) ?? null
    : null
  const taskDetailsTask = notificationTask ?? selectedTask
  const staffById = useMemo(() => new Map(activeStaff.map((member) => [member.userId, member])), [activeStaff])
  const staffNames = useMemo(() => new Map(activeStaff.map((member) => [member.userId, member.name])), [activeStaff])
  const availableProjects = useMemo(() => {
    if (projects.length) return projects
    return [...new Map(tasks.map((task) => [task.projectId, { id: task.projectId, name: task.projectName }])).values()]
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [projects, tasks])
  const overdueTasks = tasks.filter((task) => isOverdue(task, today))
  const upcomingTasks = tasks
    .filter((task) => task.status !== 'done' && task.dueDate >= today && task.dueDate <= shiftDateText(today, 7))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title))
  const weeklyStaffSummary = useMemo(
    () => summarizeStaffTasksForWeek(tasks, activeStaff, weekStart, today),
    [tasks, activeStaff, weekStart, today],
  )
  const weekEnd = shiftDateText(weekStart, 6)
  const isCurrentWeek = weekStart === localDateText(startOfLocalWeek(new Date(`${today}T12:00:00`)))
  const visibleTasks = tasks.filter((task) => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
    if (isOwner && assigneeFilter !== 'all' && task.assignedTo !== assigneeFilter) return false
    if (projectFilter !== 'all' && task.projectId !== projectFilter) return false
    if (overdueOnly && !isOverdue(task, today)) return false
    return true
  })
  const monthLabel = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(month)
  const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
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
    showToast(taskId ? 'Task updated.' : 'Task created.', taskId ? 'update' : 'create')
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
      showToast('Task status updated.', 'update')
      return null
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : 'Could not update task status.'
      setError(message)
      return message
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
  const mobileTasks = mobileStatusFilter === 'all'
    ? visibleTasks
    : visibleTasks.filter((task) => task.status === mobileStatusFilter)
  const mobileStatusOptions: { value: StatusFilter; label: string }[] = [{ value: 'all', label: 'All' }, ...statusOptions]
  const activeFilterCount = Number(priorityFilter !== 'all') + Number(projectFilter !== 'all') + Number(isOwner && assigneeFilter !== 'all')

  return <div className="task-workspace">
    {isMobileFilterOpen && createPortal(<div className="modal-backdrop task-filter-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setIsMobileFilterOpen(false)
    }}>
      <section className="project-modal task-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="task-filter-title">
        <div className="modal-heading">
          <div><div className="section-kicker">Task list</div><h2 id="task-filter-title">Filters</h2></div>
          <button type="button" className="icon-button" aria-label="Close filters" onClick={() => setIsMobileFilterOpen(false)}><X size={18} /></button>
        </div>
        <div className="task-filter-sheet-fields">
          <label className="task-filter-field">Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
              <option value="all">All priorities</option>
              {(['high', 'normal', 'low'] as TaskPriority[]).map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
            </select>
          </label>
          <label className="task-filter-field">Project
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="all">All projects</option>
              {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          {isOwner && <label className="task-filter-field">Assignee
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
              <option value="all">Everyone</option>
              {activeStaff.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
            </select>
          </label>}
        </div>
        <div className="task-filter-sheet-actions">
          <button type="button" className="button button-secondary" onClick={() => {
            setPriorityFilter('all')
            setProjectFilter('all')
            setAssigneeFilter('all')
          }} disabled={activeFilterCount === 0}>Clear filters</button>
          <button type="button" className="button button-primary" onClick={() => setIsMobileFilterOpen(false)}>Show {taskCountText}</button>
        </div>
      </section>
    </div>, document.body)}
    {(showTaskForm || editingTask) && <TaskEditorDialog
      task={editingTask}
      projects={projects}
      staff={activeStaff}
      today={today}
      onClose={() => { setShowTaskForm(false); setEditingTask(null) }}
      onSave={saveTask}
    />}
    {taskDetailsTask && <TaskDetailsDialog
      task={tasks.find((task) => task.id === taskDetailsTask.id) ?? taskDetailsTask}
      today={today}
      currentUserId={currentUserId}
      staffNames={staffNames}
      isUpdatingStatus={workingTaskId === taskDetailsTask.id}
      onStatusChange={(status) => changeStatus(taskDetailsTask, status)}
      onClose={() => {
        setSelectedTask(null)
        onNotificationTaskClosed?.()
      }}
    />}
    {showTeamDialog && <TeamDialog
      staff={staff}
      onClose={() => setShowTeamDialog(false)}
      onChanged={refresh}
    />}
    {isUpcomingOpen && createPortal(<div className="modal-backdrop task-upcoming-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setIsUpcomingOpen(false)
    }}>
      <section className="project-modal task-upcoming-dialog" role="dialog" aria-modal="true" aria-labelledby="task-upcoming-title">
        <div className="modal-heading">
          <div><div className="section-kicker">Next 7 days</div><h2 id="task-upcoming-title">Upcoming tasks</h2></div>
          <button type="button" className="icon-button" aria-label="Close upcoming tasks" onClick={() => setIsUpcomingOpen(false)}><X size={18} /></button>
        </div>
        {upcomingTasks.length ? <div className="task-upcoming-dialog-list">
          {upcomingTasks.map((task) => <button type="button" key={task.id} onClick={() => {
            setIsUpcomingOpen(false)
            setSelectedTask(task)
          }}>
            <span className="task-upcoming-dialog-date">{task.dueDate === today ? 'Today' : formatDate(task.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span className="task-upcoming-dialog-copy"><strong>{task.title}</strong><small>{task.projectName}{task.assignedTo && staffById.has(task.assignedTo) ? ` · ${staffById.get(task.assignedTo)?.name}` : ''}</small></span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div> : <p className="task-upcoming-empty">No tasks due in the next 7 days.</p>}
      </section>
    </div>, document.body)}
    <section className="page-heading task-page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" />Team workspace</div>
        <h1>{isOwner ? 'Tasks & calendar' : 'My tasks'}</h1>
      </div>
      <div className="heading-actions task-heading-actions">
        {isOwner && <>
          <button type="button" className="button button-secondary" onClick={() => setShowTeamDialog(true)}><Users size={15} />Manage team</button>
          <button type="button" className="button button-primary" onClick={() => setShowTaskForm(true)} disabled={!projects.length || !activeStaff.length}><Plus size={15} />Add task</button>
        </>}
      </div>
    </section>

    <section className="task-upcoming-summary">
      <button type="button" className="task-upcoming-toggle" aria-haspopup="dialog" onClick={() => setIsUpcomingOpen(true)}>
        <CalendarDays size={18} aria-hidden="true" />
        <span className="task-upcoming-content">
          <span className="task-upcoming-heading">
            <strong id="task-upcoming-title">Upcoming tasks</strong>
            <span>{upcomingTasks.length} due in the next 7 days</span>
          </span>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </section>

    {error && <div className="task-error" role="alert">{error}</div>}
    {realtimeError && <div className="task-error" role="status">{realtimeError}</div>}
    {!isOwner && overdueTasks.length > 0 && <section className="task-overdue-notice" role="alert" aria-live="polite">
      <CircleAlert size={19} aria-hidden="true" />
      <div className="task-overdue-notice-copy">
        <strong>{overdueTasks.length} overdue {overdueTasks.length === 1 ? 'task needs' : 'tasks need'} your attention</strong>
        <p>{overdueTasks.slice(0, 2).map((task) => task.title).join(' · ')}{overdueTasks.length > 2 ? ` · +${overdueTasks.length - 2} more` : ''}</p>
      </div>
      <button
        type="button"
        className="button button-secondary task-overdue-notice-action"
        aria-pressed={overdueOnly}
        onClick={() => {
          setOverdueOnly((current) => !current)
          if (!overdueOnly) {
            setStatusFilter('all')
            setPriorityFilter('all')
            setProjectFilter('all')
          }
        }}
      >{overdueOnly ? 'Show all tasks' : 'View overdue tasks'}</button>
    </section>}
    {!isLoading && !error && isOwner && (!projects.length || !activeStaff.length) && <section className="task-setup-notice">
      <Users size={18} />
      <div><strong>{!activeStaff.length ? 'Invite your team to get started' : 'Add a project before creating tasks'}</strong>
        <p>{!activeStaff.length ? 'Invite the liaison officer, engineer, and architect. You can assign tasks once their accounts are set up.' : 'Tasks need to be linked to a project.'}</p>
      </div>
      {!activeStaff.length && <button type="button" className="button button-secondary" onClick={() => setShowTeamDialog(true)}><UserRoundPlus size={15} />Invite staff</button>}
    </section>}

    {isOwner && <section className="task-weekly-summary surface-card" aria-labelledby="task-weekly-summary-title">
      <div className="task-weekly-summary-heading">
        <div>
          <h2 id="task-weekly-summary-title">Weekly task summary</h2>
          <p>{formatDate(weekStart)} – {formatDate(weekEnd)}</p>
        </div>
        <div className="task-week-controls" aria-label="Select summary week">
          <button type="button" className="icon-button" aria-label="Previous week" onClick={() => setWeekStart((current) => shiftDateText(current, -7))}><ChevronLeft size={17} /></button>
          <button type="button" className="text-button compact-button" disabled={isCurrentWeek} onClick={() => setWeekStart(localDateText(startOfLocalWeek(new Date(`${today}T12:00:00`))))}>This week</button>
          <button type="button" className="icon-button" aria-label="Next week" onClick={() => setWeekStart((current) => shiftDateText(current, 7))}><ChevronRight size={17} /></button>
        </div>
      </div>
      {weeklyStaffSummary.length ? <div className="task-weekly-table-scroll">
        <table className="task-weekly-table">
          <thead><tr>
            <th scope="col">Staff</th>
            <th scope="col">Due this week</th>
            <th scope="col">Complete</th>
            <th scope="col">To do</th>
            <th scope="col">In progress</th>
            <th scope="col">Blocked</th>
            <th scope="col">Overdue</th>
          </tr></thead>
          <tbody>{weeklyStaffSummary.map((summary) => <tr key={summary.userId}>
            <th scope="row">{summary.staffName}</th>
            <td>{summary.dueThisWeek}</td>
            <td>{summary.complete}</td>
            <td>{summary.pending}</td>
            <td>{summary.inProgress}</td>
            <td>{summary.blocked}</td>
            <td className={summary.overdue ? 'has-overdue-tasks' : ''}>{summary.overdue}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="task-weekly-empty">Invite staff to see a weekly task summary by team member.</p>}
      <small className="task-weekly-summary-note">Status counts include tasks due in the selected week. Overdue counts show each staff member’s current overdue tasks.</small>
    </section>}

    <section className={`task-toolbar surface-card task-toolbar-${layout}`} aria-label="Task filters">
      <div className="task-toolbar-filters">
        <button type="button" className="button button-secondary task-mobile-filter-button" aria-haspopup="dialog" aria-expanded={isMobileFilterOpen} onClick={() => setIsMobileFilterOpen(true)}>
          <Filter size={15} />Filter{activeFilterCount > 0 && <span className="task-filter-count">{activeFilterCount}</span>}
        </button>
        <label className="task-filter-field">Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </label>
        <label className="task-filter-field">Priority
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
            <option value="all">All priorities</option>
            {(['high', 'normal', 'low'] as TaskPriority[]).map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
          </select>
        </label>
        <label className="task-filter-field">Project
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="all">All projects</option>
            {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        {isOwner && <label className="task-filter-field">Assignee
          <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
            <option value="all">Everyone</option>
            {activeStaff.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
          </select>
        </label>}
      </div>
      <div className="task-toolbar-actions">
        <button type="button" className="button button-secondary task-refresh-button" onClick={refresh} disabled={isLoading} aria-label="Refresh tasks">
          <RefreshCw size={14} className={isLoading ? 'is-spinning' : ''} />Refresh
        </button>
        <div className="task-view-switch" role="group" aria-label="Task view">
          <button type="button" className={layout === 'kanban' ? 'is-active' : ''} aria-pressed={layout === 'kanban'} onClick={() => setLayout('kanban')}><Columns3 size={15} />Kanban</button>
          <button type="button" className={layout === 'calendar' ? 'is-active' : ''} aria-pressed={layout === 'calendar'} onClick={() => setLayout('calendar')}><CalendarDays size={15} />Calendar</button>
        </div>
      </div>
    </section>

    {isLoading ? <div className="task-loading" role="status"><RefreshCw size={16} />Loading tasks…</div>
      : layout === 'kanban' ? <section className="task-kanban-panel" aria-label="Tasks by status">
        <div className="task-list-heading">
          <h2>{isOwner ? 'Project tasks' : 'Assigned to me'}</h2><span>{taskCountText}</span>
        </div>
        <div className="task-mobile-status-filter" role="group" aria-label="Filter tasks by status">
          {mobileStatusOptions.map((status) => {
            const count = status.value === 'all' ? visibleTasks.length : visibleTasks.filter((task) => task.status === status.value).length
            return <button type="button" key={status.value} className={mobileStatusFilter === status.value ? 'is-active' : ''} aria-pressed={mobileStatusFilter === status.value} onClick={() => {
              const currentIndex = mobileStatusOptions.findIndex((item) => item.value === mobileStatusFilter)
              const nextIndex = mobileStatusOptions.findIndex((item) => item.value === status.value)
              if (status.value === mobileStatusFilter) return
              const currentListHeight = mobileTaskListRef.current?.getBoundingClientRect().height ?? 0
              const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
              setMobileTaskListMinHeight(prefersReducedMotion ? 0 : currentListHeight)
              setMobileStatusDirection(nextIndex >= currentIndex ? 'next' : 'previous')
              setMobileStatusFilter(status.value)
            }}>
              <span>{status.label}</span><small>{count}</small>
            </button>
          })}
        </div>
        <section ref={mobileTaskListRef} key={mobileStatusFilter} className={`task-mobile-list slide-${mobileStatusDirection}`} style={{ minHeight: mobileTaskListMinHeight || undefined }} onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setMobileTaskListMinHeight(0)
        }} aria-label={mobileStatusFilter === 'all' ? 'All tasks' : `${statusOptions.find((status) => status.value === mobileStatusFilter)?.label} tasks`}>
          {mobileTasks.length ? mobileTasks.map((task) => <TaskCard
            key={task.id}
            task={task}
            assignee={task.assignedTo ? staffById.get(task.assignedTo) : undefined}
            today={today}
            isOwner={isOwner}
            currentUserId={currentUserId}
            isWorking={workingTaskId === task.id}
            onOpen={() => setSelectedTask(task)}
            onStatusChange={(status) => { void changeStatus(task, status) }}
            onEdit={() => { setEditingTask(task); setShowTaskForm(true) }}
            onDelete={() => { void removeTask(task) }}
          />) : <p className="task-kanban-empty">{overdueOnly ? 'No overdue tasks match these filters.' : tasks.length ? 'No tasks match these filters.' : isOwner ? 'No tasks yet. Add a task and assign it to a team member.' : 'No tasks have been assigned to you yet.'}</p>}
        </section>
        <div className="task-kanban-board">
          {statusOptions.map((status) => {
            const columnTasks = visibleTasks.filter((task) => task.status === status.value)
            return <section className={`task-kanban-column task-kanban-${status.value}`} key={status.value} aria-labelledby={`task-kanban-${status.value}`}>
              <div className="task-kanban-column-heading">
                <h3 id={`task-kanban-${status.value}`}>{status.label}</h3>
                <span>{columnTasks.length}</span>
              </div>
              <div className="task-kanban-cards">
                {columnTasks.length ? columnTasks.map((task) => <TaskCard
                  key={task.id}
                  task={task}
                  assignee={task.assignedTo ? staffById.get(task.assignedTo) : undefined}
                  today={today}
                  isOwner={isOwner}
                  currentUserId={currentUserId}
                  isWorking={workingTaskId === task.id}
                  onOpen={() => setSelectedTask(task)}
                  onStatusChange={(status) => { void changeStatus(task, status) }}
                  onEdit={() => { setEditingTask(task); setShowTaskForm(true) }}
                  onDelete={() => { void removeTask(task) }}
                />) : <p className="task-kanban-empty">No tasks</p>}
              </div>
            </section>
          })}
        </div>
        {!visibleTasks.length && <p className="task-kanban-filter-empty">{overdueOnly ? 'No overdue tasks match these filters.' : tasks.length ? 'No tasks match these filters.' : isOwner ? 'No tasks yet. Add a task and assign it to a team member.' : 'No tasks have been assigned to you yet.'}</p>}
      </section> : <section className="task-calendar-panel surface-card" aria-label="Task calendar">
        <div className="task-calendar-heading">
          <div><h2>{monthLabel}</h2></div>
          <div className="task-calendar-controls">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
            <button type="button" className="text-button compact-button" onClick={() => setMonth(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1))}>Today</button>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
          </div>
        </div>
        <div className="task-calendar-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="task-calendar-weekday" key={day}>{day}</div>)}
          {calendarCells.map((day, index) => {
            if (day === null) return <div className="task-calendar-day task-calendar-blank" key={`blank-${index}`} aria-hidden="true" />
            const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayTasks = visibleTasks.filter((task) => task.dueDate === date)
            const holiday = getPhilippineHoliday(date)
            const isToday = date === today
            return <div className={`task-calendar-day ${isToday ? 'is-today' : ''} ${holiday ? 'is-philippine-holiday' : ''}`} key={date}>
              <span className="task-calendar-date">{day}</span>
              {holiday && <span className="task-calendar-holiday" title={`${holiday.name} · ${holiday.type}`}>
                <strong>{holiday.name}</strong><small>{holiday.type}</small>
              </span>}
              <div className="task-calendar-items" aria-label={`Tasks due ${formatDate(date)}`}>{dayTasks.map((task) => <button
                type="button"
                key={task.id}
                className={`task-calendar-item task-status-${task.status} ${isOverdue(task, today) ? 'is-overdue' : ''} ${task.status === 'done' ? 'is-complete' : ''}`}
                title={`${task.title} · ${task.projectName}`}
                onClick={() => {
                  if (isOwner) {
                    setEditingTask(task)
                    setShowTaskForm(true)
                  } else {
                    setSelectedTask(task)
                  }
                }}
              >{task.title}</button>)}
              </div>
            </div>
          })}
        </div>
        <div className="task-calendar-legend">
          <span><i className="task-legend-dot task-legend-open" />Open</span>
          <span><i className="task-legend-dot task-legend-complete" />Complete</span>
          <span><i className="task-legend-dot task-legend-overdue" />Overdue</span>
          <span><i className="task-legend-dot task-legend-holiday" />Philippine holiday (2026)</span>
        </div>
        {!visibleTasks.some((task) => task.dueDate.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`)) && <p className="task-calendar-empty">No deadlines this month.</p>}
      </section>}
  </div>
}

function TaskCard({ task, assignee, today, isOwner, currentUserId, isWorking, onOpen, onStatusChange, onEdit, onDelete }: {
  task: ProjectTask
  assignee?: TaskAssignee
  today: string
  isOwner: boolean
  currentUserId: string
  isWorking: boolean
  onOpen: () => void
  onStatusChange: (status: TaskStatus) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const overdue = isOverdue(task, today)
  const canUpdateStatus = isOwner || task.assignedTo === currentUserId
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, label, [contenteditable="true"]')) return
    onOpen()
  }
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onOpen()
  }
  return <article
    className={`task-card task-card-priority-${task.priority} ${overdue ? 'is-overdue' : ''}`}
    role="group"
    tabIndex={0}
    aria-label={`Task: ${task.title}. Press Enter or Space to view details.`}
    onClick={handleCardClick}
    onKeyDown={handleCardKeyDown}
  >
    <div className="task-card-main">
      <div className="task-card-topline"><span className={`task-priority task-priority-${task.priority}`}>{priorityLabels[task.priority]} priority</span>{overdue && <span className="task-overdue-label">Overdue</span>}</div>
      <h3 className={task.status === 'done' ? 'is-complete' : ''}>{task.title}</h3>
      {task.description && <p className="task-card-description">{task.description}</p>}
      <div className="task-card-meta"><span><CalendarDays size={14} />{formatDate(task.dueDate)}</span><span><span className="task-meta-project">{task.projectName}</span></span>{assignee && <span><Users size={14} />{assignee.name}</span>}</div>
    </div>
    <div className="task-card-actions">
      {canUpdateStatus && <label className={`task-status-control task-status-${task.status}`}><span className="sr-only">Status for {task.title}</span><select value={task.status} disabled={isWorking} onChange={(event) => onStatusChange(event.target.value as TaskStatus)}>{statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>}
      <button type="button" className="icon-button task-action" aria-label={`Open details and comments for ${task.title}`} title="Open task details and comments" onClick={onOpen} disabled={isWorking}><MessageCircle size={15} /></button>
      {isOwner && <><button type="button" className="icon-button task-action" aria-label={`Edit ${task.title}`} title="Edit task" onClick={onEdit} disabled={isWorking}><Pencil size={15} /></button><button type="button" className="icon-button task-action task-delete-action" aria-label={`Delete ${task.title}`} title="Delete task" onClick={onDelete} disabled={isWorking}><Trash2 size={15} /></button></>}
    </div>
  </article>
}

function TaskDetailsDialog({ task, today, currentUserId, staffNames, isUpdatingStatus, onStatusChange, onClose }: {
  task: ProjectTask
  today: string
  currentUserId: string
  staffNames: ReadonlyMap<string, string>
  isUpdatingStatus: boolean
  onStatusChange: (status: TaskStatus) => Promise<string | null>
  onClose: () => void
}) {
  const [statusError, setStatusError] = useState('')

  const updateStatus = async (status: TaskStatus) => {
    setStatusError('')
    const error = await onStatusChange(status)
    if (error) setStatusError(error)
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="project-modal task-details-dialog" role="dialog" aria-modal="true" aria-labelledby="task-details-title">
      <div className="modal-heading">
        <div><div className="section-kicker">Assigned task</div><h2 id="task-details-title" className={task.status === 'done' ? 'is-complete' : ''}>{task.title}</h2></div>
        <button type="button" className="icon-button" aria-label="Close task details" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="task-details-badges">
        <label className={`task-status-control task-status-${task.status} task-details-status-control`}>
          <span>Status</span>
          <select
            aria-label={`Status for ${task.title}`}
            value={task.status}
            disabled={isUpdatingStatus}
            onChange={(event) => { void updateStatus(event.target.value as TaskStatus) }}
          >
            {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </label>
        <span className="task-details-priority-control">
          <span>Priority</span>
          <span className={`task-priority task-priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
        </span>
        {isOverdue(task, today) && <span className="task-overdue-label">Overdue</span>}
      </div>
      {statusError && <p className="form-error task-details-status-error" role="alert">{statusError}</p>}
      <dl className="task-details-grid">
        <div><dt>Project</dt><dd>{task.projectName}</dd></div>
        <div><dt>Deadline</dt><dd>{formatDate(task.dueDate)}</dd></div>
      </dl>
      <div className="task-details-description">
        <h3>Task information</h3>
        <p>{task.description || 'No additional information was provided for this task.'}</p>
      </div>
      <TaskActivityPanel taskId={task.id} currentUserId={currentUserId} staffNames={staffNames} />
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button></div>
    </section>
  </div>, document.body)
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
