alter table public.project_milestones
  add column photo_storage_path text;

create or replace function public.can_access_project_storage_object(
  p_object_name text,
  p_client_visible_only boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[];
  path_organization_id uuid;
  path_project_id uuid;
begin
  path_parts := string_to_array(p_object_name, '/');
  if coalesce(array_length(path_parts, 1), 0) < 3 then return false; end if;

  begin
    path_organization_id := path_parts[1]::uuid;
    path_project_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1
    from public.projects project
    where project.id = path_project_id
      and project.organization_id = path_organization_id
      and (
        public.has_org_role(project.organization_id, array['owner', 'site_staff']::public.org_role[])
        or (
          p_client_visible_only
          and public.can_access_project(project.id)
          and (
            exists (
              select 1
              from public.project_documents document
              where document.project_id = project.id
                and document.organization_id = project.organization_id
                and document.storage_path = p_object_name
                and document.client_visible
            )
            or exists (
              select 1
              from public.project_change_orders change_order
              where change_order.project_id = project.id
                and change_order.organization_id = project.organization_id
                and change_order.pdf_storage_path = p_object_name
                and change_order.status in ('pending_approval', 'approved')
            )
            or exists (
              select 1
              from public.project_milestones milestone
              where milestone.project_id = project.id
                and milestone.organization_id = project.organization_id
                and milestone.photo_storage_path = p_object_name
                and milestone.status = 'complete'
                and milestone.client_visible
            )
          )
        )
      )
  );
end;
$$;

notify pgrst, 'reload schema';
