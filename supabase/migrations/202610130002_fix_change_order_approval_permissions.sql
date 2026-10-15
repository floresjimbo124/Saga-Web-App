create or replace function public.respond_to_change_order(
  p_change_order_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  decided_order record;
  contract_retention numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  update public.project_change_orders co
  set status = case when p_approved then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  from public.projects p
  join public.client_user_access a
    on a.organization_id = p.organization_id
   and a.project_id = p.id
   and a.user_id = (select auth.uid())
  where co.id = p_change_order_id
    and p.id = co.project_id
    and co.status = 'pending_approval'
  returning co.organization_id, co.project_id, co.id, co.amount into decided_order;

  if not found then
    raise exception 'Change order is unavailable or has already been decided.';
  end if;

  if p_approved then
    select terms.retention_rate_percent into contract_retention
    from public.project_financial_terms terms
    where terms.project_id = decided_order.project_id;

    insert into public.project_contracts (
      organization_id, project_id, change_order_id, amount, retention_rate_percent
    ) values (
      decided_order.organization_id, decided_order.project_id, decided_order.id,
      decided_order.amount, coalesce(contract_retention, 5)
    );
  end if;
end;
$$;

revoke all on function public.respond_to_change_order(uuid, boolean, text) from public;
grant execute on function public.respond_to_change_order(uuid, boolean, text) to authenticated;
