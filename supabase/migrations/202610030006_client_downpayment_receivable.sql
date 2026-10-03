create or replace function public.get_client_project_down_payment()
returns table(project_id uuid, down_payment_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    project.id,
    round(
      greatest(0, coalesce(terms.contract_amount, 0) - coalesce(terms.special_discount, 0))
        * coalesce(terms.down_payment_percent, 0) / 100
    )
  from public.projects project
  left join public.project_financial_terms terms
    on terms.project_id = project.id
    and terms.organization_id = project.organization_id
  where public.can_access_project(project.id);
$$;

revoke all on function public.get_client_project_down_payment() from public;
grant execute on function public.get_client_project_down_payment() to authenticated;
