import type { ProjectTask } from './tasks'

export type TaskNotification = {
  id: string
  taskId: string
  title: string
  detail: string
  kind: 'due-soon' | 'overdue'
  dueDate: string
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function buildTaskNotifications(tasks: ProjectTask[], today: string): TaskNotification[] {
  const tomorrow = addDays(today, 1)
  return tasks
    .filter((task) => task.status !== 'done' && (task.dueDate === tomorrow || task.dueDate < today))
    .map((task) => {
      const kind: TaskNotification['kind'] = task.dueDate < today ? 'overdue' : 'due-soon'
      return {
        id: `task:${task.id}:${kind}:${task.dueDate}`,
        taskId: task.id,
        title: kind === 'overdue' ? 'Overdue task' : 'Due tomorrow',
        detail: `${task.title} · ${task.projectName}`,
        kind,
        dueDate: task.dueDate,
      }
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'overdue' ? -1 : 1
      return left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title)
    })
}
