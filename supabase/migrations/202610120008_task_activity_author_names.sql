create or replace function public.get_project_task_activity(p_task_id uuid)
returns table (
  id uuid,
  task_id uuid,
  author_id uuid,
  author_name text,
  activity_type text,
  body text,
  old_status text,
  new_status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.project_tasks task
    where task.id = p_task_id
      and (
        public.has_org_role(task.organization_id, array['owner']::public.org_role[])
        or (
          task.assigned_to = actor_id
          and exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = task.organization_id
              and membership.user_id = actor_id
              and membership.role = 'site_staff'
              and membership.staff_title is not null
          )
        )
      )
  ) then
    raise exception 'You do not have access to this task activity.';
  end if;

  return query
  select
    activity.id,
    activity.task_id,
    activity.author_id,
    coalesce(
      nullif(trim(profile.display_name), ''),
      nullif(trim(concat_ws(
        ' ',
        nullif(activity_author.raw_user_meta_data->>'first_name', ''),
        nullif(activity_author.raw_user_meta_data->>'last_name', '')
      )), ''),
      nullif(trim(activity_author.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(activity_author.email, ''), '@', 1), ''),
      'Former member'
    ),
    activity.activity_type,
    activity.body,
    activity.old_status,
    activity.new_status,
    activity.created_at
  from public.project_task_activity activity
  left join auth.users activity_author on activity_author.id = activity.author_id
  left join public.profiles profile on profile.id = activity.author_id
  where activity.task_id = p_task_id
  order by activity.created_at asc;
end;
$$;

revoke all on function public.get_project_task_activity(uuid) from public, anon;
grant execute on function public.get_project_task_activity(uuid) to authenticated;

notify pgrst, 'reload schema';
