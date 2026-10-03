drop function public.get_client_project_down_payment();

create function public.get_client_project_down_payment()
returns table(project_id uuid, contract_price numeric, down_payment_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    project.id,
    round(greatest(0, coalesce(terms.contract_amount, 0) - coalesce(terms.special_discount, 0))
      + coalesce(change_orders.amount, 0)),
    round(
      greatest(0, coalesce(terms.contract_amount, 0) - coalesce(terms.special_discount, 0))
        * coalesce(terms.down_payment_percent, 0) / 100
    )
  from public.projects project
  left join public.project_financial_terms terms
    on terms.project_id = project.id
    and terms.organization_id = project.organization_id
  left join lateral (
    select sum(change_order.amount) as amount
    from public.project_change_orders change_order
    where change_order.project_id = project.id
      and change_order.organization_id = project.organization_id
      and change_order.status = 'approved'
  ) change_orders on true
  where public.can_access_project(project.id);
$$;

revoke all on function public.get_client_project_down_payment() from public;
grant execute on function public.get_client_project_down_payment() to authenticated;
