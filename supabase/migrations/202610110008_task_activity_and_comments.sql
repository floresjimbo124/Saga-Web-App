create table public.project_task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  activity_type text not null
    check (activity_type in ('created', 'updated', 'status_changed', 'comment')),
  body text,
  old_status text check (old_status is null or old_status in ('todo', 'in_progress', 'blocked', 'done')),
  new_status text check (new_status is null or new_status in ('todo', 'in_progress', 'blocked', 'done')),
  created_at timestamptz not null default now(),
  check (activity_type <> 'comment' or (body is not null and length(trim(body)) between 1 and 2000))
);

create index project_task_activity_task_created_idx
  on public.project_task_activity (task_id, created_at);

alter table public.project_task_activity enable row level security;
grant select on public.project_task_activity to authenticated;
revoke insert, update, delete on public.project_task_activity from public, anon, authenticated;

create policy project_task_activity_owner_or_assignee_read
  on public.project_task_activity
  for select to authenticated
  using (
    exists (
      select 1
      from public.project_tasks task
      where task.id = project_task_activity.task_id
        and (
          public.has_org_role(task.organization_id, array['owner']::public.org_role[])
          or (
            task.assigned_to = (select auth.uid())
            and exists (
              select 1
              from public.organization_memberships membership
              where membership.organization_id = task.organization_id
                and membership.user_id = (select auth.uid())
                and membership.role = 'site_staff'
                and membership.staff_title is not null
            )
          )
        )
    )
  );

create or replace function public.log_project_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_task_activity (task_id, author_id, activity_type)
    values (new.id, (select auth.uid()), 'created');
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.project_task_activity (
      task_id, author_id, activity_type, old_status, new_status
    ) values (
      new.id, (select auth.uid()), 'status_changed', old.status, new.status
    );
  end if;

  if row(new.project_id, new.assigned_to, new.title, new.description, new.due_date, new.priority)
    is distinct from row(old.project_id, old.assigned_to, old.title, old.description, old.due_date, old.priority) then
    insert into public.project_task_activity (task_id, author_id, activity_type)
    values (new.id, (select auth.uid()), 'updated');
  end if;

  return new;
end;
$$;

create trigger project_tasks_activity_log
  after insert or update on public.project_tasks
  for each row execute function public.log_project_task_activity();

create or replace function public.add_project_task_comment(
  p_task_id uuid,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  task_organization_id uuid;
  task_assignee uuid;
  normalized_body text := trim(coalesce(p_body, ''));
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  if length(normalized_body) not between 1 and 2000 then
    raise exception 'Comments must contain between 1 and 2,000 characters.';
  end if;

  select task.organization_id, task.assigned_to
  into task_organization_id, task_assignee
  from public.project_tasks task
  where task.id = p_task_id;
  if task_organization_id is null then raise exception 'Task was not found.'; end if;

  if not public.has_org_role(task_organization_id, array['owner']::public.org_role[])
    and (
      task_assignee is distinct from actor_id
      or not exists (
        select 1
        from public.organization_memberships membership
        where membership.organization_id = task_organization_id
          and membership.user_id = actor_id
          and membership.role = 'site_staff'
          and membership.staff_title is not null
      )
    ) then
    raise exception 'Only the assigned staff member or workspace owner can comment on this task.';
  end if;

  insert into public.project_task_activity (task_id, author_id, activity_type, body)
  values (p_task_id, actor_id, 'comment', normalized_body);
end;
$$;

revoke all on function public.add_project_task_comment(uuid, text) from public, anon;
grant execute on function public.add_project_task_comment(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_task_activity'
    ) then
    alter publication supabase_realtime add table public.project_task_activity;
  end if;
end;
$$;

notify pgrst, 'reload schema';
