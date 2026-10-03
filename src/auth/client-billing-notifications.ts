import { loadReadNotificationIds, saveReadNotificationIds } from './notification-read-state'

export function loadReadClientBillingNotificationIds(userId: string): string[] {
  return loadReadNotificationIds(`client:${userId}`)
}

export function saveReadClientBillingNotificationIds(userId: string, notificationIds: readonly string[]) {
  saveReadNotificationIds(`client:${userId}`, notificationIds)
}
