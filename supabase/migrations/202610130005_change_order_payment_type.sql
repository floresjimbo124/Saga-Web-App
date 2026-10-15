alter table public.payments
  drop constraint payments_payment_type_check,
  add constraint payments_payment_type_check
    check (payment_type in ('down_payment', 'progress', 'change_order', 'retention_release', 'other'));

create or replace function public.record_project_payment_for_contract(
  p_project_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_received_date date,
  p_payment_mode text,
  p_payer_name text,
  p_reference text,
  p_contract_id uuid
)
returns table(payment_id uuid, receipt_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  organization_timezone text;
  new_payment_id uuid;
  new_receipt_number text;
  normalized_payer text := trim(coalesce(p_payer_name, ''));
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select project.organization_id, organization.timezone
  into project_organization_id, organization_timezone
  from public.projects project
  join public.organizations organization on organization.id = project.organization_id
  where project.id = p_project_id;

  if project_organization_id is null then raise exception 'Project was not found.'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to log payments for this project.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_received_date is null then raise exception 'Payment date is required.'; end if;
  if p_payment_type not in ('down_payment', 'progress', 'change_order', 'other') then
    raise exception 'Choose a supported payment type. Retention releases use a separate workflow.';
  end if;
  if p_payment_mode not in ('cash', 'bank_transfer', 'check', 'card', 'other') then
    raise exception 'Choose a supported payment method.';
  end if;
  if length(normalized_payer) < 2 then raise exception 'Payer name must contain at least two characters.'; end if;
  if p_payment_type = 'change_order' and p_contract_id is null then
    raise exception 'Change-order payments must be recorded against an approved change-order contract.';
  end if;
  if p_contract_id is not null and not exists (
    select 1
    from public.project_contracts contract
    join public.project_change_orders change_order
      on change_order.id = contract.change_order_id
     and change_order.project_id = contract.project_id
    where contract.id = p_contract_id
      and contract.project_id = p_project_id
      and change_order.status = 'approved'
  ) then
    raise exception 'The approved change-order contract was not found in this project.';
  end if;

  insert into public.payments (
    organization_id, project_id, contract_id, payment_type, amount, received_at,
    payment_mode, payer_name, reference, created_by
  ) values (
    project_organization_id, p_project_id, p_contract_id, p_payment_type, p_amount,
    p_received_date::timestamp at time zone coalesce(organization_timezone, 'Asia/Manila'),
    p_payment_mode, normalized_payer, nullif(trim(coalesce(p_reference, '')), ''), actor_id
  )
  returning id, payments.receipt_number into new_payment_id, new_receipt_number;

  return query select new_payment_id, new_receipt_number;
end;
$$;

revoke all on function public.record_project_payment_for_contract(uuid, text, numeric, date, text, text, text, uuid) from public;

create or replace function public.record_project_payment_with_allocations(
  p_project_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_received_date date,
  p_payment_mode text,
  p_payer_name text,
  p_reference text,
  p_allocations jsonb,
  p_contract_id uuid
)
returns table(payment_id uuid, receipt_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_payment record;
  allocation_row record;
  billing_amount numeric;
  previously_allocated numeric;
  allocation_total numeric := 0;
  project_organization_id uuid;
begin
  select project.organization_id into project_organization_id
  from public.projects project where project.id = p_project_id;
  if project_organization_id is null then raise exception 'Project was not found.'; end if;
  if p_contract_id is not null and not exists (
    select 1 from public.project_contracts contract
    where contract.id = p_contract_id and contract.project_id = p_project_id
  ) then raise exception 'The approved change-order contract was not found in this project.'; end if;
  if p_payment_type = 'change_order' and p_contract_id is null then
    raise exception 'Change-order payments must be recorded against an approved change-order contract.';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Payment allocations must be provided as a list.';
  end if;
  if jsonb_array_length(p_allocations) > 0
    and not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can allocate payments to billings.';
  end if;

  select result.payment_id, result.receipt_number into recorded_payment
  from public.record_project_payment_for_contract(
    p_project_id, p_payment_type, p_amount, p_received_date,
    p_payment_mode, p_payer_name, p_reference, p_contract_id
  ) result;

  for allocation_row in
    select item.billing_id, sum(item.amount) as amount
    from jsonb_to_recordset(p_allocations) as item(billing_id uuid, amount numeric)
    group by item.billing_id order by item.billing_id
  loop
    if allocation_row.billing_id is null or allocation_row.amount is null
      or allocation_row.amount <= 0 or allocation_row.amount = 'NaN'::numeric then
      raise exception 'Each allocation must have a billing and an amount greater than zero.';
    end if;
    select billing.amount_for_billing into billing_amount
    from public.progress_billings billing
    where billing.id = allocation_row.billing_id
      and billing.project_id = p_project_id
      and billing.contract_id is not distinct from p_contract_id
      and billing.status = 'issued'
    for update;
    if not found then raise exception 'An allocation must target an issued billing in this contract.'; end if;

    select coalesce(sum(allocation.amount), 0) into previously_allocated
    from public.payment_allocations allocation
    join public.payments payment on payment.id = allocation.payment_id
    where allocation.billing_id = allocation_row.billing_id and payment.voided_at is null;
    if previously_allocated + allocation_row.amount > billing_amount then
      raise exception 'Allocation exceeds the remaining recorded balance on billing %.', allocation_row.billing_id;
    end if;
    allocation_total := allocation_total + allocation_row.amount;
    if allocation_total > p_amount then raise exception 'Billing allocations cannot exceed the payment amount.'; end if;
    insert into public.payment_allocations (organization_id, project_id, payment_id, billing_id, amount)
    values (project_organization_id, p_project_id, recorded_payment.payment_id, allocation_row.billing_id, allocation_row.amount);
  end loop;

  return query select recorded_payment.payment_id, recorded_payment.receipt_number;
end;
$$;

revoke all on function public.record_project_payment_with_allocations(uuid, text, numeric, date, text, text, text, jsonb, uuid) from public;
grant execute on function public.record_project_payment_with_allocations(uuid, text, numeric, date, text, text, text, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
