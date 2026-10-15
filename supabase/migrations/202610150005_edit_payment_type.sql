drop function public.update_project_payment(uuid, numeric, date, text, text, text);

create or replace function public.update_project_payment(
  p_payment_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_received_date date,
  p_payment_mode text,
  p_payer_name text,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project_id uuid;
  target_contract_id uuid;
  current_payment_type text;
  allocated_amount numeric;
begin
  select payment.project_id, payment.contract_id, payment.payment_type
  into target_project_id, target_contract_id, current_payment_type
  from public.payments payment
  where payment.id = p_payment_id
    and payment.voided_at is null
  for update;

  if target_project_id is null then
    raise exception 'Payment was not found or has been voided.';
  end if;
  if not public.can_manage_project(target_project_id) then
    raise exception 'You do not have permission to edit this payment.';
  end if;
  if p_payment_type is null
    or p_payment_type not in ('down_payment', 'progress', 'change_order', 'retention_release', 'other') then
    raise exception 'Choose a supported payment type. Retention releases use a separate workflow.';
  end if;
  if current_payment_type = 'retention_release' and p_payment_type <> current_payment_type then
    raise exception 'Retention release payment types cannot be changed.';
  end if;
  if p_payment_type = 'change_order' and (
    target_contract_id is null
    or not exists (
      select 1
      from public.project_contracts contract
      join public.project_change_orders change_order
        on change_order.id = contract.change_order_id
       and change_order.project_id = contract.project_id
      where contract.id = target_contract_id
        and contract.project_id = target_project_id
        and change_order.status = 'approved'
    )
  ) then
    raise exception 'Change-order payments must be recorded against an approved change-order contract.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_received_date is null then
    raise exception 'Received date is required.';
  end if;
  if p_payment_mode not in ('cash', 'bank_transfer', 'check', 'card', 'other') then
    raise exception 'Choose a valid payment method.';
  end if;
  if p_payer_name is null or length(btrim(p_payer_name)) < 2 then
    raise exception 'Payer name must contain at least two characters.';
  end if;

  select coalesce(sum(allocation.amount), 0)
  into allocated_amount
  from public.payment_allocations allocation
  where allocation.payment_id = p_payment_id;
  if p_amount < allocated_amount then
    raise exception 'Payment amount cannot be less than its total billing allocations.';
  end if;

  update public.payments
  set payment_type = p_payment_type,
      amount = p_amount,
      received_at = p_received_date::timestamptz,
      payment_mode = p_payment_mode,
      payer_name = btrim(p_payer_name),
      reference = nullif(btrim(p_reference), ''),
      updated_at = now()
  where id = p_payment_id
    and project_id = target_project_id;
end;
$$;

revoke all on function public.update_project_payment(uuid, text, numeric, date, text, text, text) from public;
grant execute on function public.update_project_payment(uuid, text, numeric, date, text, text, text) to authenticated;
