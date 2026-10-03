const storagePrefix = 'sagact:notifications:read:'

export function loadReadNotificationIds(scope: string): string[] {
  const stored = window.localStorage.getItem(`${storagePrefix}${scope}`)
  if (stored === null) return []

  const parsed: unknown = JSON.parse(stored)
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error('Saved notification state is invalid.')
  }
  return parsed
}

export function saveReadNotificationIds(scope: string, notificationIds: readonly string[]) {
  window.localStorage.setItem(`${storagePrefix}${scope}`, JSON.stringify([...new Set(notificationIds)]))
}
