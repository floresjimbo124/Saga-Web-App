create table public.project_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  change_order_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  progress_percent numeric(5, 2) not null default 0 check (progress_percent between 0 and 100),
  retention_rate_percent numeric(5, 2) not null default 5 check (retention_rate_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_order_id),
  unique (id, project_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  foreign key (change_order_id, project_id)
    references public.project_change_orders (id, project_id) on delete cascade
);

insert into public.project_contracts (organization_id, project_id, change_order_id, amount, retention_rate_percent, created_at)
select orders.organization_id, orders.project_id, orders.id, orders.amount,
       coalesce(orders.retention_rate_percent, terms.retention_rate_percent, 5), coalesce(orders.decided_at, orders.created_at)
from public.project_change_orders orders
left join public.project_financial_terms terms on terms.project_id = orders.project_id
where orders.status = 'approved'
  and orders.amount > 0
on conflict (change_order_id) do nothing;

create index project_contracts_project_idx on public.project_contracts (project_id, created_at desc);

alter table public.project_contracts enable row level security;
grant select on public.project_contracts to authenticated;
create policy project_contracts_project_read on public.project_contracts
  for select to authenticated using (public.can_manage_project(project_id));

alter table public.progress_billings add column contract_id uuid;
alter table public.progress_billings
  add constraint progress_billings_contract_project_fk
  foreign key (contract_id, project_id)
  references public.project_contracts (id, project_id) on delete cascade;
alter table public.progress_billings drop constraint progress_billings_project_id_billing_number_key;
create unique index progress_billings_project_original_number_unique
  on public.progress_billings (project_id, billing_number) where contract_id is null;
create unique index progress_billings_contract_number_unique
  on public.progress_billings (project_id, contract_id, billing_number) where contract_id is not null;
create index progress_billings_contract_status_idx
  on public.progress_billings (contract_id, status, due_at) where contract_id is not null;

alter table public.payments add column contract_id uuid;
alter table public.payments
  add constraint payments_contract_project_fk
  foreign key (contract_id, project_id)
  references public.project_contracts (id, project_id) on delete cascade;
create index payments_contract_received_idx on public.payments (contract_id, received_at desc) where contract_id is not null;

alter table public.project_expenses add column contract_id uuid;
alter table public.project_expenses
  add constraint project_expenses_contract_project_fk
  foreign key (contract_id, project_id)
  references public.project_contracts (id, project_id) on delete cascade;
create index project_expenses_contract_date_idx
  on public.project_expenses (contract_id, expense_date desc, created_at desc) where contract_id is not null;

