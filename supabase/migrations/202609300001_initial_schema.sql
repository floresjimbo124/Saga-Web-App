create type public.org_role as enum ('owner', 'site_staff');
create type public.retention_method as enum ('final_schedule', 'per_billing');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  email text,
  phone text,
  address text,
  currency_code text not null default 'PHP' check (currency_code ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index organizations_name_lower_unique on public.organizations (lower(name));

create table public.organization_memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  billing_address text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.client_user_access (
  organization_id uuid not null,
  client_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (client_id, organization_id)
    references public.clients (id, organization_id) on delete cascade
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid,
  name text not null,
  prefix text not null check (prefix ~ '^[A-Z]{3}$'),
  location text,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'closed')),
  progress_percent numeric(5, 2) not null default 0
    check (progress_percent between 0 and 100),
  prefix_locked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, prefix),
  foreign key (client_id, organization_id)
    references public.clients (id, organization_id) on delete restrict
);

create table public.project_financial_terms (
  project_id uuid primary key,
  organization_id uuid not null,
  contract_amount numeric(14, 2) check (contract_amount is null or contract_amount >= 0),
  special_discount numeric(14, 2) not null default 0 check (special_discount >= 0),
  down_payment_percent numeric(5, 2) not null default 0
    check (down_payment_percent between 0 and 100),
  retention_rate_percent numeric(5, 2) not null default 5
    check (retention_rate_percent between 0 and 100),
  retention_method public.retention_method not null default 'final_schedule',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  check (contract_amount is null or special_discount <= contract_amount)
);

