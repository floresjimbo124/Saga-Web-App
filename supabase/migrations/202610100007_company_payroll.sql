create table public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  daily_rate numeric(14, 2) not null check (daily_rate > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.payroll_cash_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  advance_date date not null,
  note text not null default '' check (length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (employee_id, organization_id)
    references public.payroll_employees (id, organization_id) on delete restrict
);

create table public.payroll_weekly_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  project_id uuid,
  present_days smallint not null check (present_days between 0 and 7),
  daily_rate numeric(14, 2) not null check (daily_rate > 0),
  gross_pay numeric(14, 2) not null check (gross_pay >= 0),
  advance_deduction numeric(14, 2) not null default 0 check (advance_deduction >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (employee_id, week_start),
  foreign key (employee_id, organization_id)
    references public.payroll_employees (id, organization_id) on delete restrict,
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete restrict,
  check (advance_deduction <= gross_pay)
);

create table public.payroll_attendance (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id uuid not null,
  work_date date not null,
  present smallint not null check (present in (0, 1)),
  primary key (entry_id, work_date),
  foreign key (entry_id, organization_id)
    references public.payroll_weekly_entries (id, organization_id) on delete cascade
);

create index payroll_entries_week_idx
  on public.payroll_weekly_entries (organization_id, week_start desc);
create index payroll_advances_employee_date_idx
  on public.payroll_cash_advances (employee_id, advance_date desc);

alter table public.payroll_employees enable row level security;
alter table public.payroll_cash_advances enable row level security;
alter table public.payroll_weekly_entries enable row level security;
alter table public.payroll_attendance enable row level security;

grant select, insert, update on public.payroll_employees to authenticated;
grant select on public.payroll_cash_advances to authenticated;
grant select on public.payroll_weekly_entries to authenticated;
grant select on public.payroll_attendance to authenticated;

create policy payroll_employees_owner_manage on public.payroll_employees
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy payroll_advances_owner_read on public.payroll_cash_advances
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy payroll_entries_owner_read on public.payroll_weekly_entries
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy payroll_attendance_owner_read on public.payroll_attendance
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

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
  if not public.has_org_role(employee_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an organization owner can record payroll advances.';
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

revoke all on function public.record_payroll_cash_advance(uuid, numeric, date, text) from public;
grant execute on function public.record_payroll_cash_advance(uuid, numeric, date, text) to authenticated;

create or replace function public.save_payroll_week_entry(
  p_employee_id uuid,
  p_week_start date,
  p_project_id uuid,
  p_attendance jsonb,
  p_advance_deduction numeric
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
  if p_attendance is null or jsonb_typeof(p_attendance) is distinct from 'array' then
    raise exception 'Record attendance for all seven days of the payroll week.';
  end if;
  if jsonb_array_length(p_attendance) <> 7 then
    raise exception 'Record attendance for all seven days of the payroll week.';
  end if;
  if p_advance_deduction is null or p_advance_deduction < 0 then
    raise exception 'Cash advance deduction cannot be negative.';
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

  gross_amount := employee_daily_rate * present_day_count;
  if p_advance_deduction > outstanding_advances then
    raise exception 'Cash advance deduction exceeds the employee''s outstanding advance balance (%).', outstanding_advances;
  end if;
  if p_advance_deduction > gross_amount then
    raise exception 'Cash advance deduction cannot exceed gross pay (%).', gross_amount;
  end if;

  insert into public.payroll_weekly_entries (
    organization_id, employee_id, week_start, project_id,
    present_days, daily_rate, gross_pay, advance_deduction,
    created_by, updated_at
  ) values (
    employee_organization_id, p_employee_id, p_week_start, p_project_id,
    present_day_count, employee_daily_rate, gross_amount, p_advance_deduction,
    actor_id, now()
  )
  on conflict (employee_id, week_start) do update set
    project_id = excluded.project_id,
    present_days = excluded.present_days,
    daily_rate = excluded.daily_rate,
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

revoke all on function public.save_payroll_week_entry(uuid, date, uuid, jsonb, numeric) from public;
grant execute on function public.save_payroll_week_entry(uuid, date, uuid, jsonb, numeric) to authenticated;