create or replace function public.respond_to_change_order(
  p_change_order_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  decided_order record;
  contract_retention numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  update public.project_change_orders co
  set status = case when p_approved then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  from public.projects p
  join public.client_user_access a
    on a.organization_id = p.organization_id
   and a.project_id = p.id
   and a.user_id = (select auth.uid())
  where co.id = p_change_order_id
    and p.id = co.project_id
    and co.status = 'pending_approval'
  returning co.organization_id, co.project_id, co.id, co.amount into decided_order;

  if not found then
    raise exception 'Change order is unavailable or has already been decided.';
  end if;

  if p_approved then
    select terms.retention_rate_percent into contract_retention
    from public.project_financial_terms terms
    where terms.project_id = decided_order.project_id;

    insert into public.project_contracts (
      organization_id, project_id, change_order_id, amount, retention_rate_percent
    ) values (
      decided_order.organization_id, decided_order.project_id, decided_order.id,
      decided_order.amount, coalesce(contract_retention, 5)
    );
  end if;
end;
$$;

revoke all on function public.respond_to_change_order(uuid, boolean, text) from public;
grant execute on function public.respond_to_change_order(uuid, boolean, text) to authenticated;

create or replace function public.update_project_contract_progress(
  p_project_id uuid,
  p_contract_id uuid,
  p_progress_percent numeric,
  p_summary text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to update progress for this project.';
  end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'Progress must be between 0 and 100.';
  end if;

  update public.project_contracts
  set progress_percent = p_progress_percent, updated_at = now()
  where id = p_contract_id and project_id = p_project_id;
  if not found then
    raise exception 'The approved change-order contract was not found.';
  end if;
end;
$$;

revoke all on function public.update_project_contract_progress(uuid, uuid, numeric, text) from public;
grant execute on function public.update_project_contract_progress(uuid, uuid, numeric, text) to authenticated;

create or replace function public.issue_project_contract_billing(
  p_project_id uuid,
  p_contract_id uuid,
  p_due_date date default null
)
returns table(billing_id uuid, billing_number integer, amount_for_billing numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_row record;
  v_payments numeric;
  v_billed_coverage numeric;
  v_earned numeric;
  v_covered numeric;
  v_amount numeric;
  v_number integer;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select contract.id, contract.organization_id, contract.amount,
         contract.progress_percent, contract.retention_rate_percent
  into contract_row
  from public.project_contracts contract
  where contract.id = p_contract_id and contract.project_id = p_project_id
  for update of contract;
  if not found then
    raise exception 'The approved change-order contract was not found.';
  end if;
  if not public.has_org_role(contract_row.organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can issue a billing.';
  end if;

  v_earned := least(
    round(contract_row.amount * contract_row.progress_percent / 100),
    round(contract_row.amount * (100 - contract_row.retention_rate_percent) / 100)
  );
  select coalesce(sum(payment.amount), 0) into v_payments
  from public.payments payment
  where payment.project_id = p_project_id
    and payment.contract_id = p_contract_id
    and payment.voided_at is null;
  select coalesce(max(billing.earned_to_date), 0) into v_billed_coverage
  from public.progress_billings billing
  where billing.project_id = p_project_id
    and billing.contract_id = p_contract_id
    and billing.status = 'issued';

  v_covered := greatest(v_payments, v_billed_coverage);
  v_amount := greatest(0, v_earned - v_covered);
  if v_amount <= 0 then
    raise exception 'Nothing new to bill at % percent. Increase the contract progress first.', contract_row.progress_percent;
  end if;

  select coalesce(max(billing.billing_number), 0) + 1 into v_number
  from public.progress_billings billing
  where billing.project_id = p_project_id and billing.contract_id = p_contract_id;

  insert into public.progress_billings (
    organization_id, project_id, contract_id, billing_number, status, progress_percent,
    earned_to_date, payments_received_to_date, retention_withheld,
    amount_for_billing, issued_at, due_at, created_by
  ) values (
    contract_row.organization_id, p_project_id, p_contract_id, v_number, 'issued',
    contract_row.progress_percent, v_earned, v_payments,
    round(contract_row.amount * contract_row.retention_rate_percent / 100),
    v_amount, now(), p_due_date, (select auth.uid())
  )
  returning id into v_id;

  return query select v_id, v_number, v_amount;
end;
$$;

revoke all on function public.issue_project_contract_billing(uuid, uuid, date) from public;
grant execute on function public.issue_project_contract_billing(uuid, uuid, date) to authenticated;

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
  v_contract_value numeric;
  v_retention_cap numeric;
  v_released numeric;
  v_held numeric;
  v_ceiling numeric;
  v_billable_earned numeric;
  v_payments numeric;
  v_billed_coverage numeric;
  v_covered numeric;
  v_down_payment numeric;
  v_amount numeric;
  v_number integer;
  v_id uuid;
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select project.organization_id, project.progress_percent
  into project_organization_id, v_progress
  from public.projects project where project.id = p_project_id for update;
  if project_organization_id is null then raise exception 'Project was not found.'; end if;
  if not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can issue a billing.';
  end if;

  select terms.contract_amount, terms.special_discount, terms.retention_rate_percent, terms.down_payment_percent
  into v_contract, v_discount, v_retention_rate, v_down_payment_percent
  from public.project_financial_terms terms where terms.project_id = p_project_id;
  if v_contract is null then raise exception 'Set up the contract amount before issuing a billing.'; end if;

  v_contract_value := v_contract - coalesce(v_discount, 0);
  v_down_payment := round(v_contract_value * coalesce(v_down_payment_percent, 0) / 100);
  v_retention_cap := round(v_contract_value * v_retention_rate / 100);
  select coalesce(sum(case when ledger.entry_type = 'released' then ledger.amount end), 0),
         coalesce(sum(case when ledger.entry_type = 'held' then ledger.amount
                           when ledger.entry_type = 'released' then -ledger.amount else 0 end), 0)
  into v_released, v_held
  from public.retention_ledger ledger where ledger.project_id = p_project_id;
  v_ceiling := v_contract_value - (v_retention_cap - v_released);
  v_billable_earned := least(round(v_contract_value * v_progress / 100), v_ceiling);

  select coalesce(sum(payment.amount), 0) into v_payments
  from public.payments payment
  where payment.project_id = p_project_id and payment.contract_id is null and payment.voided_at is null;
  select coalesce(max(billing.earned_to_date), 0) into v_billed_coverage
  from public.progress_billings billing
  where billing.project_id = p_project_id and billing.contract_id is null and billing.status = 'issued';
  v_covered := greatest(v_payments, v_billed_coverage, v_down_payment);
  v_amount := greatest(0, v_billable_earned - v_covered);
  if v_amount <= 0 then
    raise exception 'Nothing new to bill at % percent. Work earned (PHP %) must be more than the PHP % already covered.',
      v_progress, to_char(v_billable_earned, 'FM999,999,999,990'), to_char(v_covered, 'FM999,999,999,990');
  end if;

  select coalesce(max(billing.billing_number), 0) + 1 into v_number
  from public.progress_billings billing
  where billing.project_id = p_project_id and billing.contract_id is null;
  insert into public.progress_billings (
    organization_id, project_id, billing_number, status, progress_percent,
    earned_to_date, payments_received_to_date, retention_withheld,
    amount_for_billing, issued_at, due_at, created_by
  ) values (
    project_organization_id, p_project_id, v_number, 'issued', v_progress,
    v_billable_earned, v_payments, greatest(0, v_held), v_amount,
    now(), p_due_date, actor_id
  ) returning id into v_id;
  return query select v_id, v_number, v_amount;
end;
$$;

revoke all on function public.issue_progress_billing(uuid, date) from public;
grant execute on function public.issue_progress_billing(uuid, date) to authenticated;

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
  ) then
    raise exception 'The approved change-order contract was not found in this project.';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Payment allocations must be provided as a list.';
  end if;
  if jsonb_array_length(p_allocations) > 0
    and not public.has_org_role(project_organization_id, array['owner']::public.org_role[]) then
    raise exception 'Only an owner can allocate payments to billings.';
  end if;

  select result.payment_id, result.receipt_number into recorded_payment
  from public.record_project_payment(
    p_project_id, p_payment_type, p_amount, p_received_date,
    p_payment_mode, p_payer_name, p_reference
  ) result;
  if p_contract_id is not null then
    update public.payments set contract_id = p_contract_id where id = recorded_payment.payment_id;
  end if;

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

create or replace function public.record_project_contract_expenses(p_contract_id uuid, p_expenses jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  contract_row record;
  expense_row jsonb;
  expense_date date;
  category text;
  description text;
  vendor text;
  amount numeric;
  inserted_count integer := 0;
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select contract.project_id, contract.organization_id into contract_row
  from public.project_contracts contract where contract.id = p_contract_id;
  if not found then raise exception 'The approved change-order contract was not found.'; end if;
  if not public.can_manage_project(contract_row.project_id) then
    raise exception 'You do not have permission to log expenses for this project.';
  end if;
  if jsonb_typeof(p_expenses) is distinct from 'array' or jsonb_array_length(p_expenses) = 0 then
    raise exception 'Add at least one expense row.';
  end if;

  for expense_row in select value from jsonb_array_elements(p_expenses)
  loop
    expense_date := nullif(trim(coalesce(expense_row->>'expense_date', '')), '')::date;
    category := nullif(trim(coalesce(expense_row->>'category', '')), '');
    description := trim(coalesce(expense_row->>'description', ''));
    vendor := nullif(trim(coalesce(expense_row->>'vendor', '')), '');
    amount := nullif(trim(coalesce(expense_row->>'amount', '')), '')::numeric;
    if expense_date is null then raise exception 'Expense date is required for every row.'; end if;
    if category is null or category not in (
      'materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract',
      'rent', 'equipment', 'transport', 'permits', 'other'
    ) then raise exception 'Choose a supported expense category for every row.'; end if;
    if amount is null or amount <= 0 or amount = 'NaN'::numeric then raise exception 'Every expense amount must be greater than zero.'; end if;
    if length(description) not between 2 and 500 then raise exception 'Every expense description must contain between 2 and 500 characters.'; end if;
    if vendor is not null and length(vendor) > 150 then raise exception 'Vendor names must not exceed 150 characters.'; end if;
    insert into public.project_expenses (
      organization_id, project_id, contract_id, expense_date, category, description, vendor, amount, created_by
    ) values (
      contract_row.organization_id, contract_row.project_id, p_contract_id,
      expense_date, category, description, vendor, amount, actor_id
    );
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.record_project_contract_expenses(uuid, jsonb) from public;
grant execute on function public.record_project_contract_expenses(uuid, jsonb) to authenticated;
