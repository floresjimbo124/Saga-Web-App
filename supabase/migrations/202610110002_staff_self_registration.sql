create table public.pending_staff_registrations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null check (length(trim(name)) between 2 and 120),
  created_at timestamptz not null default now()
);

alter table public.pending_staff_registrations enable row level security;
revoke all on public.pending_staff_registrations from public, anon, authenticated;
grant select on public.pending_staff_registrations to authenticated;
grant all on public.pending_staff_registrations to service_role;

create policy pending_staff_registration_read_own on public.pending_staff_registrations
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.register_pending_staff_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted_name text;
begin
  if new.raw_user_meta_data ->> 'account_type' = 'staff' then
    submitted_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    if length(submitted_name) not between 2 and 120 then
      raise exception 'Staff name must contain between 2 and 120 characters.';
    end if;

    insert into public.pending_staff_registrations (user_id, email, name)
    values (new.id, new.email, submitted_name);
  end if;
  return new;
end;
$$;

revoke all on function public.register_pending_staff_account() from public, anon, authenticated;

create trigger on_auth_user_created_staff_registration
  after insert on auth.users
  for each row execute function public.register_pending_staff_account();

create or replace function public.assign_pending_staff_role(
  p_user_id uuid,
  p_staff_title text,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_organization_id uuid := '10000000-0000-4000-8000-000000000001';
  registration public.pending_staff_registrations%rowtype;
begin
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = task_organization_id
      and membership.user_id = p_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'Only a workspace owner can assign staff roles.';
  end if;

  if p_staff_title is null or p_staff_title not in ('liaison_officer', 'engineer', 'architect') then
    raise exception 'Choose a valid staff role.';
  end if;

  select * into registration
  from public.pending_staff_registrations
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'This staff account is no longer waiting for a role.';
  end if;

  if not exists (
    select 1 from auth.users account
    where account.id = p_user_id
      and account.email_confirmed_at is not null
  ) then
    raise exception 'The staff member must confirm their email before a role can be assigned.';
  end if;

  if exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = task_organization_id
      and membership.staff_title = p_staff_title
      and membership.role = 'site_staff'
  ) then
    raise exception 'That staff role is already assigned. Each role has one team member.';
  end if;

  if exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = task_organization_id
      and membership.user_id = p_user_id
  ) or exists (
    select 1 from public.client_user_access access
    where access.organization_id = task_organization_id
      and access.user_id = p_user_id
  ) then
    raise exception 'This account already has workspace access.';
  end if;

  insert into public.organization_memberships (
    organization_id, user_id, role, staff_email, staff_name, staff_title, invited_by
  ) values (
    task_organization_id, p_user_id, 'site_staff',
    registration.email, registration.name, p_staff_title, p_actor_id
  );

  delete from public.pending_staff_registrations where user_id = p_user_id;
end;
$$;

revoke all on function public.assign_pending_staff_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.assign_pending_staff_role(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