create table public.project_change_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  title text not null,
  description text,
  amount numeric(14, 2) not null check (amount >= 0),
  retention_rate_percent numeric(5, 2)
    check (retention_rate_percent is null or retention_rate_percent between 0 and 100),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'void')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  name text not null,
  planned_date date,
  actual_date date,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'complete', 'blocked')),
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.project_progress_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  progress_percent numeric(5, 2) not null check (progress_percent between 0 and 100),
  summary text not null,
  client_visible boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.progress_billings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  billing_number integer not null check (billing_number > 0),
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  progress_percent numeric(5, 2) not null check (progress_percent between 0 and 100),
  earned_to_date numeric(14, 2) not null check (earned_to_date >= 0),
  payments_received_to_date numeric(14, 2) not null default 0
    check (payments_received_to_date >= 0),
  retention_withheld numeric(14, 2) not null default 0 check (retention_withheld >= 0),
  amount_for_billing numeric(14, 2) not null check (amount_for_billing >= 0),
  issued_at timestamptz,
  due_at date,
  pdf_storage_path text,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, billing_number),
  unique (id, project_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  receipt_number text,
  payment_type text not null default 'progress'
    check (payment_type in ('down_payment', 'progress', 'retention_release', 'other')),
  amount numeric(14, 2) not null check (amount > 0),
  received_at timestamptz not null default now(),
  payment_mode text not null
    check (payment_mode in ('cash', 'bank_transfer', 'check', 'card', 'other')),
  payer_name text not null,
  reference text,
  receipt_storage_path text,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, receipt_number),
  unique (id, project_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  payment_id uuid not null,
  billing_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, billing_id),
  foreign key (payment_id, project_id)
    references public.payments (id, project_id) on delete restrict,
  foreign key (billing_id, project_id)
    references public.progress_billings (id, project_id) on delete restrict,
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.retention_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  billing_id uuid,
  payment_id uuid,
  entry_type text not null check (entry_type in ('held', 'released', 'adjustment')),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (billing_id, project_id)
    references public.progress_billings (id, project_id) on delete restrict,
  foreign key (payment_id, project_id)
    references public.payments (id, project_id) on delete restrict,
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.project_receipt_counters (
  project_id uuid primary key references public.projects (id) on delete restrict,
  next_number integer not null default 1 check (next_number > 0)
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  contact_name text,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.project_workers (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  worker_id uuid not null,
  assigned_from date not null default current_date,
  assigned_until date,
  primary key (project_id, worker_id, assigned_from),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  foreign key (worker_id, organization_id)
    references public.workers (id, organization_id) on delete cascade,
  check (assigned_until is null or assigned_until >= assigned_from)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  supplier_id uuid,
  category text not null,
  description text not null,
  amount numeric(14, 2) not null check (amount > 0),
  paid_by text not null check (paid_by in ('company', 'owner', 'worker', 'other')),
  incurred_at date not null default current_date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  foreign key (supplier_id, organization_id)
    references public.suppliers (id, organization_id) on delete restrict
);

create table public.project_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  document_type text not null default 'other',
  client_visible boolean not null default false,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  table_name text not null,
  record_id text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index projects_org_client_idx on public.projects (organization_id, client_id);
create index projects_org_status_idx on public.projects (organization_id, status);
create index progress_billings_project_status_idx on public.progress_billings (project_id, status, due_at);
create index payments_project_received_idx on public.payments (project_id, received_at desc);
create index retention_ledger_project_date_idx on public.retention_ledger (project_id, occurred_at);
create index audit_logs_org_date_idx on public.audit_logs (organization_id, occurred_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.org_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create or replace function public.can_access_client(p_organization_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(
      p_organization_id,
      array['owner', 'site_staff']::public.org_role[]
    )
    or exists (
      select 1
      from public.client_user_access a
      where a.organization_id = p_organization_id
        and a.client_id = p_client_id
        and a.user_id = (select auth.uid())
    );
$$;

create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and (
        public.has_org_role(p.organization_id, array['owner', 'site_staff']::public.org_role[])
        or exists (
          select 1
          from public.client_user_access a
          where a.organization_id = p.organization_id
            and a.client_id = p.client_id
            and a.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and public.has_org_role(p.organization_id, array['owner', 'site_staff']::public.org_role[])
  );
$$;

create or replace function public.can_access_project_storage_object(
  p_object_name text,
  p_client_visible_only boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[];
  path_organization_id uuid;
  path_project_id uuid;
begin
  path_parts := string_to_array(p_object_name, '/');
  if coalesce(array_length(path_parts, 1), 0) < 3 then
    return false;
  end if;

  begin
    path_organization_id := path_parts[1]::uuid;
    path_project_id := path_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists (
    select 1
    from public.projects p
    where p.id = path_project_id
      and p.organization_id = path_organization_id
      and (
        public.has_org_role(p.organization_id, array['owner', 'site_staff']::public.org_role[])
        or (
          p_client_visible_only
          and public.can_access_project(p.id)
          and exists (
            select 1
            from public.project_documents d
            where d.project_id = p.id
              and d.organization_id = p.organization_id
              and d.storage_path = p_object_name
              and d.client_visible
          )
        )
      )
  );
end;
$$;

create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to create an organization.';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Organization name must contain at least two characters.';
  end if;

  insert into public.organizations (name)
  values (trim(p_name))
  returning id into new_organization_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, (select auth.uid()), 'owner');

  return new_organization_id;
end;
$$;

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
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  update public.project_change_orders co
  set status = case when p_approved then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()),
      decided_at = now(),
      decision_note = p_note,
      updated_at = now()
  from public.projects p
  join public.client_user_access a
    on a.organization_id = p.organization_id
   and a.client_id = p.client_id
   and a.user_id = (select auth.uid())
  where co.id = p_change_order_id
    and p.id = co.project_id
    and co.status = 'pending_approval';

  if not found then
    raise exception 'Change order is unavailable or has already been decided.';
  end if;
end;
$$;

create or replace function public.assign_payment_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_prefix text;
  allocated_number integer;
begin
  select p.prefix into project_prefix
  from public.projects p
  where p.id = new.project_id
    and p.organization_id = new.organization_id
  for update;

  if project_prefix is null then
    raise exception 'Project does not exist in this organization.';
  end if;

  insert into public.project_receipt_counters (project_id, next_number)
  values (new.project_id, 1)
  on conflict (project_id) do update
    set next_number = public.project_receipt_counters.next_number + 1
  returning next_number into allocated_number;

  new.receipt_number := project_prefix || '-' || lpad(allocated_number::text, 4, '0');

  update public.projects
  set prefix_locked_at = coalesce(prefix_locked_at, now()),
      updated_at = now()
  where id = new.project_id;

  return new;
end;
$$;

create trigger assign_payment_receipt_number_before_insert
  before insert on public.payments
  for each row execute function public.assign_payment_receipt_number();

create or replace function public.protect_project_prefix()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.prefix_locked_at is not null
    and (new.prefix is distinct from old.prefix or new.prefix_locked_at is null) then
    raise exception 'Project receipt prefix is locked after the first receipt.';
  end if;
  return new;
end;
$$;

create trigger protect_project_prefix_before_update
  before update on public.projects
  for each row execute function public.protect_project_prefix();

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
    or old.amount is distinct from new.amount
    or old.received_at is distinct from new.received_at
    or old.payment_mode is distinct from new.payment_mode
    or old.payer_name is distinct from new.payer_name
    or old.reference is distinct from new.reference then
    raise exception 'Issued payment details are immutable; void and re-enter instead.';
  end if;
  if old.voided_at is not null then
    raise exception 'A voided payment cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger protect_payment_before_update
  before update on public.payments
  for each row execute function public.protect_payment_record();

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_record jsonb;
  new_record jsonb;
  organization_id uuid;
  record_id text;
begin
  if tg_op = 'INSERT' then
    new_record := to_jsonb(new);
    organization_id := (new_record ->> 'organization_id')::uuid;
    record_id := coalesce(new_record ->> 'id', new_record ->> 'project_id');
  elsif tg_op = 'UPDATE' then
    old_record := to_jsonb(old);
    new_record := to_jsonb(new);
    organization_id := (new_record ->> 'organization_id')::uuid;
    record_id := coalesce(new_record ->> 'id', new_record ->> 'project_id');
  else
    old_record := to_jsonb(old);
    organization_id := (old_record ->> 'organization_id')::uuid;
    record_id := coalesce(old_record ->> 'id', old_record ->> 'project_id');
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, table_name, record_id, operation, old_data, new_data
  ) values (
    organization_id, (select auth.uid()), tg_table_name, record_id, tg_op, old_record, new_record
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_project_financial_terms
  after insert or update or delete on public.project_financial_terms
  for each row execute function public.write_audit_log();
create trigger audit_project_change_orders
  after insert or update or delete on public.project_change_orders
  for each row execute function public.write_audit_log();
create trigger audit_progress_billings
  after insert or update or delete on public.progress_billings
  for each row execute function public.write_audit_log();
create trigger audit_payments
  after insert or update or delete on public.payments
  for each row execute function public.write_audit_log();
create trigger audit_retention_ledger
  after insert or update or delete on public.retention_ledger
  for each row execute function public.write_audit_log();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.clients enable row level security;
alter table public.client_user_access enable row level security;
alter table public.projects enable row level security;
alter table public.project_financial_terms enable row level security;
alter table public.project_change_orders enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_progress_updates enable row level security;
alter table public.progress_billings enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.retention_ledger enable row level security;
alter table public.project_receipt_counters enable row level security;
alter table public.workers enable row level security;
alter table public.suppliers enable row level security;
alter table public.project_workers enable row level security;
alter table public.expenses enable row level security;
alter table public.project_documents enable row level security;
alter table public.audit_logs enable row level security;

create policy profile_self_read on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profile_self_update on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy organization_member_read on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy organization_owner_update on public.organizations
  for update to authenticated using (public.has_org_role(id, array['owner']::public.org_role[]))
  with check (public.has_org_role(id, array['owner']::public.org_role[]));

create policy membership_self_or_owner_read on public.organization_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_org_role(organization_id, array['owner']::public.org_role[]));
create policy membership_owner_insert on public.organization_memberships
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));
create policy membership_owner_update on public.organization_memberships
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));
create policy membership_owner_delete on public.organization_memberships
  for delete to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy clients_assigned_read on public.clients
  for select to authenticated using (public.can_access_client(organization_id, id));
