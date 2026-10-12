import { supabase } from '../lib/supabase'

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'
export type StaffTitle = 'liaison_officer' | 'engineer' | 'architect'

export type ProjectTask = {
  id: string
  projectId: string
  projectName: string
  assignedTo: string | null
  title: string
  description: string
  dueDate: string
  priority: TaskPriority
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export type TaskAssignee = {
  userId: string
  email: string
  name: string
  title: StaffTitle
}

export type TaskInput = {
  projectId: string
  assignedTo: string
  title: string
  description: string
  dueDate: string
  priority: TaskPriority
}

export type ProjectTaskActivityType = 'created' | 'updated' | 'status_changed' | 'comment'

export type ProjectTaskActivity = {
  id: string
  taskId: string
  authorId: string | null
  activityType: ProjectTaskActivityType
  body: string
  oldStatus: TaskStatus | null
  newStatus: TaskStatus | null
  createdAt: string
}

export type StaffTaskWeekSummary = {
  userId: string
  staffName: string
  dueThisWeek: number
  complete: number
  pending: number
  inProgress: number
  blocked: number
  overdue: number
}

type ProjectTaskRow = {
  id: string
  project_id: string
  project_name: string
  assigned_to: string | null
  title: string
  description: string
  due_date: string
  priority: TaskPriority
  status: TaskStatus
  created_at: string
  updated_at: string
}

type ProjectTaskActivityRow = {
  id: string
  task_id: string
  author_id: string | null
  activity_type: ProjectTaskActivityType
  body: string | null
  old_status: TaskStatus | null
  new_status: TaskStatus | null
  created_at: string
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function isValidDateText(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

export function validateTaskInput(input: TaskInput) {
  if (!input.projectId) throw new Error('Choose a project for this task.')
  if (!input.assignedTo) throw new Error('Assign the task to a staff member.')
  if (input.title.trim().length < 2 || input.title.trim().length > 160) {
    throw new Error('Task title must contain between 2 and 160 characters.')
  }
  if (input.description.trim().length > 4000) throw new Error('Task description must not exceed 4,000 characters.')
  if (!isValidDateText(input.dueDate)) throw new Error('Enter a valid task deadline.')
  if (!['low', 'normal', 'high'].includes(input.priority)) throw new Error('Choose a valid task priority.')
}

function addDaysToDateText(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function summarizeStaffTasksForWeek(
  tasks: ProjectTask[],
  staff: { userId: string; name: string }[],
  weekStart: string,
  today: string,
): StaffTaskWeekSummary[] {
  const weekEnd = addDaysToDateText(weekStart, 6)
  return staff.map((member) => {
    const assignedTasks = tasks.filter((task) => task.assignedTo === member.userId)
    const dueThisWeek = assignedTasks.filter((task) => task.dueDate >= weekStart && task.dueDate <= weekEnd)
    return {
      userId: member.userId,
      staffName: member.name,
      dueThisWeek: dueThisWeek.length,
      complete: dueThisWeek.filter((task) => task.status === 'done').length,
      pending: dueThisWeek.filter((task) => task.status === 'todo').length,
      inProgress: dueThisWeek.filter((task) => task.status === 'in_progress').length,
      blocked: dueThisWeek.filter((task) => task.status === 'blocked').length,
      overdue: assignedTasks.filter((task) => task.status !== 'done' && task.dueDate < today).length,
    }
  })
}

export async function loadProjectTasks() {
  const client = requireSupabase()
  const { data, error } = await client.rpc('get_project_task_workspace')
  throwIfError(error)
  const rows = data as ProjectTaskRow[] | null
  return (rows ?? []).map((task) => ({
    id: task.id,
    projectId: task.project_id,
    projectName: task.project_name,
    assignedTo: task.assigned_to,
    title: task.title,
    description: task.description ?? '',
    dueDate: task.due_date,
    priority: task.priority,
    status: task.status,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  } satisfies ProjectTask))
}

export async function saveProjectTask(input: TaskInput, taskId?: string) {
  validateTaskInput(input)
  const { error } = await requireSupabase().rpc(taskId ? 'update_project_task' : 'create_project_task', taskId ? {
    p_task_id: taskId,
    p_project_id: input.projectId,
    p_assigned_to: input.assignedTo,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_due_date: input.dueDate,
    p_priority: input.priority,
  } : {
    p_project_id: input.projectId,
    p_assigned_to: input.assignedTo,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_due_date: input.dueDate,
    p_priority: input.priority,
  })
  throwIfError(error)
}

export async function updateProjectTaskStatus(taskId: string, status: TaskStatus) {
  const { error } = await requireSupabase().rpc('update_project_task_status', {
    p_task_id: taskId,
    p_status: status,
  })
  throwIfError(error)
}

export async function deleteProjectTask(taskId: string) {
  const { error } = await requireSupabase().rpc('delete_project_task', { p_task_id: taskId })
  throwIfError(error)
}

export async function loadProjectTaskActivity(taskId: string) {
  const { data, error } = await requireSupabase()
    .from('project_task_activity')
    .select('id, task_id, author_id, activity_type, body, old_status, new_status, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  throwIfError(error)
  return ((data ?? []) as ProjectTaskActivityRow[]).map((activity) => ({
    id: activity.id,
    taskId: activity.task_id,
    authorId: activity.author_id,
    activityType: activity.activity_type,
    body: activity.body ?? '',
    oldStatus: activity.old_status,
    newStatus: activity.new_status,
    createdAt: activity.created_at,
  } satisfies ProjectTaskActivity))
}

export async function addProjectTaskComment(taskId: string, body: string) {
  const normalizedBody = body.trim()
  if (!normalizedBody || normalizedBody.length > 2000) {
    throw new Error('Comments must contain between 1 and 2,000 characters.')
  }
  const { error } = await requireSupabase().rpc('add_project_task_comment', {
    p_task_id: taskId,
    p_body: normalizedBody,
  })
  throwIfError(error)
}
