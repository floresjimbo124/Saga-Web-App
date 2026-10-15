import { useEffect, useId, useRef, useState } from 'react'
import { Bell, CalendarDays, CircleAlert, MessageCircle, X } from 'lucide-react'
import { loadReadNotificationIds, saveReadNotificationIds } from '../auth/notification-read-state'
import type { PortfolioProject } from '../data/portfolio'
import { loadTaskCommentNotifications, markTaskCommentNotificationsRead, type TaskCommentNotification } from '../data/tasks'
import { supabase } from '../lib/supabase'
import type { ReceivableAgingItem } from '../finance/receivables-aging'
import { buildDashboardNotifications } from '../finance/dashboard-notifications'

export function NotificationCenter({ projects, receivables, onOpenProject, onOpenTask }: {
  projects: PortfolioProject[]
  receivables: ReceivableAgingItem[]
  onOpenProject: (projectId: string) => void
  onOpenTask?: (taskId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [commentNotifications, setCommentNotifications] = useState<TaskCommentNotification[]>([])
  const [commentError, setCommentError] = useState(() => supabase ? '' : 'Supabase is not configured.')
  const [userId, setUserId] = useState('')
  const [isMarkingRead, setIsMarkingRead] = useState(false)
  const instanceId = useId().replace(/:/g, '')
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
    + commentNotifications.filter((notification) => !notification.readAt).length

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) throw error
      if (!data.user) throw new Error('Sign in to view task comment notifications.')
      if (active) setUserId(data.user.id)
    }).catch((error: unknown) => {
      if (active) setCommentError(error instanceof Error ? error.message : 'Could not verify the signed-in account.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabase || !userId) return
    let active = true
    const client = supabase
    const refresh = () => {
      void loadTaskCommentNotifications().then((nextNotifications) => {
        if (!active) return
        setCommentNotifications(nextNotifications)
        setCommentError('')
      }).catch((error: unknown) => {
        if (active) setCommentError(error instanceof Error ? error.message : 'Could not load task comment notifications.')
      })
    }
    refresh()
    const channel = client
      .channel(`portfolio-notifications:${userId}:${instanceId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'project_task_comment_notifications',
        filter: `recipient_user_id=eq.${userId}`,
      }, refresh)
      .subscribe((status) => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setCommentError('Live task comment notifications are unavailable. Open Notifications to refresh.')
        }
      })
    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [instanceId, userId])

  useEffect(() => {
    if (!isOpen) return
    document.body.classList.add('has-open-notifications')
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
      document.body.classList.remove('has-open-notifications')
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

  const openTaskNotification = async (notification: TaskCommentNotification) => {
    try {
      await markTaskCommentNotificationsRead(notification.id)
      setCommentNotifications((current) => current.map((item) => item.id === notification.id
        ? { ...item, readAt: new Date().toISOString() }
        : item))
      setCommentError('')
      setIsOpen(false)
      onOpenTask?.(notification.taskId)
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Could not mark the task notification as read.')
    }
  }

  const markAllAsRead = async () => {
    setIsMarkingRead(true)
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
    try {
      if (commentNotifications.some((notification) => !notification.readAt)) {
        await markTaskCommentNotificationsRead()
        const readAt = new Date().toISOString()
        setCommentNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })))
      }
      setCommentError('')
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Could not mark task notifications as read.')
    } finally {
      setIsMarkingRead(false)
    }
  }

  return <div className="notification-center" ref={container}>
    <button
      className={`icon-button notification-button ${unreadCount ? 'has-notifications' : ''}`}
      type="button"
      aria-label={`Notifications, ${countLabel}`}
      aria-expanded={isOpen}
      aria-controls={`dashboard-notifications-${instanceId}`}
      title={countLabel}
      onClick={() => {
        const shouldOpen = !isOpen
        setIsOpen(shouldOpen)
        if (shouldOpen && userId) {
          void loadTaskCommentNotifications().then((nextNotifications) => {
            setCommentNotifications(nextNotifications)
            setCommentError('')
          }).catch((error: unknown) => {
            setCommentError(error instanceof Error ? error.message : 'Could not load task comment notifications.')
          })
        }
      }}
    >
      <Bell size={17} />
      {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {isOpen && <section className="notification-panel" id={`dashboard-notifications-${instanceId}`} aria-label="Notifications">
      <div className="notification-panel-heading">
        <h2>Notifications</h2>
        <div className="notification-panel-actions">
          {unreadCount > 0 && <button type="button" className="text-button notification-mark-all" disabled={isMarkingRead} onClick={() => void markAllAsRead()}>Mark all as read</button>}
          <button type="button" className="icon-button" aria-label="Close notifications" onClick={() => setIsOpen(false)}><X size={17} /></button>
        </div>
      </div>
      {readState.error && <p className="form-error" role="alert">{readState.error}</p>}
      {commentError && <div className="form-error" role="alert">
        <span>{commentError}</span>
        <button type="button" className="text-button" onClick={() => {
          void loadTaskCommentNotifications().then((nextNotifications) => {
            setCommentNotifications(nextNotifications)
            setCommentError('')
          }).catch((error: unknown) => setCommentError(error instanceof Error ? error.message : 'Could not load task comment notifications.'))
        }}>Retry</button>
      </div>}
      {notifications.length || commentNotifications.length ? <div className="notification-list">
        {commentNotifications.map((notification) => <button
          type="button"
          className={`notification-row notification-task-comment ${notification.readAt ? 'notification-read' : ''}`}
          key={notification.id}
          onClick={() => void openTaskNotification(notification)}
        >
          <span className="notification-icon"><MessageCircle size={16} /></span>
          <span className="notification-copy">
            <strong>{notification.authorName} made a comment on {notification.taskTitle}</strong>
            <small>{notification.projectName} - {new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(notification.createdAt))}</small>
          </span>
        </button>)}
        {notifications.map((notification) => {
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
      })}</div> : <div className="notification-empty"><Bell size={16} /><span>No project or task notifications right now.</span></div>}
    </section>}
  </div>
}