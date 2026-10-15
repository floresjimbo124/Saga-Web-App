import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}))

import { loadProjectTaskActivity, loadTaskCommentNotifications, markTaskCommentNotificationsRead } from './tasks'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('task comment notifications', () => {
  it('loads activity rows with the comment author name returned by the permission-checked RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        id: 'activity-1',
        task_id: 'task-1',
        author_id: 'owner-1',
        author_name: 'Cathreen Trigo',
        activity_type: 'comment',
        body: 'Please review this update.',
        old_status: null,
        new_status: null,
        created_at: '2026-10-12T09:00:00Z',
      }],
      error: null,
    })

    await expect(loadProjectTaskActivity('task-1')).resolves.toEqual([{
      id: 'activity-1',
      taskId: 'task-1',
      authorId: 'owner-1',
      authorName: 'Cathreen Trigo',
      activityType: 'comment',
      body: 'Please review this update.',
      oldStatus: null,
      newStatus: null,
      createdAt: '2026-10-12T09:00:00Z',
    }])
    expect(mocks.rpc).toHaveBeenCalledWith('get_project_task_activity', { p_task_id: 'task-1' })
  })

  it('maps database notifications to the task workspace model', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        notification_id: 'notification-1',
        task_id: 'task-1',
        task_title: 'Prepare drawings',
        author_name: 'Cathreen Trigo',
        project_name: 'Salo Spot',
        created_at: '2026-10-12T09:00:00Z',
        read_at: null,
      }],
      error: null,
    })

    await expect(loadTaskCommentNotifications()).resolves.toEqual([{
      id: 'notification-1',
      taskId: 'task-1',
      taskTitle: 'Prepare drawings',
      authorName: 'Cathreen Trigo',
      projectName: 'Salo Spot',
      createdAt: '2026-10-12T09:00:00Z',
      readAt: null,
    }])
    expect(mocks.rpc).toHaveBeenCalledWith('get_project_task_comment_notifications')
  })

  it('marks an individual notification or the whole inbox as read', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await markTaskCommentNotificationsRead('notification-1')
    await markTaskCommentNotificationsRead()

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'mark_project_task_comment_notifications_read', {
      p_notification_id: 'notification-1',
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'mark_project_task_comment_notifications_read', {
      p_notification_id: null,
    })
  })

  it('surfaces database errors rather than silently dropping notifications', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Notification query failed.' } })

    await expect(loadTaskCommentNotifications()).rejects.toThrow('Notification query failed.')
  })
})
