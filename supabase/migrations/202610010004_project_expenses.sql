create table public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  expense_date date not null,
  category text not null
    check (category in ('materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract', 'rent', 'equipment', 'transport', 'permits', 'other')),
  description text not null check (length(trim(description)) between 2 and 500),
  vendor text check (vendor is null or length(trim(vendor)) <= 150),
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index project_expenses_project_date_idx
  on public.project_expenses (project_id, expense_date desc, created_at desc);

alter table public.project_expenses enable row level security;

grant select on public.project_expenses to authenticated;

create policy project_expenses_staff_read on public.project_expenses
  for select to authenticated using (public.can_manage_project(project_id));

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
  if p_category is null or p_category not in ('materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract', 'rent', 'equipment', 'transport', 'permits', 'other') then
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