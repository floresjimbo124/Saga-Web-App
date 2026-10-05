import { useEffect, useRef, useState } from 'react'
import { Bell, CalendarDays, CircleAlert, X } from 'lucide-react'
import { loadReadNotificationIds, saveReadNotificationIds } from '../auth/notification-read-state'
import type { PortfolioProject } from '../data/portfolio'
import type { ReceivableAgingItem } from '../finance/receivables-aging'
import { buildDashboardNotifications } from '../finance/dashboard-notifications'

export function NotificationCenter({ projects, receivables, onOpenProject }: {
  projects: PortfolioProject[]
  receivables: ReceivableAgingItem[]
  onOpenProject: (projectId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [readState, setReadState] = useState(() => {
    try {
      return { ids: new Set(loadReadNotificationIds('owner')), error: '' }
    } catch (error) {
      return {
        ids: new Set<string>(),
        error: error instanceof Error ? error.message : 'Could not load notification read status.',
      }
    }
  })
  const container = useRef<HTMLDivElement>(null)
  const notifications = buildDashboardNotifications(projects, receivables)
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

  const countLabel = unreadCount === 1 ? '1 unread alert' : `${unreadCount} unread alerts`

  const openNotification = (notificationId: string, projectId: string) => {
    const readIds = new Set(readState.ids)
    readIds.add(notificationId)
    setReadState({ ids: readIds, error: '' })
    try {
      saveReadNotificationIds('owner', [...readIds])
    } catch (error) {
      setReadState({
        ids: readIds,
        error: error instanceof Error ? `Could not save notification read status: ${error.message}` : 'Could not save notification read status.',
      })
    }
    setIsOpen(false)
    onOpenProject(projectId)
  }

  const markAllAsRead = () => {
    const readIds = new Set(readState.ids)
    for (const notification of notifications) readIds.add(notification.id)
    setReadState({ ids: readIds, error: '' })
    try {
      saveReadNotificationIds('owner', [...readIds])
    } catch (error) {
      setReadState({
        ids: readIds,
        error: error instanceof Error ? `Could not save notification read status: ${error.message}` : 'Could not save notification read status.',
      })
    }
  }

  return <div className="notification-center" ref={container}>
    <button
      className={`icon-button notification-button ${unreadCount ? 'has-notifications' : ''}`}
      type="button"
      aria-label={`Notifications, ${countLabel}`}
      aria-expanded={isOpen}
      aria-controls="dashboard-notifications"
      title={countLabel}
      onClick={() => setIsOpen((open) => !open)}
    >
      <Bell size={17} />
      {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {isOpen && <section className="notification-panel" id="dashboard-notifications" aria-label="Project notifications">
      <div className="notification-panel-heading"><h2>Notifications</h2><div className="notification-panel-actions">{unreadCount > 0 && <button type="button" className="text-button notification-mark-all" onClick={markAllAsRead}>Mark all as read</button>}<button type="button" className="icon-button" aria-label="Close notifications" onClick={() => setIsOpen(false)}><X size={16} /></button></div></div>
      {readState.error && <p className="form-error" role="alert">{readState.error}</p>}
      {notifications.length ? <div className="notification-list">{notifications.map((notification) => {
        const isRead = readState.ids.has(notification.id)
        return <button
        type="button"
        className={`notification-row notification-${notification.priority} ${isRead ? 'notification-read' : ''}`}
        key={notification.id}
        onClick={() => openNotification(notification.id, notification.projectId)}
      >
        <span className="notification-icon">{notification.category === 'deadline' ? <CalendarDays size={16} /> : <CircleAlert size={16} />}</span>
        <span className="notification-copy"><strong>{notification.projectName} · {notification.title}</strong><small>{notification.detail}</small></span>
      </button>
      })}</div> : <div className="notification-empty"><Bell size={16} /><span>No financial alerts or approaching deadlines.</span></div>}
    </section>}
  </div>
}