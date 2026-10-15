drop function public.get_project_task_comment_notifications();

create function public.get_project_task_comment_notifications()
returns table (
  notification_id uuid,
  task_id uuid,
  task_title text,
  author_name text,
  project_name text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.id,
    notification.task_id,
    task.title,
    coalesce(
      nullif(trim(profile.display_name), ''),
      nullif(trim(concat_ws(
        ' ',
        nullif(activity_author.raw_user_meta_data->>'first_name', ''),
        nullif(activity_author.raw_user_meta_data->>'last_name', '')
      )), ''),
      nullif(trim(activity_author.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(activity_author.email, ''), '@', 1), ''),
      'A team member'
    ),
    project.name,
    notification.created_at,
    notification.read_at
  from public.project_task_comment_notifications notification
  join public.project_task_activity activity on activity.id = notification.activity_id
  join public.project_tasks task on task.id = notification.task_id
  join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  left join auth.users activity_author on activity_author.id = activity.author_id
  left join public.profiles profile on profile.id = activity.author_id
  where notification.recipient_user_id = (select auth.uid())
  order by notification.created_at desc
  limit 50;
$$;

revoke all on function public.get_project_task_comment_notifications() from public, anon;
grant execute on function public.get_project_task_comment_notifications() to authenticated;

notify pgrst, 'reload schema';
