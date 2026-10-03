alter table public.projects
  add column completed_at date;

update public.projects
set completed_at = current_date
where status = 'completed' and completed_at is null;

create or replace function public.update_project_state(
  p_project_id uuid,
  p_status text,
  p_health_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
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
  if not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an organization owner can update project status.';
  end if;
  if p_status is null or p_status not in ('planning', 'active', 'on_hold', 'completed', 'closed') then
    raise exception 'Project status is invalid.';
  end if;
  if p_health_status is null or p_health_status not in ('on_track', 'needs_attention') then
    raise exception 'Project health status is invalid.';
  end if;

  update public.projects
  set status = p_status,
      health_status = p_health_status,
      completed_at = case
        when p_status = 'completed' and status is distinct from 'completed' then current_date
        else completed_at
      end,
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.update_project_state(uuid, text, text) from public;
grant execute on function public.update_project_state(uuid, text, text) to authenticated;

create or replace function public.get_client_project_retention()
returns table(project_id uuid, retention_amount numeric, completed_at date)
language sql
stable
security definer
set search_path = ''
as $$
  select
    project.id,
    case
      when ledger.has_entries then greatest(
        0,
        ledger.remaining_amount - greatest(0, retention_payments.amount - ledger.released_amount)
      )
      else greatest(0, retention_cap.amount - retention_payments.amount)
    end,
    project.completed_at
  from public.projects project
  left join public.project_financial_terms terms
    on terms.project_id = project.id
    and terms.organization_id = project.organization_id
  left join lateral (
    select
      count(*) > 0 as has_entries,
      coalesce(sum(case when entry.entry_type = 'released' then entry.amount else 0 end), 0) as released_amount,
      greatest(0, coalesce(sum(
        case
          when entry.entry_type = 'held' then entry.amount
          when entry.entry_type = 'released' then -entry.amount
          else 0
        end
      ), 0)) as remaining_amount
    from public.retention_ledger entry
    where entry.project_id = project.id
  ) ledger on true
  left join lateral (
    select coalesce(sum(payment.amount), 0) as amount
    from public.payments payment
    where payment.project_id = project.id
      and payment.voided_at is null
      and payment.payment_type = 'retention_release'
  ) retention_payments on true
  left join lateral (
    select round(
      greatest(0, coalesce(terms.contract_amount, 0) - coalesce(terms.special_discount, 0))
        * coalesce(terms.retention_rate_percent, 0) / 100
      + coalesce(sum(
        change_order.amount
          * coalesce(change_order.retention_rate_percent, terms.retention_rate_percent, 0) / 100
      ), 0)
    ) as amount
    from public.project_change_orders change_order
    where change_order.project_id = project.id
      and change_order.organization_id = project.organization_id
      and change_order.status = 'approved'
  ) retention_cap on true
  where public.can_access_project(project.id);
$$;

revoke all on function public.get_client_project_retention() from public;
grant execute on function public.get_client_project_retention() to authenticated;
