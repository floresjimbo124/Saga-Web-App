create extension if not exists pg_cron with schema pg_catalog;

alter table public.payroll_weekly_entries
  add column finalized_at timestamptz;

update public.payroll_weekly_entries
set finalized_at = created_at
where finalized_at is null;

create index payroll_entries_finalized_project_idx
  on public.payroll_weekly_entries (organization_id, finalized_at, project_id)
  where finalized_at is not null;

create or replace function public.finalize_due_payroll_entries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  finalized_count integer;
begin
  update public.payroll_weekly_entries entry
  set finalized_at = now(),
      updated_at = now()
  from public.organizations organization
  where organization.id = entry.organization_id
    and entry.finalized_at is null
    and entry.week_start + 6 = (
      now() at time zone coalesce(organization.timezone, 'Asia/Manila')
    )::date;

  get diagnostics finalized_count = row_count;
  return finalized_count;
end;
$$;

revoke all on function public.finalize_due_payroll_entries() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'finalize-weekly-payroll';

select cron.schedule(
  'finalize-weekly-payroll',
  '59 15 * * 0',
  'select public.finalize_due_payroll_entries();'
);
