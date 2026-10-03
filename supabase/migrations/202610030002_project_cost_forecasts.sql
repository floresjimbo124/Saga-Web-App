create table public.project_cost_forecasts (
  project_id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cost_budget numeric(14, 2) not null check (cost_budget >= 0),
  estimated_cost_to_complete numeric(14, 2) not null check (estimated_cost_to_complete >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

alter table public.project_cost_forecasts enable row level security;

create policy project_cost_forecasts_owner_manage on public.project_cost_forecasts
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create trigger audit_project_cost_forecasts
  after insert or update or delete on public.project_cost_forecasts
  for each row execute function public.write_audit_log();

create or replace function public.update_project_cost_forecast(
  p_project_id uuid,
  p_cost_budget numeric,
  p_estimated_cost_to_complete numeric
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
    raise exception 'Only an owner can update the project cost forecast.';
  end if;
  if p_cost_budget is null or p_cost_budget < 0 or p_cost_budget = 'NaN'::numeric then
    raise exception 'Cost budget must be a non-negative amount.';
  end if;
  if p_estimated_cost_to_complete is null
    or p_estimated_cost_to_complete < 0
    or p_estimated_cost_to_complete = 'NaN'::numeric then
    raise exception 'Estimated cost to complete must be a non-negative amount.';
  end if;

  insert into public.project_cost_forecasts (
    project_id, organization_id, cost_budget, estimated_cost_to_complete, updated_by, updated_at
  ) values (
    p_project_id, project_organization_id, p_cost_budget,
    p_estimated_cost_to_complete, actor_id, now()
  )
  on conflict (project_id) do update set
    cost_budget = excluded.cost_budget,
    estimated_cost_to_complete = excluded.estimated_cost_to_complete,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.update_project_cost_forecast(uuid, numeric, numeric) from public;
grant execute on function public.update_project_cost_forecast(uuid, numeric, numeric) to authenticated;