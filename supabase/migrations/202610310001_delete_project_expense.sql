-- Owners can delete an expense. Assigned staff cannot (can_manage_project excludes them).
-- Returns the receipt path so the app can remove the stored photo. The audit trigger logs the delete.
create or replace function public.delete_project_expense(p_expense_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense_row record;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  select expense.project_id, expense.receipt_storage_path into expense_row
  from public.project_expenses expense
  where expense.id = p_expense_id
  for update;
  if not found then raise exception 'Expense was not found.'; end if;
  if not public.can_manage_project(expense_row.project_id) then
    raise exception 'You do not have permission to delete expenses for this project.';
  end if;
  delete from public.project_expenses where id = p_expense_id;
  return expense_row.receipt_storage_path;
end;
$$;
revoke all on function public.delete_project_expense(uuid) from public, anon;
grant execute on function public.delete_project_expense(uuid) to authenticated;
