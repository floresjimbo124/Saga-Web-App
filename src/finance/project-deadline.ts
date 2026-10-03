import type { ProjectStatus } from '../data/portfolio'

export type ProjectDeadlineLevel = 'none' | 'completed' | 'on-track' | 'due-soon' | 'overdue'

export type ProjectDeadlineStatus = {
  level: ProjectDeadlineLevel
  label: string
  detail: string
  daysRemaining: number | null
}

const millisecondsPerDay = 86_400_000
const dueSoonWindowDays = 30

function dateDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return Number.NaN
  const [, year, month, day] = match
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / millisecondsPerDay)
}

function todayLocal() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getProjectDeadlineStatus(
  deadline: string | null,
  projectStatus: ProjectStatus,
  asOfDate = todayLocal(),
): ProjectDeadlineStatus {
  if (projectStatus === 'completed' || projectStatus === 'closed') {
    return { level: 'completed', label: 'Complete', detail: 'Project is complete', daysRemaining: null }
  }
  if (!deadline) {
    return { level: 'none', label: 'No deadline', detail: 'Set a project deadline', daysRemaining: null }
  }

  const deadlineDay = dateDay(deadline)
  const currentDay = dateDay(asOfDate)
  if (!Number.isFinite(deadlineDay) || !Number.isFinite(currentDay)) {
    return { level: 'none', label: 'No deadline', detail: 'Set a valid project deadline', daysRemaining: null }
  }

  const daysRemaining = deadlineDay - currentDay
  if (daysRemaining < 0) {
    const daysOverdue = Math.abs(daysRemaining)
    return {
      level: 'overdue',
      label: 'Overdue',
      detail: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue · due ${deadline}`,
      daysRemaining,
    }
  }
  if (daysRemaining <= dueSoonWindowDays) {
    const dueLabel = daysRemaining === 0 ? 'Due today' : `Due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
    return { level: 'due-soon', label: 'Due soon', detail: `${dueLabel} · ${deadline}`, daysRemaining }
  }
  return { level: 'on-track', label: 'On track', detail: `Due ${deadline}`, daysRemaining }
}