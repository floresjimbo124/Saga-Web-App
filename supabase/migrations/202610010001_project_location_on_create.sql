drop function public.create_project_with_terms(
  uuid, text, text, text, numeric, numeric, numeric, public.retention_method
);

create function public.create_project_with_terms(
  p_organization_id uuid,
  p_project_name text,
  p_client_name text,
  p_prefix text,
  p_contract_amount numeric,
  p_down_payment_percent numeric default 0,
  p_retention_rate_percent numeric default 5,
  p_retention_method public.retention_method default 'final_schedule',
  p_location text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  client_id uuid;
  project_id uuid;
  normalized_project_name text := trim(coalesce(p_project_name, ''));
  normalized_client_name text := trim(coalesce(p_client_name, ''));
  normalized_prefix text := upper(trim(coalesce(p_prefix, '')));
  normalized_location text := trim(coalesce(p_location, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.has_org_role(
    p_organization_id,
    array['owner', 'site_staff']::public.org_role[]
  ) then
    raise exception 'You do not have permission to create projects in this organization.';
  end if;
  if length(normalized_project_name) < 2 then
    raise exception 'Project name must contain at least two characters.';
  end if;
  if length(normalized_client_name) < 2 then
    raise exception 'Client name must contain at least two characters.';
  end if;
  if length(normalized_location) < 2 or length(normalized_location) > 200 then
    raise exception 'Project location must contain between 2 and 200 characters.';
  end if;
  if normalized_prefix !~ '^[A-Z]{3}$' then
    raise exception 'Project receipt prefix must contain exactly three letters.';
  end if;
  if p_contract_amount is null or p_contract_amount <= 0 then
    raise exception 'Contract amount must be greater than zero.';
  end if;
  if p_down_payment_percent is null or p_down_payment_percent not between 0 and 100 then
    raise exception 'Down payment percentage must be between 0 and 100.';
  end if;
  if p_retention_rate_percent is null or p_retention_rate_percent not between 0 and 100 then
    raise exception 'Retention percentage must be between 0 and 100.';
  end if;

  insert into public.clients (organization_id, name, created_by)
  values (p_organization_id, normalized_client_name, actor_id)
  on conflict do nothing
  returning id into client_id;

  if client_id is null then
    select c.id into client_id
    from public.clients c
    where c.organization_id = p_organization_id
      and lower(c.name) = lower(normalized_client_name)
    limit 1;
  end if;

  if exists (
    select 1 from public.projects p
    where p.organization_id = p_organization_id
      and p.prefix = normalized_prefix
  ) then
    raise exception 'Receipt prefix % is already in use in this organization.', normalized_prefix;
  end if;

  insert into public.projects (
    organization_id, client_id, name, prefix, location, status, progress_percent, created_by
  ) values (
    p_organization_id, client_id, normalized_project_name, normalized_prefix,
    normalized_location, 'planning', 0, actor_id
  )
  returning id into project_id;

  insert into public.project_financial_terms (
    project_id, organization_id, contract_amount, down_payment_percent,
    retention_rate_percent, retention_method
  ) values (
    project_id, p_organization_id, p_contract_amount, p_down_payment_percent,
    p_retention_rate_percent, p_retention_method
  );

  return project_id;
end;
$$;

revoke all on function public.create_project_with_terms(
  uuid, text, text, text, numeric, numeric, numeric, public.retention_method, text
) from public;
grant execute on function public.create_project_with_terms(
  uuid, text, text, text, numeric, numeric, numeric, public.retention_method, text
) to authenticated;