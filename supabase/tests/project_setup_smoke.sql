begin;

do $$
declare
  test_owner_id uuid;
begin
  select m.user_id into test_owner_id
  from public.organization_memberships m
  where m.organization_id = '10000000-0000-4000-8000-000000000001'::uuid
    and m.role = 'owner'
  order by m.created_at
  limit 1;

  if test_owner_id is null then
    raise exception 'No SAGACT owner membership exists for this smoke test.';
  end if;

  perform set_config('request.jwt.claim.sub', test_owner_id::text, true);
end;
$$;

set local role authenticated;

select public.update_project_setup(
  '20000000-0000-4000-8000-000000000001'::uuid,
  '__ROLLBACK_ONLY_SETUP_TEST_CLIENT__',
  123456.78,
  1000.00,
  40,
  5,
  'final_schedule'::public.retention_method
);

do $$
begin
  if not exists (
    select 1
    from public.projects p
    join public.clients c on c.id = p.client_id
    join public.project_financial_terms t on t.project_id = p.id
    where p.id = '20000000-0000-4000-8000-000000000001'::uuid
      and c.name = '__ROLLBACK_ONLY_SETUP_TEST_CLIENT__'
      and t.contract_amount = 123456.78
      and t.special_discount = 1000.00
      and t.down_payment_percent = 40
      and t.retention_rate_percent = 5
      and t.retention_method = 'final_schedule'::public.retention_method
  ) then
    raise exception 'Project setup RPC did not save all expected values.';
  end if;
end;
$$;

rollback;