create policy clients_staff_insert on public.clients
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]));
create policy clients_staff_update on public.clients
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]));
create policy clients_owner_delete on public.clients
  for delete to authenticated using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy client_access_self_or_owner_read on public.client_user_access
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_org_role(organization_id, array['owner']::public.org_role[]));
create policy client_access_owner_manage on public.client_user_access
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy projects_assigned_read on public.projects
  for select to authenticated using (public.can_access_project(id));
create policy projects_staff_insert on public.projects
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]));
create policy projects_staff_update on public.projects
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]));
create policy projects_owner_delete on public.projects
  for delete to authenticated using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy financial_terms_owner_only on public.project_financial_terms
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy change_orders_project_read on public.project_change_orders
  for select to authenticated using (
    public.can_manage_project(project_id)
    or (status in ('pending_approval', 'approved') and public.can_access_project(project_id))
  );
create policy change_orders_staff_manage on public.project_change_orders
  for all to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy milestones_project_read on public.project_milestones
  for select to authenticated
  using (public.can_access_project(project_id) and (
    public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]) or client_visible
  ));
create policy milestones_staff_manage on public.project_milestones
  for all to authenticated using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy progress_updates_visible_read on public.project_progress_updates
  for select to authenticated
  using (public.can_access_project(project_id) and (
    public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]) or client_visible
  ));
