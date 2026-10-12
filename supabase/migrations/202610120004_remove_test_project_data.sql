do $$
declare
  matching_project_ids uuid[];
  target_project_id uuid;
  target_client_id uuid;
  matching_client_ids uuid[];
  client_user_ids uuid[];
begin
  select array_agg(project.id), array_agg(project.client_id)
  into matching_project_ids, matching_client_ids
  from public.projects project
  where project.organization_id = '10000000-0000-4000-8000-000000000001'::uuid
    and project.name = 'Test Project';

  if coalesce(cardinality(matching_project_ids), 0) <> 1 then
    raise exception 'Expected exactly one SAGACT project named "Test Project"; found %.',
      coalesce(cardinality(matching_project_ids), 0);
  end if;

  target_project_id := matching_project_ids[1];
  target_client_id := matching_client_ids[1];

  select array_agg(distinct access.user_id)
  into client_user_ids
  from public.client_user_access access
  where access.project_id = target_project_id;

  delete from public.payment_allocations where project_id = target_project_id;
  delete from public.retention_ledger where project_id = target_project_id;
  delete from public.project_receipt_counters where project_id = target_project_id;
  delete from public.payroll_weekly_entries where project_id = target_project_id;
  delete from public.projects where id = target_project_id;

  if target_client_id is not null and not exists (
    select 1 from public.projects project where project.client_id = target_client_id
  ) then
    delete from public.clients where id = target_client_id;
  end if;

  delete from auth.users account
  where account.id = any(coalesce(client_user_ids, array[]::uuid[]))
    and not exists (
      select 1 from public.client_user_access access where access.user_id = account.id
    )
    and not exists (
      select 1 from public.organization_memberships membership where membership.user_id = account.id
    );
end;
$$;
