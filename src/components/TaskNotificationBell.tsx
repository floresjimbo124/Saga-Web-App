import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CalendarDays, CircleAlert, X } from 'lucide-react'
import { loadReadNotificationIds, saveReadNotificationIds } from '../auth/notification-read-state'
import { buildTaskNotifications } from '../data/task-notifications'
import type { ProjectTask } from '../data/tasks'

export function TaskNotificationBell({ tasks, today, scope, onOpenTask }: {
  tasks: ProjectTask[]
  today: string
  scope: string
  onOpenTask: (taskId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [readState, setReadState] = useState(() => {
    try {
      return { ids: new Set(loadReadNotificationIds(`tasks:${scope}`)), error: '' }
    } catch (error) {
      return {
        ids: new Set<string>(),
        error: error instanceof Error ? error.message : 'Could not load task notification status.',
      }
    }
  })
  const container = useRef<HTMLDivElement>(null)
  const notifications = useMemo(() => buildTaskNotifications(tasks, today), [tasks, today])
  const unreadCount = notifications.filter((notification) => !readState.ids.has(notification.id)).length

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.document.addEventListener('pointerdown', closeOnOutsideClick)
    window.document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsideClick)
      window.document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const saveReadState = (ids: Set<string>) => {
    setReadState({ ids, error: '' })
    try {
      saveReadNotificationIds(`tasks:${scope}`, [...ids])
    } catch (error) {
      setReadState({
        ids,
        error: error instanceof Error ? `Could not save task notification status: ${error.message}` : 'Could not save task notification status.',
      })
    }
  }

  const openNotification = (notificationId: string, taskId: string) => {
    const ids = new Set(readState.ids)
    ids.add(notificationId)
    saveReadState(ids)
    setIsOpen(false)
    onOpenTask(taskId)
  }

  const markAllAsRead = () => {
    const ids = new Set(readState.ids)
    for (const notification of notifications) ids.add(notification.id)
    saveReadState(ids)
  }

  const countLabel = unreadCount === 1 ? '1 unread task alert' : `${unreadCount} unread task alerts`

  return <div className="task-notification-center" ref={container}>
    <button
      className={`icon-button task-notification-button ${unreadCount ? 'has-notifications' : ''}`}
      type="button"
      aria-label={`Task notifications, ${countLabel}`}
      aria-expanded={isOpen}
      aria-controls="task-notifications"
      title={countLabel}
      onClick={() => setIsOpen((open) => !open)}
    >
      <Bell size={17} />
      {unreadCount > 0 && <span className="task-notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {isOpen && <section className="task-notification-panel" id="task-notifications" aria-label="Task notifications">
      <div className="task-notification-heading">
        <h2>Task notifications</h2>
        <div>
          {unreadCount > 0 && <button type="button" className="text-button" onClick={markAllAsRead}>Mark all as read</button>}
          <button type="button" className="icon-button" aria-label="Close task notifications" onClick={() => setIsOpen(false)}><X size={16} /></button>
        </div>
      </div>
      {readState.error && <p className="form-error" role="alert">{readState.error}</p>}
      {notifications.length ? <div className="task-notification-list">{notifications.map((notification) => {
        const isRead = readState.ids.has(notification.id)
        return <button
          type="button"
          className={`task-notification-row ${notification.kind === 'overdue' ? 'is-overdue' : ''} ${isRead ? 'is-read' : ''}`}
          key={notification.id}
          onClick={() => openNotification(notification.id, notification.taskId)}
        >
          <span className="task-notification-icon">{notification.kind === 'overdue' ? <CircleAlert size={16} /> : <CalendarDays size={16} />}</span>
          <span className="task-notification-copy">
            <strong>{notification.title}</strong>
            <small>{notification.detail}</small>
          </span>
        </button>
      })}</div> : <p className="task-notification-empty">No upcoming or overdue task alerts.</p>}
    </section>}
  </div>
}
