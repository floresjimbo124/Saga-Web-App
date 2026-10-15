import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import {
  loadTaskCommentNotifications,
  markTaskCommentNotificationsRead,
  type TaskCommentNotification,
} from '../data/tasks'
import { supabase } from '../lib/supabase'

function describeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function TaskCommentNotificationBell({ onOpenTask }: {
  onOpenTask: (taskId: string) => void
}) {
  const [userId, setUserId] = useState('')
  const [notifications, setNotifications] = useState<TaskCommentNotification[]>([])
  const [error, setError] = useState(() => supabase ? '' : 'Supabase is not configured.')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(() => Boolean(supabase))
  const [workingId, setWorkingId] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const unreadCount = notifications.filter((notification) => !notification.readAt).length

  useEffect(() => {
    if (!supabase) return

    let active = true
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return
      if (authError) throw authError
      if (!data.user) throw new Error('Sign in to view task notifications.')
      setUserId(data.user.id)
      setIsLoading(false)
    }).catch((authError: unknown) => {
      if (!active) return
      setError(describeError(authError, 'Could not verify the signed-in account.'))
      setIsLoading(false)
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
        setNotifications(nextNotifications)
        setError('')
      }).catch((loadError: unknown) => {
        if (active) setError(describeError(loadError, 'Could not load task notifications.'))
      }).finally(() => {
        if (active) setIsLoading(false)
      })
    }

    refresh()
    const channel = client
      .channel(`task-comment-notifications:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'project_task_comment_notifications',
        filter: `recipient_user_id=eq.${userId}`,
      }, refresh)
      .subscribe((status) => {
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live comment notifications are unavailable. Reopen this panel to refresh.')
        }
      })

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [userId])

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

  const markAllAsRead = async () => {
    setWorkingId('all')
    try {
      await markTaskCommentNotificationsRead()
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })))
      setError('')
    } catch (markError) {
      setError(describeError(markError, 'Could not mark notifications as read.'))
    } finally {
      setWorkingId('')
    }
  }

  const openNotification = async (notification: TaskCommentNotification) => {
    setWorkingId(notification.id)
    try {
      if (!notification.readAt) {
        await markTaskCommentNotificationsRead(notification.id)
        setNotifications((current) => current.map((item) => item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() }
          : item))
      }
      setError('')
      setIsOpen(false)
      onOpenTask(notification.taskId)
    } catch (markError) {
      setError(describeError(markError, 'Could not mark the notification as read.'))
    } finally {
      setWorkingId('')
    }
  }

  const countLabel = unreadCount === 1 ? '1 unread comment' : `${unreadCount} unread comments`

  return <div className="task-notification-center" ref={container}>
    <button
      className={`icon-button task-notification-button ${unreadCount ? 'has-notifications' : ''}`}
      type="button"
      aria-label={`Comment notifications, ${countLabel}`}
      aria-expanded={isOpen}
      aria-controls="task-comment-notifications"
      title={countLabel}
      onClick={() => {
        const shouldOpen = !isOpen
        setIsOpen(shouldOpen)
        if (shouldOpen && userId) {
          setIsLoading(true)
          void loadTaskCommentNotifications().then((nextNotifications) => {
            setNotifications(nextNotifications)
            setError('')
          }).catch((loadError: unknown) => {
            setError(describeError(loadError, 'Could not load task notifications.'))
          }).finally(() => setIsLoading(false))
        }
      }}
    >
      <MessageCircle size={17} />
      {unreadCount > 0 && <span className="task-notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {isOpen && <section className="task-notification-panel" id="task-comment-notifications" aria-label="Comment notifications">
      <div className="task-notification-heading">
        <h2>Task comments</h2>
        <div>
          {unreadCount > 0 && <button type="button" className="text-button" disabled={workingId !== ''} onClick={() => void markAllAsRead()}>Mark all as read</button>}
          <button type="button" className="icon-button" aria-label="Close comment notifications" onClick={() => setIsOpen(false)}><X size={16} /></button>
        </div>
      </div>
      {error && <div className="form-error" role="alert">
        <span>{error}</span>
        {!notifications.length && <button type="button" className="text-button" onClick={() => {
          setIsLoading(true)
          void loadTaskCommentNotifications().then((nextNotifications) => {
            setNotifications(nextNotifications)
            setError('')
          }).catch((loadError: unknown) => {
            setError(describeError(loadError, 'Could not load task notifications.'))
          }).finally(() => setIsLoading(false))
        }}>Retry</button>}
      </div>}
      {isLoading ? <p className="task-notification-empty" role="status">Loading comments…</p>
        : notifications.length ? <div className="task-notification-list">{notifications.map((notification) => (
          <button
            type="button"
            className={`task-notification-row task-comment-notification-row ${notification.readAt ? 'is-read' : ''}`}
            key={notification.id}
            disabled={workingId !== ''}
            onClick={() => void openNotification(notification)}
          >
            <span className="task-notification-icon"><MessageCircle size={16} /></span>
            <span className="task-notification-copy">
              <strong>{notification.authorName} made a comment on {notification.taskTitle}</strong>
              <small>{notification.projectName} - {new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(notification.createdAt))}</small>
            </span>
          </button>
        ))}</div> : error ? null : <p className="task-notification-empty">No task comments yet.</p>}
    </section>}
  </div>
}
