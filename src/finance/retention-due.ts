const millisecondsPerDay = 86_400_000

function toDayNumber(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / millisecondsPerDay)
}

function formatDay(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function getRetentionDueDate(completedAt: string | null): string | null {
  if (!completedAt) return null
  const [year, month, day] = completedAt.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null

  const dueMonth = month
  const dueYear = year + Math.floor(dueMonth / 12)
  const normalizedMonth = dueMonth % 12
  const lastDayOfMonth = new Date(Date.UTC(dueYear, normalizedMonth + 1, 0)).getUTCDate()
  return formatDay(dueYear, normalizedMonth, Math.min(day, lastDayOfMonth))
}

export function isRetentionDue(completedAt: string | null, asOfDate: string): boolean {
  const dueDate = getRetentionDueDate(completedAt)
  return dueDate !== null && toDayNumber(dueDate) <= toDayNumber(asOfDate)
}
