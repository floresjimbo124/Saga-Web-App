create or replace function public.assign_payment_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_name text;
  configured_prefix text;
  project_prefix text;
  allocated_number integer;
begin
  select p.name, p.prefix into project_name, configured_prefix
  from public.projects p
  where p.id = new.project_id
    and p.organization_id = new.organization_id
  for update;

  if project_name is null then
    raise exception 'Project does not exist in this organization.';
  end if;

  project_prefix := left(regexp_replace(upper(project_name), '[^[:alpha:]]', '', 'g'), 3);
  if project_prefix = '' then
    project_prefix := left(regexp_replace(upper(coalesce(configured_prefix, '')), '[^[:alpha:]]', '', 'g'), 3);
  end if;
  if project_prefix = '' then
    raise exception 'Project name or prefix must contain letters to generate an acknowledgement receipt number.';
  end if;

  insert into public.project_receipt_counters (project_id, next_number)
  values (new.project_id, 1)
  on conflict (project_id) do update
    set next_number = public.project_receipt_counters.next_number + 1
  returning next_number into allocated_number;

  new.receipt_number := project_prefix || '-AR-' || lpad(allocated_number::text, 4, '0');

  update public.projects
  set prefix_locked_at = coalesce(prefix_locked_at, now()),
      updated_at = now()
  where id = new.project_id;

  return new;
end;
$$;
