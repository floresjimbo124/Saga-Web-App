alter table public.organization_memberships
  add column staff_email text,
  add column staff_name text,
  add column staff_title text
    check (staff_title is null or staff_title in ('liaison_officer', 'engineer', 'architect'));

create unique index organization_memberships_one_staff_title_idx
  on public.organization_memberships (organization_id, staff_title)
  where role = 'site_staff' and staff_title is not null;

-- Designated team accounts use the task workspace, not legacy site-staff data access.
create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.org_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (p_roles)
      and not (membership.role = 'site_staff' and membership.staff_title is not null)
  );
$$;

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  assigned_to uuid references auth.users (id) on delete set null,
  title text not null check (length(trim(title)) between 2 and 160),
  description text not null default '' check (length(description) <= 4000),
  due_date date not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index project_tasks_owner_due_idx
  on public.project_tasks (organization_id, due_date, status);
create index project_tasks_assignee_due_idx
  on public.project_tasks (organization_id, assigned_to, due_date);

alter table public.project_tasks enable row level security;
grant select on public.project_tasks to authenticated;

create policy project_tasks_owner_or_assignee_read on public.project_tasks
  for select to authenticated
  using (
    public.has_org_role(organization_id, array['owner']::public.org_role[])
    or (
      assigned_to = (select auth.uid())
      and exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = project_tasks.organization_id
          and membership.user_id = (select auth.uid())
          and membership.role = 'site_staff'
          and membership.staff_title is not null
      )
    )
  );

create or replace function public.create_project_task(
  p_project_id uuid,
  p_assigned_to uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  task_organization_id uuid;
  task_id uuid;
  normalized_title text := trim(coalesce(p_title, ''));
  normalized_description text := trim(coalesce(p_description, ''));
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select project.organization_id into task_organization_id
  from public.projects project
  where project.id = p_project_id;
  if task_organization_id is null then raise exception 'Choose a valid project.'; end if;
  if not public.has_org_role(task_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only a workspace owner can create or assign tasks.';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = task_organization_id
      and membership.user_id = p_assigned_to
      and membership.role = 'site_staff'
      and membership.staff_title is not null
  ) then
    raise exception 'Assign the task to an active workspace staff member.';
  end if;
  if length(normalized_title) not between 2 and 160 then
    raise exception 'Task title must contain between 2 and 160 characters.';
  end if;
  if length(normalized_description) > 4000 then
    raise exception 'Task description must not exceed 4,000 characters.';
  end if;
  if p_due_date is null then raise exception 'A task deadline is required.'; end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high') then
    raise exception 'Choose a valid task priority.';
  end if;

  insert into public.project_tasks (
    organization_id, project_id, assigned_to, title, description, due_date,
    priority, created_by
  ) values (
    task_organization_id, p_project_id, p_assigned_to, normalized_title,
    normalized_description, p_due_date, p_priority, actor_id
  )
  returning id into task_id;
  return task_id;
end;
$$;

create or replace function public.update_project_task(
  p_task_id uuid,
  p_project_id uuid,
  p_assigned_to uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  task_organization_id uuid;
  normalized_title text := trim(coalesce(p_title, ''));
  normalized_description text := trim(coalesce(p_description, ''));
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select task.organization_id into task_organization_id
  from public.project_tasks task
  where task.id = p_task_id
  for update;
  if task_organization_id is null then raise exception 'Task was not found.'; end if;
  if not public.has_org_role(task_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only a workspace owner can edit task details.';
  end if;
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.organization_id = task_organization_id
  ) then
    raise exception 'Choose a valid project.';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = task_organization_id
      and membership.user_id = p_assigned_to
      and membership.role = 'site_staff'
      and membership.staff_title is not null
  ) then
    raise exception 'Assign the task to an active workspace staff member.';
  end if;
  if length(normalized_title) not between 2 and 160 then
    raise exception 'Task title must contain between 2 and 160 characters.';
  end if;
  if length(normalized_description) > 4000 then
    raise exception 'Task description must not exceed 4,000 characters.';
  end if;
  if p_due_date is null then raise exception 'A task deadline is required.'; end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high') then
    raise exception 'Choose a valid task priority.';
  end if;

  update public.project_tasks
  set project_id = p_project_id,
      assigned_to = p_assigned_to,
      title = normalized_title,
      description = normalized_description,
      due_date = p_due_date,
      priority = p_priority,
      updated_at = now()
  where id = p_task_id and organization_id = task_organization_id;
end;
$$;

create or replace function public.update_project_task_status(
  p_task_id uuid,
  p_status text
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
  is_owner boolean;
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  if p_status is null or p_status not in ('todo', 'in_progress', 'blocked', 'done') then
    raise exception 'Choose a valid task status.';
  end if;

  select task.organization_id, task.assigned_to
  into task_organization_id, task_assignee
  from public.project_tasks task
  where task.id = p_task_id
  for update;
  if task_organization_id is null then raise exception 'Task was not found.'; end if;
  is_owner := public.has_org_role(task_organization_id, array['owner']::public.org_role[]);
  if not is_owner then
    if task_assignee is distinct from actor_id or not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = task_organization_id
        and membership.user_id = actor_id
        and membership.role = 'site_staff'
        and membership.staff_title is not null
    ) then
      raise exception 'Only the assigned staff member or workspace owner can update this task.';
    end if;
  end if;

  update public.project_tasks
  set status = p_status, updated_at = now()
  where id = p_task_id and organization_id = task_organization_id;
end;
$$;

create or replace function public.delete_project_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_organization_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  select task.organization_id into task_organization_id
  from public.project_tasks task
  where task.id = p_task_id
  for update;
  if task_organization_id is null then raise exception 'Task was not found.'; end if;
  if not public.has_org_role(task_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only a workspace owner can delete tasks.';
  end if;
  delete from public.project_tasks
  where id = p_task_id and organization_id = task_organization_id;
end;
$$;

create or replace function public.get_project_task_workspace()
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  assigned_to uuid,
  title text,
  description text,
  due_date date,
  priority text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  task_organization_id uuid := '10000000-0000-4000-8000-000000000001';
  is_owner boolean;
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  is_owner := public.has_org_role(task_organization_id, array['owner']::public.org_role[]);
  if not is_owner and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = task_organization_id
      and membership.user_id = actor_id
      and membership.role = 'site_staff'
      and membership.staff_title is not null
  ) then
    raise exception 'Workspace staff access is required.';
  end if;

  return query
  select task.id, task.project_id, project.name, task.assigned_to, task.title,
    task.description, task.due_date, task.priority, task.status,
    task.created_at, task.updated_at
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id and project.organization_id = task.organization_id
  where task.organization_id = task_organization_id
    and (is_owner or task.assigned_to = actor_id)
  order by task.due_date asc, task.created_at desc;
end;
$$;

revoke all on function public.create_project_task(uuid, uuid, text, text, date, text) from public, anon;
revoke all on function public.update_project_task(uuid, uuid, uuid, text, text, date, text) from public, anon;
revoke all on function public.update_project_task_status(uuid, text) from public, anon;
revoke all on function public.delete_project_task(uuid) from public, anon;
revoke all on function public.get_project_task_workspace() from public, anon;
grant execute on function public.create_project_task(uuid, uuid, text, text, date, text) to authenticated;
grant execute on function public.update_project_task(uuid, uuid, uuid, text, text, date, text) to authenticated;
grant execute on function public.update_project_task_status(uuid, text) to authenticated;
grant execute on function public.delete_project_task(uuid) to authenticated;
grant execute on function public.get_project_task_workspace() to authenticated;

notify pgrst, 'reload schema';
