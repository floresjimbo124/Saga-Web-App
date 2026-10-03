create or replace function public.record_project_payment_with_allocations(
  p_project_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_received_date date,
  p_payment_mode text,
  p_payer_name text,
  p_reference text default null,
  p_allocations jsonb default '[]'::jsonb
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
  if p_allocations is null or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Payment allocations must be provided as a list.';
  end if;

  select p.organization_id into project_organization_id
  from public.projects p
  where p.id = p_project_id;

  if project_organization_id is null then
    raise exception 'Project was not found.';
  end if;
  if jsonb_array_length(p_allocations) > 0
    and not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can allocate payments to billings.';
  end if;

  select r.payment_id, r.receipt_number into recorded_payment
  from public.record_project_payment(
    p_project_id,
    p_payment_type,
    p_amount,
    p_received_date,
    p_payment_mode,
    p_payer_name,
    p_reference
  ) r;

  for allocation_row in
    select x.billing_id, sum(x.amount) as amount
    from jsonb_to_recordset(p_allocations) as x(billing_id uuid, amount numeric)
    group by x.billing_id
    order by x.billing_id
  loop
    if allocation_row.billing_id is null
      or allocation_row.amount is null
      or allocation_row.amount <= 0
      or allocation_row.amount = 'NaN'::numeric then
      raise exception 'Each allocation must have a billing and an amount greater than zero.';
    end if;

    select b.amount_for_billing into billing_amount
    from public.progress_billings b
    where b.id = allocation_row.billing_id
      and b.project_id = p_project_id
      and b.status = 'issued'
    for update;

    if not found then
      raise exception 'An allocation must target an issued billing in this project.';
    end if;

    select coalesce(sum(a.amount), 0) into previously_allocated
    from public.payment_allocations a
    join public.payments payment on payment.id = a.payment_id
    where a.billing_id = allocation_row.billing_id
      and payment.voided_at is null;

    if previously_allocated + allocation_row.amount > billing_amount then
      raise exception 'Allocation exceeds the remaining recorded balance on billing %.', allocation_row.billing_id;
    end if;

    allocation_total := allocation_total + allocation_row.amount;
    if allocation_total > p_amount then
      raise exception 'Billing allocations cannot exceed the payment amount.';
    end if;

    insert into public.payment_allocations (
      organization_id, project_id, payment_id, billing_id, amount
    ) values (
      project_organization_id, p_project_id, recorded_payment.payment_id,
      allocation_row.billing_id, allocation_row.amount
    );
  end loop;

  return query select recorded_payment.payment_id, recorded_payment.receipt_number;
end;
$$;

revoke all on function public.record_project_payment_with_allocations(uuid, text, numeric, date, text, text, text, jsonb) from public;
grant execute on function public.record_project_payment_with_allocations(uuid, text, numeric, date, text, text, text, jsonb) to authenticated;