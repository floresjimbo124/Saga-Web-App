do $$
declare
  matching_payments integer;
  target_payment public.payments%rowtype;
  project_name text;
  configured_prefix text;
  project_prefix text;
  target_billing_id uuid;
  billing_amount numeric;
  payment_allocation_count integer;
  billing_allocated_amount numeric;
  existing_receipt boolean;
begin
  select count(*) into matching_payments
  from public.payments payment
  join public.projects project
    on project.id = payment.project_id
   and project.organization_id = payment.organization_id
  where project.prefix = 'PRO'
    and payment.receipt_number = 'PRO-0002'
    and payment.payment_type = 'progress'
    and payment.voided_at is null;

  if matching_payments = 0 then
    return;
  end if;
  if matching_payments <> 1 then
    raise exception 'Expected one matching PRO-0002 payment, found %.', matching_payments;
  end if;

  select payment.* into target_payment
  from public.payments payment
  join public.projects project
    on project.id = payment.project_id
   and project.organization_id = payment.organization_id
  where project.prefix = 'PRO'
    and payment.receipt_number = 'PRO-0002'
    and payment.payment_type = 'progress'
    and payment.voided_at is null
  for update of payment;

  select project.name, project.prefix
    into project_name, configured_prefix
  from public.projects project
  where project.id = target_payment.project_id
    and project.organization_id = target_payment.organization_id;

  project_prefix := left(regexp_replace(upper(project_name), '[^[:alpha:]]', '', 'g'), 3);
  if project_prefix = '' then
    project_prefix := left(regexp_replace(upper(coalesce(configured_prefix, '')), '[^[:alpha:]]', '', 'g'), 3);
  end if;
  if project_prefix = '' then
    raise exception 'Project name or prefix must contain letters to generate an acknowledgement receipt number.';
  end if;

  select billing.id, billing.amount_for_billing
    into target_billing_id, billing_amount
  from public.progress_billings billing
  where billing.project_id = target_payment.project_id
    and billing.billing_number = 1
    and billing.status = 'issued'
  for update;

  if target_billing_id is null then
    raise exception 'Could not find issued Billing #001 for the PRO-0002 payment.';
  end if;

  select count(*)
    into payment_allocation_count
  from public.payment_allocations allocation
  where allocation.payment_id = target_payment.id;

  if payment_allocation_count > 1 then
    raise exception 'The PRO-0002 payment already has multiple billing allocations.';
  end if;
  if payment_allocation_count = 1 then
    if not exists (
      select 1
      from public.payment_allocations allocation
      where allocation.payment_id = target_payment.id
        and allocation.billing_id = target_billing_id
        and allocation.amount = target_payment.amount
    ) then
      raise exception 'The PRO-0002 payment already has a different billing allocation.';
    end if;
  else
    select coalesce(sum(allocation.amount), 0)
      into billing_allocated_amount
    from public.payment_allocations allocation
    join public.payments payment on payment.id = allocation.payment_id
    where allocation.billing_id = target_billing_id
      and payment.voided_at is null;

    if billing_allocated_amount + target_payment.amount > billing_amount then
      raise exception 'Billing #001 does not have enough remaining balance for the PRO-0002 payment.';
    end if;

    insert into public.payment_allocations (
      organization_id, project_id, payment_id, billing_id, amount
    ) values (
      target_payment.organization_id, target_payment.project_id,
      target_payment.id, target_billing_id, target_payment.amount
    );
  end if;

  select exists (
    select 1
    from public.payments payment
    where payment.project_id = target_payment.project_id
      and payment.receipt_number = project_prefix || '-AR-0002'
      and payment.id <> target_payment.id
  ) into existing_receipt;

  if existing_receipt then
    raise exception 'Receipt number % already exists for this project.', project_prefix || '-AR-0002';
  end if;

  alter table public.payments disable trigger protect_payment_before_update;
  update public.payments
  set receipt_number = project_prefix || '-AR-0002'
  where id = target_payment.id
    and project_id = target_payment.project_id;
  alter table public.payments enable trigger protect_payment_before_update;
end;
$$;
