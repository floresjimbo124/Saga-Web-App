create table public.project_task_comment_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.project_tasks (id) on delete cascade,
  activity_id uuid not null references public.project_task_activity (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_user_id, activity_id)
);

create index project_task_comment_notifications_recipient_created_idx
  on public.project_task_comment_notifications (recipient_user_id, created_at desc);

alter table public.project_task_comment_notifications enable row level security;
grant select on public.project_task_comment_notifications to authenticated;
revoke insert, update, delete on public.project_task_comment_notifications from public, anon, authenticated;

create policy project_task_comment_notifications_recipient_read
  on public.project_task_comment_notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()));

create or replace function public.notify_project_task_comment_recipients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activity_type <> 'comment' then return new; end if;

  insert into public.project_task_comment_notifications (recipient_user_id, task_id, activity_id)
  select recipient.user_id, new.task_id, new.id
  from (
    select membership.user_id
    from public.project_tasks task
    join public.organization_memberships membership
      on membership.organization_id = task.organization_id
    where task.id = new.task_id
      and membership.role = 'owner'
      and membership.user_id is distinct from new.author_id

    union

    select task.assigned_to
    from public.project_tasks task
    where task.id = new.task_id
      and task.assigned_to is not null
      and task.assigned_to is distinct from new.author_id
  ) recipient
  on conflict (recipient_user_id, activity_id) do nothing;

  return new;
end;
$$;

create trigger project_task_activity_notify_comment_recipients
  after insert on public.project_task_activity
  for each row execute function public.notify_project_task_comment_recipients();

create or replace function public.remove_unassigned_task_comment_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.assigned_to is not distinct from new.assigned_to then return new; end if;

  delete from public.project_task_comment_notifications notification
  where notification.task_id = new.id
    and notification.recipient_user_id is distinct from new.assigned_to
    and not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = new.organization_id
        and membership.user_id = notification.recipient_user_id
        and membership.role = 'owner'
    );

  return new;
end;
$$;

create trigger project_tasks_cleanup_comment_notifications
  after update of assigned_to on public.project_tasks
  for each row execute function public.remove_unassigned_task_comment_notifications();

create or replace function public.get_project_task_comment_notifications()
returns table (
  notification_id uuid,
  task_id uuid,
  task_title text,
  project_name text,
  comment text,
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
    project.name,
    activity.body,
    notification.created_at,
    notification.read_at
  from public.project_task_comment_notifications notification
  join public.project_task_activity activity on activity.id = notification.activity_id
  join public.project_tasks task on task.id = notification.task_id
  join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  where notification.recipient_user_id = (select auth.uid())
  order by notification.created_at desc
  limit 50;
$$;

create or replace function public.mark_project_task_comment_notifications_read(
  p_notification_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;

  update public.project_task_comment_notifications
  set read_at = coalesce(read_at, now())
  where recipient_user_id = actor_id
    and (p_notification_id is null or id = p_notification_id);

  if p_notification_id is not null and not found then
    raise exception 'Comment notification was not found.';
  end if;
end;
$$;

revoke all on function public.notify_project_task_comment_recipients() from public, anon, authenticated;
revoke all on function public.remove_unassigned_task_comment_notifications() from public, anon, authenticated;
revoke all on function public.get_project_task_comment_notifications() from public, anon;
revoke all on function public.mark_project_task_comment_notifications_read(uuid) from public, anon;
grant execute on function public.get_project_task_comment_notifications() to authenticated;
grant execute on function public.mark_project_task_comment_notifications_read(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_task_comment_notifications'
    ) then
    alter publication supabase_realtime add table public.project_task_comment_notifications;
  end if;
end;
$$;

notify pgrst, 'reload schema';
