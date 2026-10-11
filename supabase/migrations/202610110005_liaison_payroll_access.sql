create or replace function public.has_payroll_access(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  ) or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'site_staff'
      and membership.staff_title = 'liaison_officer'
  );
$$;

revoke all on function public.has_payroll_access(uuid) from public, anon;
grant execute on function public.has_payroll_access(uuid) to authenticated;

drop policy payroll_employees_owner_manage on public.payroll_employees;
create policy payroll_employees_payroll_manage on public.payroll_employees
  for all to authenticated
  using (public.has_payroll_access(organization_id))
  with check (public.has_payroll_access(organization_id));

drop policy payroll_advances_owner_read on public.payroll_cash_advances;
create policy payroll_advances_payroll_read on public.payroll_cash_advances
  for select to authenticated
  using (public.has_payroll_access(organization_id));

drop policy payroll_entries_owner_read on public.payroll_weekly_entries;
create policy payroll_entries_payroll_read on public.payroll_weekly_entries
  for select to authenticated
  using (public.has_payroll_access(organization_id));

drop policy payroll_attendance_owner_read on public.payroll_attendance;
create policy payroll_attendance_payroll_read on public.payroll_attendance
  for select to authenticated
  using (public.has_payroll_access(organization_id));

create or replace function public.record_payroll_cash_advance(
  p_employee_id uuid,
  p_amount numeric,
  p_advance_date date,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  employee_organization_id uuid;
  employee_is_active boolean;
  new_advance_id uuid;
  normalized_note text := trim(coalesce(p_note, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  select employee.organization_id, employee.active
  into employee_organization_id, employee_is_active
  from public.payroll_employees employee
  where employee.id = p_employee_id;

  if employee_organization_id is null then
    raise exception 'Payroll employee was not found.';
  end if;
  if not public.has_payroll_access(employee_organization_id) then
    raise exception 'Only an owner or the liaison officer can manage payroll.';
  end if;
  if not employee_is_active then
    raise exception 'Cash advances can only be recorded for active employees.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash advance must be greater than zero.';
  end if;
  if p_advance_date is null then
    raise exception 'Cash advance date is required.';
  end if;
  if length(normalized_note) > 500 then
    raise exception 'Cash advance note must not exceed 500 characters.';
  end if;

  insert into public.payroll_cash_advances (
    organization_id, employee_id, amount, advance_date, note, created_by
  ) values (
    employee_organization_id, p_employee_id, p_amount, p_advance_date, normalized_note, actor_id
  ) returning id into new_advance_id;

  return new_advance_id;
end;
$$;

revoke all on function public.record_payroll_cash_advance(uuid, numeric, date, text) from public, anon;
grant execute on function public.record_payroll_cash_advance(uuid, numeric, date, text) to authenticated;

create or replace function public.save_payroll_week_entry(
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
  if not public.has_payroll_access(employee_organization_id) then
    raise exception 'Only an owner or the liaison officer can manage payroll.';
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

create or replace function public.update_payroll_cash_advance(
  p_advance_id uuid,
  p_amount numeric,
  p_advance_date date,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  advance_organization_id uuid;
  advance_employee_id uuid;
  other_advance_total numeric;
  total_deductions numeric;
  normalized_note text := trim(coalesce(p_note, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  select advance.organization_id, advance.employee_id
  into advance_organization_id, advance_employee_id
  from public.payroll_cash_advances advance
  where advance.id = p_advance_id
  for update;

  if not found then
    raise exception 'Cash advance was not found.';
  end if;
  if not public.has_payroll_access(advance_organization_id) then
    raise exception 'Only an owner or the liaison officer can manage payroll.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash advance must be greater than zero.';
  end if;
  if p_advance_date is null then
    raise exception 'Cash advance date is required.';
  end if;
  if length(normalized_note) > 500 then
    raise exception 'Cash advance note must not exceed 500 characters.';
  end if;

  perform 1
  from public.payroll_employees employee
  where employee.id = advance_employee_id
  for update;

  select coalesce(sum(advance.amount), 0)
  into other_advance_total
  from public.payroll_cash_advances advance
  where advance.employee_id = advance_employee_id
    and advance.id <> p_advance_id;

  select coalesce(sum(entry.advance_deduction), 0)
  into total_deductions
  from public.payroll_weekly_entries entry
  where entry.employee_id = advance_employee_id;

  if other_advance_total + p_amount < total_deductions then
    raise exception 'Cash advance total cannot be less than repayments already deducted.';
  end if;

  update public.payroll_cash_advances
  set amount = p_amount,
      advance_date = p_advance_date,
      note = normalized_note
  where id = p_advance_id
    and organization_id = advance_organization_id;
end;
$$;

revoke all on function public.update_payroll_cash_advance(uuid, numeric, date, text) from public, anon;
grant execute on function public.update_payroll_cash_advance(uuid, numeric, date, text) to authenticated;

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
  if not public.has_payroll_access(v_organization_id) then
    raise exception 'Only an owner or the liaison officer can finalize payroll.';
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

create or replace function public.list_payroll_projects()
returns table (project_id uuid, project_name text, project_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id constant uuid := '10000000-0000-4000-8000-000000000001';
begin
  if not public.has_payroll_access(v_organization_id) then
    raise exception 'Only an owner or the liaison officer can access payroll projects.';
  end if;

  return query
  select project.id, project.name, project.status
  from public.projects project
  where project.organization_id = v_organization_id
  order by project.name;
end;
$$;

revoke all on function public.list_payroll_projects() from public, anon;
grant execute on function public.list_payroll_projects() to authenticated;

notify pgrst, 'reload schema';
