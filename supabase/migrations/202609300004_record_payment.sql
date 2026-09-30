create or replace function public.record_project_payment(
  p_project_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_received_date date,
  p_payment_mode text,
  p_payer_name text,
  p_reference text default null
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
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  select p.organization_id, o.timezone
  into project_organization_id, organization_timezone
  from public.projects p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_project_id;

  if project_organization_id is null then
    raise exception 'Project was not found.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to log payments for this project.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_received_date is null then
    raise exception 'Payment date is required.';
  end if;
  if p_payment_type not in ('down_payment', 'progress', 'other') then
    raise exception 'Choose a supported payment type. Retention releases use a separate workflow.';
  end if;
  if p_payment_mode not in ('cash', 'bank_transfer', 'check', 'card', 'other') then
    raise exception 'Choose a supported payment method.';
  end if;
  if length(normalized_payer) < 2 then
    raise exception 'Payer name must contain at least two characters.';
  end if;

  insert into public.payments (
    organization_id, project_id, payment_type, amount, received_at,
    payment_mode, payer_name, reference, created_by
  ) values (
    project_organization_id, p_project_id, p_payment_type, p_amount,
    p_received_date::timestamp at time zone coalesce(organization_timezone, 'Asia/Manila'),
    p_payment_mode, normalized_payer, nullif(trim(coalesce(p_reference, '')), ''), actor_id
  )
  returning id, payments.receipt_number into new_payment_id, new_receipt_number;

  return query select new_payment_id, new_receipt_number;
end;
$$;

revoke all on function public.record_project_payment(uuid, text, numeric, date, text, text, text) from public;
grant execute on function public.record_project_payment(uuid, text, numeric, date, text, text, text) to authenticated;