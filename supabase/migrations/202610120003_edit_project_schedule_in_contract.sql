alter table public.projects add column start_date date;

drop trigger if exists audit_project_deadline_change on public.projects;

create trigger audit_project_schedule_change
  after update of start_date, deadline on public.projects
  for each row
  when (old.start_date is distinct from new.start_date or old.deadline is distinct from new.deadline)
  execute function public.write_audit_log();

create function public.update_project_contract_schedule(
  p_project_id uuid,
  p_client_name text,
  p_contract_amount numeric,
  p_special_discount numeric,
  p_down_payment_percent numeric,
  p_retention_rate_percent numeric,
  p_retention_method public.retention_method,
  p_start_date date,
  p_deadline date
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
    raise exception 'Only an organization owner can update project contract and schedule details.';
  end if;
  if p_start_date is null then
    raise exception 'Project start date is required.';
  end if;
  if p_deadline is not null and p_deadline < p_start_date then
    raise exception 'Target date cannot be earlier than the project start date.';
  end if;

  perform public.update_project_setup(
    p_project_id,
    p_client_name,
    p_contract_amount,
    p_special_discount,
    p_down_payment_percent,
    p_retention_rate_percent,
    p_retention_method
  );

  update public.projects
  set start_date = p_start_date,
      deadline = p_deadline,
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.update_project_contract_schedule(
  uuid, text, numeric, numeric, numeric, numeric, public.retention_method, date, date
) from public;
grant execute on function public.update_project_contract_schedule(
  uuid, text, numeric, numeric, numeric, numeric, public.retention_method, date, date
) to authenticated;
