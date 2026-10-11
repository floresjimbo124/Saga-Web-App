create or replace function public.finalize_payroll_week(p_week_start date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  v_organization_id uuid := '10000000-0000-4000-8000-000000000001';
  finalized_count integer;
  current_week_start date;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Payroll week must start on a Monday.';
  end if;
  if not public.has_org_role(v_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an organization owner can finalize payroll.';
  end if;

  select date_trunc(
    'week',
    now() at time zone coalesce(organization.timezone, 'Asia/Manila')
  )::date
  into current_week_start
  from public.organizations organization
  where organization.id = v_organization_id;

  if p_week_start > current_week_start then
    raise exception 'Future payroll weeks cannot be finalized.';
  end if;

  update public.payroll_weekly_entries entry
  set finalized_at = now(),
      updated_at = now()
  where entry.organization_id = v_organization_id
    and entry.week_start = p_week_start
    and entry.finalized_at is null;

  get diagnostics finalized_count = row_count;
  return finalized_count;
end;
$$;

revoke all on function public.finalize_payroll_week(date) from public, anon;
grant execute on function public.finalize_payroll_week(date) to authenticated;
