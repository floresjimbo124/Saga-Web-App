-- Progress updates and progress billings (issue / void).
-- All three functions run with owner/staff permission checks inside the database.

create or replace function public.update_project_progress(
  p_project_id uuid,
  p_progress_percent numeric,
  p_summary text default null
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
  select organization_id into project_organization_id from public.projects where id = p_project_id;
  if project_organization_id is null then
    raise exception 'Project was not found.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to update progress for this project.';
  end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'Progress must be between 0 and 100.';
  end if;

  update public.projects set progress_percent = p_progress_percent where id = p_project_id;

  insert into public.project_progress_updates (
    organization_id, project_id, progress_percent, summary, created_by
  ) values (
    project_organization_id, p_project_id, p_progress_percent,
    coalesce(nullif(trim(coalesce(p_summary, '')), ''), 'Progress updated to ' || p_progress_percent || '%'),
    actor_id
  );
end;
$$;

revoke all on function public.update_project_progress(uuid, numeric, text) from public;
grant execute on function public.update_project_progress(uuid, numeric, text) to authenticated;


create or replace function public.issue_progress_billing(
  p_project_id uuid,
  p_due_date date default null
)
returns table(billing_id uuid, billing_number integer, amount_for_billing numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  v_progress numeric;
  v_contract numeric;
  v_discount numeric;
  v_retention_rate numeric;
  v_discounted numeric;
  v_change_total numeric;
  v_change_retention numeric;
  v_contract_value numeric;
  v_retention_cap numeric;
  v_released numeric;
  v_held numeric;
  v_ceiling numeric;
  v_earned numeric;
  v_billable_earned numeric;
  v_payments numeric;
  v_down_payments numeric;
  v_issued_total numeric;
  v_covered numeric;
  v_amount numeric;
  v_number integer;
  v_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

  -- Lock the project row so two billings cannot take the same number.
  select p.organization_id, p.progress_percent
  into project_organization_id, v_progress
  from public.projects p
  where p.id = p_project_id
  for update;

  if project_organization_id is null then
    raise exception 'Project was not found.';
  end if;
  if not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can issue a billing.';
  end if;

  select t.contract_amount, t.special_discount, t.retention_rate_percent
  into v_contract, v_discount, v_retention_rate
  from public.project_financial_terms t
  where t.project_id = p_project_id;

  if v_contract is null then
    raise exception 'Set up the contract amount before issuing a billing.';
  end if;

  v_discounted := v_contract - coalesce(v_discount, 0);

  select coalesce(sum(c.amount), 0),
         coalesce(sum(c.amount * coalesce(c.retention_rate_percent, v_retention_rate) / 100), 0)
  into v_change_total, v_change_retention
  from public.project_change_orders c
  where c.project_id = p_project_id and c.status = 'approved';

  v_contract_value := round(v_discounted + v_change_total);
  v_retention_cap := round(v_discounted * v_retention_rate / 100 + v_change_retention);

  select coalesce(sum(case when l.entry_type = 'released' then l.amount end), 0),
         coalesce(sum(case when l.entry_type = 'held' then l.amount
                           when l.entry_type = 'released' then -l.amount
                           else 0 end), 0)
  into v_released, v_held
  from public.retention_ledger l
  where l.project_id = p_project_id;

  v_ceiling := v_contract_value - (v_retention_cap - v_released);
  v_earned := round(v_contract_value * v_progress / 100);
  v_billable_earned := least(v_earned, v_ceiling);

  select coalesce(sum(pay.amount), 0),
         coalesce(sum(case when pay.payment_type = 'down_payment' then pay.amount end), 0)
  into v_payments, v_down_payments
  from public.payments pay
  where pay.project_id = p_project_id and pay.voided_at is null;

  select coalesce(sum(b.amount_for_billing), 0)
  into v_issued_total
  from public.progress_billings b
  where b.project_id = p_project_id and b.status = 'issued';

  -- Work already covered = whatever the client has paid, or the down payment plus
  -- everything already billed, whichever is larger. This stops the same work
  -- from being billed twice while an earlier billing is still unpaid.
  v_covered := greatest(v_payments, v_down_payments + v_issued_total);
  v_amount := greatest(0, v_billable_earned - v_covered);

  if v_amount <= 0 then
    raise exception 'Nothing new to bill. Update the project progress first.';
  end if;

  select coalesce(max(b.billing_number), 0) + 1
  into v_number
  from public.progress_billings b
  where b.project_id = p_project_id;

  insert into public.progress_billings (
    organization_id, project_id, billing_number, status, progress_percent,
    earned_to_date, payments_received_to_date, retention_withheld,
    amount_for_billing, issued_at, due_at, created_by
  ) values (
    project_organization_id, p_project_id, v_number, 'issued', v_progress,
    v_earned, v_payments, greatest(0, v_held),
    v_amount, now(), p_due_date, actor_id
  )
  returning id into v_id;

  return query select v_id, v_number, v_amount;
end;
$$;

revoke all on function public.issue_progress_billing(uuid, date) from public;
grant execute on function public.issue_progress_billing(uuid, date) to authenticated;


create or replace function public.void_progress_billing(
  p_billing_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  v_org uuid;
  v_status text;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  select b.organization_id, b.status into v_org, v_status
  from public.progress_billings b where b.id = p_billing_id;

  if v_org is null then
    raise exception 'Billing was not found.';
  end if;
  if not public.has_org_role(v_org, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can void a billing.';
  end if;
  if v_status <> 'issued' then
    raise exception 'Only an issued billing can be voided.';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Enter a reason for voiding this billing.';
  end if;

  update public.progress_billings
  set status = 'void', voided_at = now(), voided_by = actor_id, void_reason = v_reason
  where id = p_billing_id;
end;
$$;

revoke all on function public.void_progress_billing(uuid, text) from public;
grant execute on function public.void_progress_billing(uuid, text) to authenticated;
