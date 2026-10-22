-- Architects get the same project access as liaison officers and engineers (view + add, no edits).

CREATE OR REPLACE FUNCTION public.is_project_staff(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.project_staff_access access
    join public.projects project on project.id = access.project_id and project.organization_id = access.organization_id
    join public.organization_memberships membership
      on membership.organization_id = access.organization_id
     and membership.user_id = access.user_id
    where access.project_id = p_project_id
      and access.user_id = (select auth.uid())
      and membership.role = 'site_staff'
      and membership.staff_title in ('liaison_officer', 'engineer', 'architect')
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_project_staff_access(p_user_id uuid, p_project_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org_id uuid := '10000000-0000-4000-8000-000000000001';
begin
  if not public.has_org_role(org_id, array['owner']::public.org_role[]) then
    raise exception 'Only a workspace owner can change project access.';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = org_id and membership.user_id = p_user_id
      and membership.role = 'site_staff' and membership.staff_title in ('liaison_officer', 'engineer', 'architect')
  ) then
    raise exception 'Project access can only be given to the liaison officer, engineer or architect.';
  end if;
  if exists (select 1 from unnest(coalesce(p_project_ids, '{}')) as requested(id)
             where not exists (select 1 from public.projects project where project.id = requested.id and project.organization_id = org_id)) then
    raise exception 'One of the selected projects was not found.';
  end if;
  delete from public.project_staff_access access
  where access.organization_id = org_id and access.user_id = p_user_id
    and not (access.project_id = any (coalesce(p_project_ids, '{}')));
  insert into public.project_staff_access (organization_id, project_id, user_id)
  select org_id, requested.id, p_user_id from unnest(coalesce(p_project_ids, '{}')) as requested(id)
  on conflict (project_id, user_id) do nothing;
end;
$function$;
