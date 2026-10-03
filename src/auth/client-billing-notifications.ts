const storagePrefix = 'sagact:client-billing-notifications:read:'

export function loadReadClientBillingNotificationIds(userId: string): string[] {
  const stored = window.localStorage.getItem(`${storagePrefix}${userId}`)
  if (stored === null) return []

  const parsed: unknown = JSON.parse(stored)
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error('Saved notification state is invalid.')
  }
  return parsed
}

export function saveReadClientBillingNotificationIds(userId: string, notificationIds: readonly string[]) {
  window.localStorage.setItem(`${storagePrefix}${userId}`, JSON.stringify([...new Set(notificationIds)]))
}
