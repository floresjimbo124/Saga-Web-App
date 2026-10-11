alter table public.project_change_orders
  add column order_number integer,
  add column pdf_storage_path text;

with numbered_orders as (
  select id, row_number() over (
    partition by project_id order by created_at, id
  )::integer as order_number
  from public.project_change_orders
)
update public.project_change_orders orders
set order_number = numbered_orders.order_number
from numbered_orders
where orders.id = numbered_orders.id;

alter table public.project_change_orders
  alter column order_number set not null;
create unique index project_change_orders_project_number_unique
  on public.project_change_orders (project_id, order_number);

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
          )
        )
      )
  );
end;
$$;

create or replace function public.create_project_change_order(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_amount numeric
)
returns table(id uuid, order_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  next_order_number integer;
  new_change_order_id uuid;
  normalized_title text := trim(coalesce(p_title, ''));
  normalized_description text := nullif(trim(coalesce(p_description, '')), '');
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select project.organization_id into project_organization_id
  from public.projects project
  where project.id = p_project_id
  for update;
  if project_organization_id is null then raise exception 'Project was not found.'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to add change orders to this project.';
  end if;
  if length(normalized_title) not between 2 and 150 then
    raise exception 'Title must contain between 2 and 150 characters.';
  end if;
  if length(coalesce(normalized_description, '')) > 2000 then
    raise exception 'Description must not exceed 2,000 characters.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'Change order amount must be greater than zero.';
  end if;

  select coalesce(max(change_order.order_number), 0) + 1
  into next_order_number
  from public.project_change_orders change_order
  where change_order.project_id = p_project_id;

  insert into public.project_change_orders (
    organization_id, project_id, order_number, title, description, amount, status, created_by
  ) values (
    project_organization_id, p_project_id, next_order_number, normalized_title,
    normalized_description, p_amount, 'draft', actor_id
  )
  returning project_change_orders.id into new_change_order_id;

  return query select new_change_order_id, next_order_number;
end;
$$;

revoke all on function public.create_project_change_order(uuid, text, text, numeric) from public;
grant execute on function public.create_project_change_order(uuid, text, text, numeric) to authenticated;

create or replace function public.submit_project_change_order(
  p_project_id uuid,
  p_change_order_id uuid,
  p_pdf_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row record;
  project_prefix text;
  expected_path text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to submit this change order.';
  end if;

  select change_order.id, change_order.organization_id, change_order.order_number,
         change_order.status, project.prefix as project_prefix
  into order_row
  from public.project_change_orders change_order
  join public.projects project on project.id = change_order.project_id
  where change_order.id = p_change_order_id and change_order.project_id = p_project_id
  for update of change_order;
  if not found then raise exception 'Change order was not found in this project.'; end if;
  if order_row.status <> 'draft' then raise exception 'This change order is no longer a draft.'; end if;

  expected_path := order_row.organization_id::text || '/' || p_project_id::text
    || '/change-orders/' || order_row.id::text || '/'
    || order_row.project_prefix || '-CO-' || lpad(order_row.order_number::text, 3, '0') || '.pdf';
  if p_pdf_storage_path is distinct from expected_path then
    raise exception 'The uploaded change-order PDF path is invalid.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'project-documents' and name = expected_path
  ) then
    raise exception 'Upload the change-order PDF before submitting it.';
  end if;

  update public.project_change_orders
  set status = 'pending_approval',
      pdf_storage_path = p_pdf_storage_path,
      updated_at = now()
  where id = p_change_order_id;
end;
$$;

revoke all on function public.submit_project_change_order(uuid, uuid, text) from public;
grant execute on function public.submit_project_change_order(uuid, uuid, text) to authenticated;

revoke all on function public.can_access_project_storage_object(text, boolean) from public;
grant execute on function public.can_access_project_storage_object(text, boolean) to authenticated;
