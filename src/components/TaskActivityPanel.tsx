import { useEffect, useState, type FormEvent } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { addProjectTaskComment, loadProjectTaskActivity, type ProjectTaskActivity, type TaskStatus } from '../data/tasks'
import { supabase } from '../lib/supabase'

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Complete',
}

function activityDescription(activity: ProjectTaskActivity) {
  if (activity.activityType === 'created') return 'Task created'
  if (activity.activityType === 'updated') return 'Task details updated'
  if (activity.activityType === 'status_changed') {
    const previous = activity.oldStatus ? statusLabels[activity.oldStatus] : 'Unknown'
    const next = activity.newStatus ? statusLabels[activity.newStatus] : 'Unknown'
    return `Status changed from ${previous} to ${next}`
  }
  return ''
}

function formatActivityTime(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function TaskActivityPanel({ taskId, currentUserId, staffNames }: {
  taskId: string
  currentUserId: string
  staffNames: ReadonlyMap<string, string>
}) {
  const [activities, setActivities] = useState<ProjectTaskActivity[]>([])
  const [comment, setComment] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPosting, setIsPosting] = useState(false)
  const [error, setError] = useState('')
  const [realtimeError, setRealtimeError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const load = async (showLoading = false) => {
      if (showLoading) setIsLoading(true)
      try {
        const nextActivities = await loadProjectTaskActivity(taskId)
        if (active) {
          setActivities(nextActivities)
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load task activity.')
      } finally {
        if (active && showLoading) setIsLoading(false)
      }
    }

    void load(true)
    const client = supabase
    const channel = client?.channel(`project-task-activity:${taskId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'project_task_activity',
        filter: `task_id=eq.${taskId}`,
      }, () => { void load() })
      .subscribe((status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') setRealtimeError('')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeError('Live activity updates are unavailable. Close and reopen task details to refresh.')
        }
      })

    return () => {
      active = false
      if (channel && client) void client.removeChannel(channel)
    }
  }, [taskId, reloadKey])

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setRealtimeError('')
    setIsPosting(true)
    try {
      await addProjectTaskComment(taskId, comment)
      setComment('')
      setReloadKey((key) => key + 1)
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'Could not post the comment.')
    } finally {
      setIsPosting(false)
    }
  }

  const authorName = (authorId: string | null) => {
    if (!authorId) return 'Former member'
    return staffNames.get(authorId) ?? activities.find((activity) => activity.authorId === authorId)?.authorName ?? (authorId === currentUserId ? 'You' : 'Workspace member')
  }

  return <section className="task-activity-panel" aria-labelledby="task-activity-title">
    <div className="task-activity-heading">
      <h3 id="task-activity-title"><MessageCircle size={15} />Updates & comments</h3>
    </div>
    {error && <p className="form-error task-activity-error" role="alert">{error}</p>}
    {realtimeError && <p className="task-activity-live-error" role="status">{realtimeError}</p>}
    {isLoading ? <p className="task-activity-loading" role="status">Loading task activity…</p>
      : activities.length ? <ol className="task-activity-list">
        {activities.map((activity) => <li className={`task-activity-item ${activity.activityType === 'comment' ? 'is-comment' : ''}`} key={activity.id}>
          <div className="task-activity-meta">
            <strong>{authorName(activity.authorId)}</strong>
            <time dateTime={activity.createdAt}>{formatActivityTime(activity.createdAt)}</time>
          </div>
          {activity.activityType === 'comment'
            ? <p>{activity.body}</p>
            : <p>{activityDescription(activity)}</p>}
        </li>)}
      </ol> : <p className="task-activity-empty">No updates yet. Add a comment to start the conversation.</p>}
    <form className="task-comment-form" onSubmit={submitComment}>
      <label className="sr-only" htmlFor={`task-comment-${taskId}`}>Write a comment</label>
      <textarea
        id={`task-comment-${taskId}`}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={2000}
        placeholder="Write a comment…"
        required
      />
      <div className="task-comment-actions">
        <small>{comment.length}/2,000</small>
        <button type="submit" className="button button-primary" disabled={isPosting || !comment.trim()}>
          <Send size={14} />{isPosting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </form>
  </section>
}
