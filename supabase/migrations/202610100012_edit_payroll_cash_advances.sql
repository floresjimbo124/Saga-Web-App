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
  if not public.has_org_role(advance_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an organization owner can update payroll advances.';
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

revoke all on function public.update_payroll_cash_advance(uuid, numeric, date, text) from public;
grant execute on function public.update_payroll_cash_advance(uuid, numeric, date, text) to authenticated;
