create or replace function public.protect_payment_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.project_id is distinct from new.project_id
    or old.organization_id is distinct from new.organization_id
    or old.receipt_number is distinct from new.receipt_number
    or old.payment_type is distinct from new.payment_type
    or old.contract_id is distinct from new.contract_id then
    raise exception 'Payment identity and type cannot be changed.';
  end if;
  if old.voided_at is not null then
    raise exception 'A voided payment cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.update_project_payment(
  p_payment_id uuid,
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
  allocated_amount numeric;
begin
  select payment.project_id
  into target_project_id
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
  set amount = p_amount,
      received_at = p_received_date::timestamptz,
      payment_mode = p_payment_mode,
      payer_name = btrim(p_payer_name),
      reference = nullif(btrim(p_reference), ''),
      updated_at = now()
  where id = p_payment_id
    and project_id = target_project_id;
end;
$$;

revoke all on function public.update_project_payment(uuid, numeric, date, text, text, text) from public;
grant execute on function public.update_project_payment(uuid, numeric, date, text, text, text) to authenticated;
