-- 1. Billing readiness: the exact calculation issue_progress_billing uses, read-only.
create or replace function public.get_billing_readiness(p_project_id uuid)
returns table (
  progress_percent numeric,
  contract_value numeric,
  billable_ceiling numeric,
  billable_earned numeric,
  covered_amount numeric,
  ready_amount numeric,
  progress_needed_percent numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  if not public.can_manage_project(p_project_id) then
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
$$;

revoke all on function public.get_billing_readiness(uuid) from public, anon;
grant execute on function public.get_billing_readiness(uuid) to authenticated;

-- 2. Also audit expenses and milestones.
drop trigger if exists audit_project_expenses on public.project_expenses;
create trigger audit_project_expenses after insert or update or delete on public.project_expenses
for each row execute function public.write_audit_log();
drop trigger if exists audit_project_milestones on public.project_milestones;
create trigger audit_project_milestones after insert or update or delete on public.project_milestones
for each row execute function public.write_audit_log();

-- 3. Activity history for owners, with readable names.
create or replace function public.get_activity_log(p_limit integer default 50, p_before timestamptz default null)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_name text,
  table_name text,
  operation text,
  project_id uuid,
  project_name text,
  old_data jsonb,
  new_data jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    log.id,
    log.occurred_at,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', auth_user.raw_user_meta_data ->> 'first_name', auth_user.raw_user_meta_data ->> 'last_name')), ''),
      nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
      auth_user.email,
      'System'
    ),
    log.table_name,
    log.operation,
    project.id,
    project.name,
    log.old_data,
    log.new_data
  from public.audit_logs log
  left join public.profiles profile on profile.id = log.actor_id
  left join auth.users auth_user on auth_user.id = log.actor_id
  left join public.projects project on project.id = coalesce(
    nullif(coalesce(log.new_data, log.old_data) ->> 'project_id', '')::uuid,
    case when log.table_name = 'projects' then nullif(log.record_id, '')::uuid end
  )
  where public.has_org_role(log.organization_id, array['owner']::public.org_role[])
    and (p_before is null or log.occurred_at < p_before)
  order by log.occurred_at desc, log.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.get_activity_log(integer, timestamptz) from public, anon;
grant execute on function public.get_activity_log(integer, timestamptz) to authenticated;

-- 4. Client-side error reports (lightweight error monitoring).
create table if not exists public.client_error_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message text not null check (length(message) between 1 and 1000),
  stack text check (stack is null or length(stack) <= 8000),
  page_url text check (page_url is null or length(page_url) <= 1000),
  user_agent text check (user_agent is null or length(user_agent) <= 500),
  occurred_at timestamptz not null default now()
);

alter table public.client_error_logs enable row level security;
revoke all on public.client_error_logs from anon;
revoke truncate, trigger, references on public.client_error_logs from authenticated;

create policy client_error_logs_insert_own on public.client_error_logs
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy client_error_logs_owner_read on public.client_error_logs
for select to authenticated
using (public.has_org_role('10000000-0000-4000-8000-000000000001'::uuid, array['owner']::public.org_role[]));

create index if not exists client_error_logs_occurred_at_idx on public.client_error_logs (occurred_at desc);
