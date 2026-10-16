-- Add "hauling" as a project expense category.
alter table public.project_expenses drop constraint if exists project_expenses_category_check;
alter table public.project_expenses add constraint project_expenses_category_check
  check (category = any (array['materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract', 'rent', 'equipment', 'transport', 'hauling', 'permits', 'other']));
