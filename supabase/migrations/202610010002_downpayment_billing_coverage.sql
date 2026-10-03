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
  v_down_payment_percent numeric;
  v_discounted numeric;
  v_down_payment numeric;
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
  v_billed_coverage numeric;
  v_covered numeric;
  v_amount numeric;
  v_number integer;
  v_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;

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

  select t.contract_amount, t.special_discount, t.retention_rate_percent, t.down_payment_percent
  into v_contract, v_discount, v_retention_rate, v_down_payment_percent
  from public.project_financial_terms t
  where t.project_id = p_project_id;

  if v_contract is null then
    raise exception 'Set up the contract amount before issuing a billing.';
  end if;

  v_discounted := v_contract - coalesce(v_discount, 0);
  v_down_payment := round(v_discounted * coalesce(v_down_payment_percent, 0) / 100);

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

  select coalesce(sum(pay.amount), 0)
  into v_payments
  from public.payments pay
  where pay.project_id = p_project_id and pay.voided_at is null;

  select coalesce(max(b.earned_to_date), 0)
  into v_billed_coverage
  from public.progress_billings b
  where b.project_id = p_project_id and b.status = 'issued';

  v_covered := greatest(v_payments, v_billed_coverage, v_down_payment);
  v_amount := greatest(0, v_billable_earned - v_covered);

  if v_amount <= 0 then
    raise exception 'Nothing new to bill at % percent. Work earned (PHP %) must be more than the PHP % already paid or covered by the down payment or a prior billing. Increase the progress first.',
      v_progress, to_char(v_billable_earned, 'FM999,999,999,990'), to_char(v_covered, 'FM999,999,999,990');
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
    v_billable_earned, v_payments, greatest(0, v_held),
    v_amount, now(), p_due_date, actor_id
  )
  returning id into v_id;

  return query select v_id, v_number, v_amount;
end;
$$;

revoke all on function public.issue_progress_billing(uuid, date) from public;
grant execute on function public.issue_progress_billing(uuid, date) to authenticated;