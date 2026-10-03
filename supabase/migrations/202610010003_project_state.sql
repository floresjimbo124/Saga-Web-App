alter table public.projects
  add column health_status text not null default 'on_track'
    check (health_status in ('on_track', 'needs_attention'));

create or replace function public.update_project_state(
  p_project_id uuid,
  p_status text,
  p_health_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  select p.organization_id into project_organization_id
  from public.projects p
  where p.id = p_project_id;

  if project_organization_id is null then
    raise exception 'Project was not found.';
  end if;
  if not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an organization owner can update project status.';
  end if;
  if p_status is null or p_status not in ('planning', 'active', 'on_hold', 'completed', 'closed') then
    raise exception 'Project status is invalid.';
  end if;
  if p_health_status is null or p_health_status not in ('on_track', 'needs_attention') then
    raise exception 'Project health status is invalid.';
  end if;

  update public.projects
  set status = p_status,
      health_status = p_health_status,
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.update_project_state(uuid, text, text) from public;
grant execute on function public.update_project_state(uuid, text, text) to authenticated;