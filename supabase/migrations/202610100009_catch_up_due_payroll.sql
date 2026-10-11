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
    and entry.week_start + 6 <= (
      now() at time zone coalesce(organization.timezone, 'Asia/Manila')
    )::date;

  get diagnostics finalized_count = row_count;
  return finalized_count;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'finalize-weekly-payroll';

select cron.schedule(
  'finalize-weekly-payroll',
  '59 15 * * *',
  'select public.finalize_due_payroll_entries();'
);
