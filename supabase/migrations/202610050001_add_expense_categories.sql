alter table public.project_expenses
  drop constraint if exists project_expenses_category_check,
  add constraint project_expenses_category_check
    check (category in (
      'materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract',
      'rent', 'equipment', 'transport', 'permits', 'other'
    ));

create or replace function public.record_project_expense(
  p_project_id uuid,
  p_expense_date date,
  p_category text,
  p_description text,
  p_vendor text,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  new_expense_id uuid;
  normalized_description text := trim(coalesce(p_description, ''));
  normalized_vendor text := nullif(trim(coalesce(p_vendor, '')), '');
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
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to log expenses for this project.';
  end if;
  if p_expense_date is null then
    raise exception 'Expense date is required.';
  end if;
  if p_amount is null or p_amount <= 0 then
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

  insert into public.project_expenses (
    organization_id, project_id, expense_date, category,
    description, vendor, amount, created_by
  ) values (
    project_organization_id, p_project_id, p_expense_date, p_category,
    normalized_description, normalized_vendor, p_amount, actor_id
  ) returning id into new_expense_id;

  return new_expense_id;
end;
$$;

revoke all on function public.record_project_expense(uuid, date, text, text, text, numeric) from public;
grant execute on function public.record_project_expense(uuid, date, text, text, text, numeric) to authenticated;

create or replace function public.record_project_expenses(p_expenses jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  expense_row jsonb;
  project_id uuid;
  project_organization_id uuid;
  expense_date date;
  category text;
  description text;
  vendor text;
  amount numeric;
  inserted_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  if jsonb_typeof(p_expenses) is distinct from 'array'
    or jsonb_array_length(p_expenses) = 0 then
    raise exception 'Add at least one expense row.';
  end if;

  for expense_row in select value from jsonb_array_elements(p_expenses)
  loop
    if jsonb_typeof(expense_row) is distinct from 'object' then
      raise exception 'Each expense row must be an object.';
    end if;

    project_id := nullif(trim(coalesce(expense_row->>'project_id', '')), '')::uuid;
    expense_date := nullif(trim(coalesce(expense_row->>'expense_date', '')), '')::date;
    category := nullif(trim(coalesce(expense_row->>'category', '')), '');
    description := trim(coalesce(expense_row->>'description', ''));
    vendor := nullif(trim(coalesce(expense_row->>'vendor', '')), '');
    amount := nullif(trim(coalesce(expense_row->>'amount', '')), '')::numeric;

    if project_id is null then
      raise exception 'Every expense must be assigned to a project.';
    end if;
    select p.organization_id into project_organization_id
    from public.projects p
    where p.id = project_id;
    if project_organization_id is null then
      raise exception 'Project % was not found.', project_id;
    end if;
    if not public.can_manage_project(project_id) then
      raise exception 'You do not have permission to log expenses for project %.', project_id;
    end if;
    if expense_date is null then
      raise exception 'Expense date is required for every row.';
    end if;
    if category is null or category not in (
      'materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract',
      'rent', 'equipment', 'transport', 'permits', 'other'
    ) then
      raise exception 'Choose a supported expense category for every row.';
    end if;
    if amount is null or amount <= 0 or amount = 'NaN'::numeric then
      raise exception 'Every expense amount must be greater than zero.';
    end if;
    if length(description) not between 2 and 500 then
      raise exception 'Every expense description must contain between 2 and 500 characters.';
    end if;
    if vendor is not null and length(vendor) > 150 then
      raise exception 'Vendor names must not exceed 150 characters.';
    end if;

    insert into public.project_expenses (
      organization_id, project_id, expense_date, category,
      description, vendor, amount, created_by
    ) values (
      project_organization_id, project_id, expense_date, category,
      description, vendor, amount, actor_id
    );
    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.record_project_expenses(jsonb) from public;
grant execute on function public.record_project_expenses(jsonb) to authenticated;
