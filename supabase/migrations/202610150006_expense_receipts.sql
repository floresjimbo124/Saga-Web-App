-- Receipt photos for project expenses (owner/manager only).
-- Path convention: <organization_id>/<project_id>/receipts/<uuid>.<ext>

alter table public.project_expenses
  add column if not exists receipt_storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_expense_receipt_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[] := string_to_array(p_object_name, '/');
  path_organization_id uuid;
  path_project_id uuid;
begin
  if coalesce(array_length(path_parts, 1), 0) < 4 or path_parts[3] <> 'receipts' then
    return false;
  end if;
  begin
    path_organization_id := path_parts[1]::uuid;
    path_project_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.projects p
    where p.id = path_project_id and p.organization_id = path_organization_id
  ) and public.can_manage_project(path_project_id);
end;
$$;

revoke all on function public.can_manage_expense_receipt_object(text) from public;
grant execute on function public.can_manage_expense_receipt_object(text) to authenticated;

create policy expense_receipts_read on storage.objects
for select to authenticated
using (bucket_id = 'expense-receipts' and public.can_manage_expense_receipt_object(name));

create policy expense_receipts_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'expense-receipts' and public.can_manage_expense_receipt_object(name));

create policy expense_receipts_delete on storage.objects
for delete to authenticated
using (bucket_id = 'expense-receipts' and public.can_manage_expense_receipt_object(name));

-- Attach, replace or clear the receipt on an existing expense.
create or replace function public.set_project_expense_receipt(
  p_expense_id uuid,
  p_receipt_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense_row record;
  normalized_path text := nullif(trim(coalesce(p_receipt_storage_path, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select expense.project_id, expense.organization_id into expense_row
  from public.project_expenses expense
  where expense.id = p_expense_id
  for update;

  if not found then
    raise exception 'Expense was not found.';
  end if;
  if not public.can_manage_project(expense_row.project_id) then
    raise exception 'You do not have permission to edit expenses for this project.';
  end if;
  if normalized_path is not null
    and normalized_path not like expense_row.organization_id::text || '/' || expense_row.project_id::text || '/receipts/%' then
    raise exception 'Receipt must be stored under this project''s receipts folder.';
  end if;

  update public.project_expenses
  set receipt_storage_path = normalized_path
  where id = p_expense_id;
end;
$$;

revoke all on function public.set_project_expense_receipt(uuid, text) from public;
grant execute on function public.set_project_expense_receipt(uuid, text) to authenticated;

-- Quick single-expense entry that returns the new id (used by the phone quick-add sheet).
create or replace function public.record_project_expense_quick(
  p_project_id uuid,
  p_expense_date date,
  p_category text,
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_receipt_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_expense_id uuid;
begin
  new_expense_id := public.record_project_expense(
    p_project_id, p_expense_date, p_category, p_description, p_vendor, p_amount
  );
  if nullif(trim(coalesce(p_receipt_storage_path, '')), '') is not null then
    perform public.set_project_expense_receipt(new_expense_id, p_receipt_storage_path);
  end if;
  return new_expense_id;
end;
$$;

revoke all on function public.record_project_expense_quick(uuid, date, text, text, text, numeric, text) from public;
grant execute on function public.record_project_expense_quick(uuid, date, text, text, text, numeric, text) to authenticated;
