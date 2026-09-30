create or replace function public.update_project_setup(
  p_project_id uuid,
  p_client_name text,
  p_contract_amount numeric,
  p_special_discount numeric,
  p_down_payment_percent numeric,
  p_retention_rate_percent numeric,
  p_retention_method public.retention_method
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  new_client_id uuid;
  normalized_client_name text := trim(coalesce(p_client_name, ''));
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
    raise exception 'Only an organization owner can update project financial terms.';
  end if;
  if length(normalized_client_name) < 2 then
    raise exception 'Client name must contain at least two characters.';
  end if;
  if p_contract_amount is null or p_contract_amount <= 0 then
    raise exception 'Contract amount must be greater than zero.';
  end if;
  if p_special_discount is null or p_special_discount < 0 or p_special_discount > p_contract_amount then
    raise exception 'Special discount must be between zero and the contract amount.';
  end if;
  if p_down_payment_percent is null or p_down_payment_percent not between 0 and 100 then
    raise exception 'Down payment percentage must be between 0 and 100.';
  end if;
  if p_retention_rate_percent is null or p_retention_rate_percent not between 0 and 100 then
    raise exception 'Retention percentage must be between 0 and 100.';
  end if;
  if p_retention_method is null then
    raise exception 'Retention method is required.';
  end if;

  insert into public.clients (organization_id, name, created_by)
  values (project_organization_id, normalized_client_name, actor_id)
  on conflict do nothing
  returning id into new_client_id;

  if new_client_id is null then
    select c.id into new_client_id
    from public.clients c
    where c.organization_id = project_organization_id
      and lower(c.name) = lower(normalized_client_name)
    limit 1;
  end if;

  update public.projects
  set client_id = new_client_id,
      updated_at = now()
  where id = p_project_id;

  insert into public.project_financial_terms (
    project_id, organization_id, contract_amount, special_discount,
    down_payment_percent, retention_rate_percent, retention_method
  ) values (
    p_project_id, project_organization_id, p_contract_amount, p_special_discount,
    p_down_payment_percent, p_retention_rate_percent, p_retention_method
  )
  on conflict (project_id) do update
  set contract_amount = excluded.contract_amount,
      special_discount = excluded.special_discount,
      down_payment_percent = excluded.down_payment_percent,
      retention_rate_percent = excluded.retention_rate_percent,
      retention_method = excluded.retention_method,
      updated_at = now();
end;
$$;

revoke all on function public.update_project_setup(uuid, text, numeric, numeric, numeric, numeric, public.retention_method) from public;
grant execute on function public.update_project_setup(uuid, text, numeric, numeric, numeric, numeric, public.retention_method) to authenticated;