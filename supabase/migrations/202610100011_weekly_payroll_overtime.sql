alter table public.payroll_weekly_entries
  add column overtime_amount numeric(14, 2) not null default 0
  check (overtime_amount >= 0);

revoke all on function public.save_payroll_week_entry(uuid, date, uuid, jsonb, numeric) from public, anon, authenticated;
drop function public.save_payroll_week_entry(uuid, date, uuid, jsonb, numeric);

create function public.save_payroll_week_entry(
  p_employee_id uuid,
  p_week_start date,
  p_project_id uuid,
  p_attendance jsonb,
  p_advance_deduction numeric,
  p_overtime_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  employee_organization_id uuid;
  employee_daily_rate numeric(14, 2);
  employee_is_active boolean;
  existing_entry_id uuid;
  existing_daily_rate numeric(14, 2);
  payroll_entry_id uuid;
  present_day_count integer;
  gross_amount numeric(14, 2);
  outstanding_advances numeric(14, 2);
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Payroll week must start on a Monday.';
  end if;
  if p_attendance is null or jsonb_typeof(p_attendance) is distinct from 'array'
     or jsonb_array_length(p_attendance) <> 7 then
    raise exception 'Record attendance for all seven days of the payroll week.';
  end if;
  if p_advance_deduction is null or p_advance_deduction < 0 then
    raise exception 'Cash advance deduction cannot be negative.';
  end if;
  if p_overtime_amount is null or p_overtime_amount < 0 then
    raise exception 'Overtime amount cannot be negative.';
  end if;

  select employee.organization_id, employee.daily_rate, employee.active
  into employee_organization_id, employee_daily_rate, employee_is_active
  from public.payroll_employees employee
  where employee.id = p_employee_id
  for update;

  if employee_organization_id is null then
    raise exception 'Payroll employee was not found.';
  end if;
  if not public.has_org_role(employee_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an organization owner can save payroll.';
  end if;
  if not employee_is_active then
    raise exception 'Payroll can only be saved for active employees.';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.organization_id = employee_organization_id
  ) then
    raise exception 'Select a project in this organization.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_attendance) as day(work_date date, present smallint)
    where day.work_date is null
      or day.work_date < p_week_start
      or day.work_date > p_week_start + 6
      or day.present is null
      or day.present not in (0, 1)
  ) or (
    select count(distinct day.work_date)
    from jsonb_to_recordset(p_attendance) as day(work_date date, present smallint)
  ) <> 7 then
    raise exception 'Attendance must have exactly one 1 or 0 value for each day of the payroll week.';
  end if;

  select entry.id, entry.daily_rate
  into existing_entry_id, existing_daily_rate
  from public.payroll_weekly_entries entry
  where entry.employee_id = p_employee_id and entry.week_start = p_week_start
  for update;
  employee_daily_rate := coalesce(existing_daily_rate, employee_daily_rate);

  select coalesce(sum(advance.amount), 0) - coalesce((
    select sum(entry.advance_deduction)
    from public.payroll_weekly_entries entry
    where entry.employee_id = p_employee_id
      and entry.id is distinct from existing_entry_id
  ), 0)
  into outstanding_advances
  from public.payroll_cash_advances advance
  where advance.employee_id = p_employee_id;

  select count(*) filter (where day.present = 1)
  into present_day_count
  from jsonb_to_recordset(p_attendance) as day(work_date date, present smallint);

  gross_amount := employee_daily_rate * present_day_count + p_overtime_amount;
  if p_advance_deduction > outstanding_advances then
    raise exception 'Cash advance deduction exceeds the employee''s outstanding advance balance (%).', outstanding_advances;
  end if;
  if p_advance_deduction > gross_amount then
    raise exception 'Cash advance deduction cannot exceed gross pay (%).', gross_amount;
  end if;

  insert into public.payroll_weekly_entries (
    organization_id, employee_id, week_start, project_id,
    present_days, daily_rate, overtime_amount, gross_pay, advance_deduction,
    created_by, updated_at
  ) values (
    employee_organization_id, p_employee_id, p_week_start, p_project_id,
    present_day_count, employee_daily_rate, p_overtime_amount, gross_amount, p_advance_deduction,
    actor_id, now()
  )
  on conflict (employee_id, week_start) do update set
    project_id = excluded.project_id,
    present_days = excluded.present_days,
    daily_rate = excluded.daily_rate,
    overtime_amount = excluded.overtime_amount,
    gross_pay = excluded.gross_pay,
    advance_deduction = excluded.advance_deduction,
    updated_at = now()
  returning id into payroll_entry_id;

  delete from public.payroll_attendance
  where entry_id = payroll_entry_id and organization_id = employee_organization_id;

  insert into public.payroll_attendance (organization_id, entry_id, work_date, present)
  select employee_organization_id, payroll_entry_id, day.work_date, day.present
  from jsonb_to_recordset(p_attendance) as day(work_date date, present smallint);

  return payroll_entry_id;
end;
$$;

revoke all on function public.save_payroll_week_entry(uuid, date, uuid, jsonb, numeric, numeric) from public, anon;
grant execute on function public.save_payroll_week_entry(uuid, date, uuid, jsonb, numeric, numeric) to authenticated;
