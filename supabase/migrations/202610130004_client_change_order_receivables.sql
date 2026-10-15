create or replace function public.get_client_project_change_order_contracts()
returns table(project_id uuid, change_order_id uuid, contract_id uuid, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    contract.project_id,
    contract.change_order_id,
    contract.id,
    contract.amount
  from public.project_contracts contract
  join public.project_change_orders change_order
    on change_order.id = contract.change_order_id
   and change_order.project_id = contract.project_id
  where change_order.status = 'approved'
    and public.can_access_project(contract.project_id);
$$;

revoke all on function public.get_client_project_change_order_contracts() from public;
grant execute on function public.get_client_project_change_order_contracts() to authenticated;

notify pgrst, 'reload schema';