create policy progress_updates_staff_manage on public.project_progress_updates
  for all to authenticated using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy billings_project_read on public.progress_billings
  for select to authenticated
  using (public.can_manage_project(project_id) or (
    status = 'issued' and public.can_access_project(project_id)
  ));
create policy billings_owner_manage on public.progress_billings
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy payments_project_read on public.payments
  for select to authenticated using (public.can_access_project(project_id));
create policy payments_staff_insert on public.payments
  for insert to authenticated with check (public.can_manage_project(project_id));
create policy payments_owner_update on public.payments
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy payment_allocations_project_read on public.payment_allocations
  for select to authenticated using (public.can_access_project(project_id));
create policy payment_allocations_owner_manage on public.payment_allocations
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy retention_project_read on public.retention_ledger
  for select to authenticated using (public.can_access_project(project_id));
create policy retention_owner_manage on public.retention_ledger
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy workers_staff_read on public.workers
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]));
create policy workers_owner_manage on public.workers
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy suppliers_staff_read on public.suppliers
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'site_staff']::public.org_role[]));
create policy suppliers_owner_manage on public.suppliers
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy project_workers_staff_read on public.project_workers
  for select to authenticated
  using (public.can_manage_project(project_id));
create policy project_workers_staff_manage on public.project_workers
  for all to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy expenses_owner_only on public.expenses
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.org_role[]));

create policy documents_project_read on public.project_documents
  for select to authenticated
  using (public.can_manage_project(project_id) or (
    client_visible and public.can_access_project(project_id)
  ));
create policy documents_staff_manage on public.project_documents
  for all to authenticated using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

create policy audit_logs_owner_read on public.audit_logs
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.org_role[]));

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-documents', 'project-documents', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy project_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project_storage_object(name, true)
  );
create policy project_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.can_access_project_storage_object(name, false)
  );
create policy project_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project_storage_object(name, false)
  )
  with check (
    bucket_id = 'project-documents'
    and public.can_access_project_storage_object(name, false)
  );
create policy project_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and public.can_access_project_storage_object(name, false)
  );

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;
grant execute on function public.can_access_client(uuid, uuid) to authenticated;
grant execute on function public.can_access_project(uuid) to authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;
grant execute on function public.can_access_project_storage_object(text, boolean) to authenticated;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.respond_to_change_order(uuid, boolean, text) to authenticated;