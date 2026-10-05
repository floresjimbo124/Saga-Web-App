create or replace function public.update_project_expense(
  p_expense_id uuid,
  p_expense_date date,
  p_category text,
  p_description text,
  p_vendor text,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  expense_project_id uuid;
  normalized_description text := trim(coalesce(p_description, ''));
  normalized_vendor text := nullif(trim(coalesce(p_vendor, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  select expense.project_id into expense_project_id
  from public.project_expenses expense
  where expense.id = p_expense_id
  for update;

  if not found then
    raise exception 'Expense was not found.';
  end if;
  if not public.can_manage_project(expense_project_id) then
    raise exception 'You do not have permission to edit expenses for this project.';
  end if;
  if p_expense_date is null then
    raise exception 'Expense date is required.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'Expense amount must be greater than zero.';
  end if;
  if p_category is null or p_category not in (
    'materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract',
    'rent', 'equipment', 'transport', 'permits', 'other'
  ) then
    raise exception 'Choose a supported expense category.';
  end if;
  if length(normalized_description) not between 2 and 500 then
    raise exception 'Description must contain between 2 and 500 characters.';
  end if;
  if normalized_vendor is not null and length(normalized_vendor) > 150 then
    raise exception 'Vendor name must not exceed 150 characters.';
  end if;

  update public.project_expenses
  set expense_date = p_expense_date,
      category = p_category,
      description = normalized_description,
      vendor = normalized_vendor,
      amount = p_amount
  where id = p_expense_id;
end;
$$;

revoke all on function public.update_project_expense(uuid, date, text, text, text, numeric) from public;
grant execute on function public.update_project_expense(uuid, date, text, text, text, numeric) to authenticated;
