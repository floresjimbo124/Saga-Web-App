-- Project access for assigned team staff (liaison officer, engineer).
-- Assigned staff can VIEW everything the owner sees on their projects and ADD records
-- (expenses, receipts, payments, billings, change-order drafts, milestones, photos, documents),
-- but cannot edit, void or delete anything, and cannot change project settings.

create table if not exists public.project_staff_access (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_staff_access_user_idx on public.project_staff_access (user_id);
alter table public.project_staff_access enable row level security;
revoke all on public.project_staff_access from anon;
revoke truncate, trigger, references on public.project_staff_access from authenticated;

create policy project_staff_access_owner_all on public.project_staff_access
for all to authenticated
using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy project_staff_access_self_read on public.project_staff_access
for select to authenticated
using (user_id = (select auth.uid()));

-- True when the caller is a liaison officer or engineer assigned to the project.
create or replace function public.is_project_staff(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_staff_access access
    join public.projects project on project.id = access.project_id and project.organization_id = access.organization_id
    join public.organization_memberships membership
      on membership.organization_id = access.organization_id
     and membership.user_id = access.user_id
    where access.project_id = p_project_id
      and access.user_id = (select auth.uid())
      and membership.role = 'site_staff'
      and membership.staff_title in ('liaison_officer', 'engineer')
  );
$$;

-- Owners (and legacy untitled site staff) manage; assigned staff may add.
create or replace function public.can_add_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_project(p_project_id) or public.is_project_staff(p_project_id);
$$;

revoke all on function public.is_project_staff(uuid) from public, anon;
revoke all on function public.can_add_to_project(uuid) from public, anon;
grant execute on function public.is_project_staff(uuid) to authenticated;
grant execute on function public.can_add_to_project(uuid) to authenticated;

-- Read access to project data (same view as the owner, nothing else).
create policy projects_assigned_staff_read on public.projects for select to authenticated using (public.is_project_staff(id));
create policy clients_assigned_staff_read on public.clients for select to authenticated using (
  exists (select 1 from public.projects project where project.client_id = clients.id and public.is_project_staff(project.id))
);

create policy payments_assigned_staff_read on public.payments for select to authenticated using (public.is_project_staff(project_id));
create policy payment_allocations_assigned_staff_read on public.payment_allocations for select to authenticated using (public.is_project_staff(project_id));
create policy progress_billings_assigned_staff_read on public.progress_billings for select to authenticated using (public.is_project_staff(project_id));
create policy project_change_orders_assigned_staff_read on public.project_change_orders for select to authenticated using (public.is_project_staff(project_id));
create policy project_contracts_assigned_staff_read on public.project_contracts for select to authenticated using (public.is_project_staff(project_id));
create policy project_cost_forecasts_assigned_staff_read on public.project_cost_forecasts for select to authenticated using (public.is_project_staff(project_id));
create policy project_documents_assigned_staff_read on public.project_documents for select to authenticated using (public.is_project_staff(project_id));
create policy project_expenses_assigned_staff_read on public.project_expenses for select to authenticated using (public.is_project_staff(project_id));
create policy project_financial_terms_assigned_staff_read on public.project_financial_terms for select to authenticated using (public.is_project_staff(project_id));
create policy project_milestones_assigned_staff_read on public.project_milestones for select to authenticated using (public.is_project_staff(project_id));
create policy project_progress_updates_assigned_staff_read on public.project_progress_updates for select to authenticated using (public.is_project_staff(project_id));
create policy retention_ledger_assigned_staff_read on public.retention_ledger for select to authenticated using (public.is_project_staff(project_id));

-- Direct inserts the app makes (no update/delete policies are added for staff).
create policy project_milestones_assigned_staff_insert on public.project_milestones for insert to authenticated
  with check (public.is_project_staff(project_id));
create policy project_documents_assigned_staff_insert on public.project_documents for insert to authenticated
  with check (public.is_project_staff(project_id));

-- Attach a completed milestone's photo. Owners may attach or replace; staff may only add one.
create or replace function public.attach_project_milestone_photo(p_milestone_id uuid, p_storage_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  milestone_row record;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  select milestone.project_id, milestone.organization_id, milestone.status, milestone.photo_storage_path
  into milestone_row
  from public.project_milestones milestone
  where milestone.id = p_milestone_id
  for update;
  if not found then raise exception 'Milestone was not found.'; end if;
  if milestone_row.status <> 'complete' then raise exception 'Save the milestone as complete before attaching a photo.'; end if;
  if not (public.can_manage_project(milestone_row.project_id)
          or (public.is_project_staff(milestone_row.project_id) and milestone_row.photo_storage_path is null)) then
    raise exception 'You do not have permission to change this milestone photo.';
  end if;
  if p_storage_path is null or p_storage_path not like milestone_row.organization_id::text || '/' || milestone_row.project_id::text || '/milestones/' || p_milestone_id::text || '/%' then
    raise exception 'Photo must be stored under this milestone''s folder.';
  end if;
  update public.project_milestones set photo_storage_path = p_storage_path where id = p_milestone_id;
end;
$$;
revoke all on function public.attach_project_milestone_photo(uuid, text) from public, anon;
grant execute on function public.attach_project_milestone_photo(uuid, text) to authenticated;

-- Storage: staff can upload and view files of their projects, never delete or overwrite.
create or replace function public.is_project_staff_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := string_to_array(p_object_name, '/');
  path_project_id uuid;
begin
  if coalesce(array_length(parts, 1), 0) < 3 then return false; end if;
  begin
    path_project_id := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.projects project
    where project.id = path_project_id and project.organization_id::text = parts[1]
  ) and public.is_project_staff(path_project_id);
end;
$$;
revoke all on function public.is_project_staff_object(text) from public, anon;
grant execute on function public.is_project_staff_object(text) to authenticated;

create policy project_documents_assigned_staff_object_read on storage.objects for select to authenticated
  using (bucket_id = 'project-documents' and public.is_project_staff_object(name));
create policy project_documents_assigned_staff_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-documents' and public.is_project_staff_object(name));
create policy expense_receipts_assigned_staff_object_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-receipts' and public.is_project_staff_object(name));
create policy expense_receipts_assigned_staff_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-receipts' and (string_to_array(name, '/'))[3] = 'receipts' and public.is_project_staff_object(name));

-- Owner: choose which projects a staff member can open.
create or replace function public.set_project_staff_access(p_user_id uuid, p_project_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid := '10000000-0000-4000-8000-000000000001';
begin
  if not public.has_org_role(org_id, array['owner']::public.org_role[]) then
    raise exception 'Only a workspace owner can change project access.';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = org_id and membership.user_id = p_user_id
      and membership.role = 'site_staff' and membership.staff_title in ('liaison_officer', 'engineer')
  ) then
    raise exception 'Project access can only be given to the liaison officer or engineer.';
  end if;
  if exists (select 1 from unnest(coalesce(p_project_ids, '{}')) as requested(id)
             where not exists (select 1 from public.projects project where project.id = requested.id and project.organization_id = org_id)) then
    raise exception 'One of the selected projects was not found.';
  end if;
  delete from public.project_staff_access access
  where access.organization_id = org_id and access.user_id = p_user_id
    and not (access.project_id = any (coalesce(p_project_ids, '{}')));
  insert into public.project_staff_access (organization_id, project_id, user_id)
  select org_id, requested.id, p_user_id from unnest(coalesce(p_project_ids, '{}')) as requested(id)
  on conflict (project_id, user_id) do nothing;
end;
$$;
revoke all on function public.set_project_staff_access(uuid, uuid[]) from public, anon;
grant execute on function public.set_project_staff_access(uuid, uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.create_project_change_order(p_project_id uuid, p_line_items jsonb, p_contract_time_adjustment_days integer)
 RETURNS TABLE(id uuid, order_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  next_order_number integer;
  new_change_order_id uuid;
  line_item jsonb;
  line_number integer := 0;
  total_amount numeric := 0;
  normalized_title text;
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select project.organization_id into project_organization_id
  from public.projects project
  where project.id = p_project_id
  for update;
  if project_organization_id is null then raise exception 'Project was not found.'; end if;
  if not public.can_add_to_project(p_project_id) then
    raise exception 'You do not have permission to add change orders to this project.';
  end if;
  if p_line_items is null or jsonb_typeof(p_line_items) is distinct from 'array' then
    raise exception 'Change-order items must be provided as a list.';
  end if;
  if jsonb_array_length(p_line_items) = 0 or jsonb_array_length(p_line_items) > 100 then
    raise exception 'Add between one and 100 change-order items.';
  end if;
  if p_contract_time_adjustment_days is null then
    raise exception 'Contract time adjustment must be entered in whole days.';
  end if;

  for line_item in select line_items.value from jsonb_array_elements(p_line_items) as line_items(value)
  loop
    line_number := line_number + 1;
    if jsonb_typeof(line_item) <> 'object'
       or length(trim(coalesce(line_item ->> 'item', ''))) not between 1 and 150
       or length(coalesce(line_item ->> 'description', '')) > 2000
       or length(coalesce(line_item ->> 'remarks', '')) > 2000 then
      raise exception 'Change-order item % has invalid item, description, or remarks.', line_number;
    end if;
    begin
      if coalesce(line_item ->> 'cost', '') = '' then
        raise exception 'Cost is required.';
      end if;
      if (line_item ->> 'cost')::numeric <= 0
         or (line_item ->> 'cost')::numeric = 'NaN'::numeric
         or (line_item ->> 'cost')::numeric > 999999999999.99 then
        raise exception 'Cost must be greater than zero and within the supported range.';
      end if;
      total_amount := total_amount + (line_item ->> 'cost')::numeric;
    exception when invalid_text_representation then
      raise exception 'Change-order item % must have a valid numeric cost.', line_number;
    end;
  end loop;
  if total_amount > 999999999999.99 then
    raise exception 'The change-order total exceeds the supported amount.';
  end if;

  normalized_title := trim(p_line_items -> 0 ->> 'item');

  select coalesce(max(change_order.order_number), 0) + 1
  into next_order_number
  from public.project_change_orders change_order
  where change_order.project_id = p_project_id;

  insert into public.project_change_orders (
    organization_id, project_id, order_number, title, description, amount,
    line_items, contract_time_adjustment_days, status, created_by
  ) values (
    project_organization_id, p_project_id, next_order_number, normalized_title,
    null, total_amount, p_line_items,
    p_contract_time_adjustment_days, 'draft', actor_id
  )
  returning project_change_orders.id into new_change_order_id;

  return query select new_change_order_id, next_order_number;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_billing_readiness(p_project_id uuid)
 RETURNS TABLE(progress_percent numeric, contract_value numeric, billable_ceiling numeric, billable_earned numeric, covered_amount numeric, ready_amount numeric, progress_needed_percent numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_progress numeric;
  v_contract numeric;
  v_discount numeric;
  v_retention_rate numeric;
  v_down_payment_percent numeric;
  v_contract_value numeric;
  v_retention_cap numeric;
  v_released numeric;
  v_ceiling numeric;
  v_billable_earned numeric;
  v_payments numeric;
  v_billed_coverage numeric;
  v_covered numeric;
  v_down_payment numeric;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  if not public.can_add_to_project(p_project_id) then
    raise exception 'You do not have permission to view billing for this project.';
  end if;

  select project.progress_percent into v_progress from public.projects project where project.id = p_project_id;
  select terms.contract_amount, terms.special_discount, terms.retention_rate_percent, terms.down_payment_percent
  into v_contract, v_discount, v_retention_rate, v_down_payment_percent
  from public.project_financial_terms terms where terms.project_id = p_project_id;
  if v_contract is null then return; end if;

  v_contract_value := v_contract - coalesce(v_discount, 0);
  v_down_payment := round(v_contract_value * coalesce(v_down_payment_percent, 0) / 100);
  v_retention_cap := round(v_contract_value * v_retention_rate / 100);
  select coalesce(sum(case when ledger.entry_type = 'released' then ledger.amount end), 0)
  into v_released
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

  return query select
    v_progress,
    v_contract_value,
    v_ceiling,
    v_billable_earned,
    v_covered,
    greatest(0, v_billable_earned - v_covered),
    case
      when v_contract_value <= 0 or v_covered >= v_ceiling then null
      else least(100, ceil((v_covered + 1) / v_contract_value * 10000) / 100)
    end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_project_contract_expenses(p_contract_id uuid, p_expenses jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.can_add_to_project(contract_row.project_id) then
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
      'rent', 'equipment', 'transport', 'hauling', 'food_drinks', 'permits', 'other'
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
$function$;

CREATE OR REPLACE FUNCTION public.record_project_expense(p_project_id uuid, p_expense_date date, p_category text, p_description text, p_vendor text, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  new_expense_id uuid;
  normalized_description text := trim(coalesce(p_description, ''));
  normalized_vendor text := nullif(trim(coalesce(p_vendor, '')), '');
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
  if not public.can_add_to_project(p_project_id) then
    raise exception 'You do not have permission to log expenses for this project.';
  end if;
  if p_expense_date is null then
    raise exception 'Expense date is required.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;
  if p_category is null or p_category not in (
    'materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract',
    'rent', 'equipment', 'transport', 'hauling', 'food_drinks', 'permits', 'other'
  ) then
    raise exception 'Choose a supported expense category.';
  end if;
  if length(normalized_description) not between 2 and 500 then
    raise exception 'Description must contain between 2 and 500 characters.';
  end if;
  if normalized_vendor is not null and length(normalized_vendor) > 150 then
    raise exception 'Vendor name must not exceed 150 characters.';
  end if;

  insert into public.project_expenses (
    organization_id, project_id, expense_date, category,
    description, vendor, amount, created_by
  ) values (
    project_organization_id, p_project_id, p_expense_date, p_category,
    normalized_description, normalized_vendor, p_amount, actor_id
  ) returning id into new_expense_id;

  return new_expense_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_project_expenses(p_expenses jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  expense_row jsonb;
  project_id uuid;
  project_organization_id uuid;
  expense_date date;
  category text;
  description text;
  vendor text;
  amount numeric;
  inserted_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authentication is required.';
  end if;
  if jsonb_typeof(p_expenses) is distinct from 'array'
    or jsonb_array_length(p_expenses) = 0 then
    raise exception 'Add at least one expense row.';
  end if;

  for expense_row in select value from jsonb_array_elements(p_expenses)
  loop
    if jsonb_typeof(expense_row) is distinct from 'object' then
      raise exception 'Each expense row must be an object.';
    end if;

    project_id := nullif(trim(coalesce(expense_row->>'project_id', '')), '')::uuid;
    expense_date := nullif(trim(coalesce(expense_row->>'expense_date', '')), '')::date;
    category := nullif(trim(coalesce(expense_row->>'category', '')), '');
    description := trim(coalesce(expense_row->>'description', ''));
    vendor := nullif(trim(coalesce(expense_row->>'vendor', '')), '');
    amount := nullif(trim(coalesce(expense_row->>'amount', '')), '')::numeric;

    if project_id is null then
      raise exception 'Every expense must be assigned to a project.';
    end if;
    select p.organization_id into project_organization_id
    from public.projects p
    where p.id = project_id;
    if project_organization_id is null then
      raise exception 'Project % was not found.', project_id;
    end if;
    if not public.can_add_to_project(project_id) then
      raise exception 'You do not have permission to log expenses for project %.', project_id;
    end if;
    if expense_date is null then
      raise exception 'Expense date is required for every row.';
    end if;
    if category is null or category not in (
      'materials', 'labor', 'operational_expenses', 'payroll', 'sub_contract',
      'rent', 'equipment', 'transport', 'hauling', 'food_drinks', 'permits', 'other'
    ) then
      raise exception 'Choose a supported expense category for every row.';
    end if;
    if amount is null or amount <= 0 or amount = 'NaN'::numeric then
      raise exception 'Every expense amount must be greater than zero.';
    end if;
    if length(description) not between 2 and 500 then
      raise exception 'Every expense description must contain between 2 and 500 characters.';
    end if;
    if vendor is not null and length(vendor) > 150 then
      raise exception 'Vendor names must not exceed 150 characters.';
    end if;

    insert into public.project_expenses (
      organization_id, project_id, expense_date, category,
      description, vendor, amount, created_by
    ) values (
      project_organization_id, project_id, expense_date, category,
      description, vendor, amount, actor_id
    );
    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_project_payment(p_project_id uuid, p_payment_type text, p_amount numeric, p_received_date date, p_payment_mode text, p_payer_name text, p_reference text DEFAULT NULL::text)
 RETURNS TABLE(payment_id uuid, receipt_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.can_add_to_project(p_project_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.record_project_payment_for_contract(p_project_id uuid, p_payment_type text, p_amount numeric, p_received_date date, p_payment_mode text, p_payer_name text, p_reference text, p_contract_id uuid)
 RETURNS TABLE(payment_id uuid, receipt_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.can_add_to_project(p_project_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.issue_progress_billing(p_project_id uuid, p_due_date date DEFAULT NULL::date)
 RETURNS TABLE(billing_id uuid, billing_number integer, amount_for_billing numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not (public.has_org_role(project_organization_id, array['owner']::public.org_role[]) or public.is_project_staff(p_project_id)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.issue_project_contract_billing(p_project_id uuid, p_contract_id uuid, p_due_date date DEFAULT NULL::date)
 RETURNS TABLE(billing_id uuid, billing_number integer, amount_for_billing numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not (public.has_org_role(contract_row.organization_id, array['owner']::public.org_role[]) or public.is_project_staff(p_project_id)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.record_project_payment_with_allocations(p_project_id uuid, p_payment_type text, p_amount numeric, p_received_date date, p_payment_mode text, p_payer_name text, p_reference text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(payment_id uuid, receipt_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and not (public.has_org_role(project_organization_id, array['owner']::public.org_role[]) or public.is_project_staff(p_project_id)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.record_project_payment_with_allocations(p_project_id uuid, p_payment_type text, p_amount numeric, p_received_date date, p_payment_mode text, p_payer_name text, p_reference text, p_allocations jsonb, p_contract_id uuid)
 RETURNS TABLE(payment_id uuid, receipt_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and not (public.has_org_role(project_organization_id, array['owner']::public.org_role[]) or public.is_project_staff(p_project_id)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.set_project_expense_receipt(p_expense_id uuid, p_receipt_storage_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  expense_row record;
  normalized_path text := nullif(trim(coalesce(p_receipt_storage_path, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select expense.project_id, expense.organization_id, expense.receipt_storage_path into expense_row
  from public.project_expenses expense
  where expense.id = p_expense_id
  for update;

  if not found then
    raise exception 'Expense was not found.';
  end if;
  if not (public.can_manage_project(expense_row.project_id)
          or (public.is_project_staff(expense_row.project_id) and expense_row.receipt_storage_path is null and normalized_path is not null)) then
    raise exception 'You do not have permission to edit expenses for this project.';
  end if;
  if normalized_path is not null
    and normalized_path not like expense_row.organization_id::text || '/' || expense_row.project_id::text || '/receipts/%' then
    raise exception 'Receipt must be stored under this project''s receipts folder.';
  end if;

  update public.project_expenses
  set receipt_storage_path = normalized_path
  where id = p_expense_id;
end;
$function$;
