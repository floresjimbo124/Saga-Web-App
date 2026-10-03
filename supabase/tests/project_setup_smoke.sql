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

select public.update_project_state(
  '20000000-0000-4000-8000-000000000001'::uuid,
  'active',
  'needs_attention'
);

select public.update_project_deadline(
  '20000000-0000-4000-8000-000000000001'::uuid,
  '2026-12-31'::date
);

do $$
begin
  if not exists (
    select 1
    from public.projects p
    where p.id = '20000000-0000-4000-8000-000000000001'::uuid
      and p.status = 'active'
      and p.health_status = 'needs_attention'
      and p.deadline = '2026-12-31'::date
  ) then
    raise exception 'Project state RPC did not save lifecycle and health separately.';
  end if;
end;
$$;

do $$
declare
  expense_id uuid;
begin
  expense_id := public.record_project_expense(
    '20000000-0000-4000-8000-000000000001'::uuid,
    '2026-10-01'::date,
    'materials',
    '__ROLLBACK_ONLY_EXPENSE_TEST__',
    'Test vendor',
    1234.56
  );

  if not exists (
    select 1
    from public.project_expenses e
    where e.id = expense_id
      and e.project_id = '20000000-0000-4000-8000-000000000001'::uuid
      and e.organization_id = '10000000-0000-4000-8000-000000000001'::uuid
      and e.amount = 1234.56
  ) then
    raise exception 'Project expense RPC did not save the expected expense.';
  end if;
end;
$$;

do $$
declare
  inserted_count integer;
begin
  inserted_count := public.record_project_expenses(jsonb_build_array(
    jsonb_build_object(
      'project_id', '20000000-0000-4000-8000-000000000001',
      'expense_date', '2026-10-01',
      'category', 'materials',
      'description', '__ROLLBACK_ONLY_BATCH_EXPENSE_1__',
      'vendor', 'Test vendor',
      'amount', 1234.56
    ),
    jsonb_build_object(
      'project_id', '20000000-0000-4000-8000-000000000002',
      'expense_date', '2026-10-01',
      'category', 'transport',
      'description', '__ROLLBACK_ONLY_BATCH_EXPENSE_2__',
      'vendor', null,
      'amount', 789.01
    )
  ));

  if inserted_count <> 2 then
    raise exception 'Project expense batch RPC returned %, expected 2.', inserted_count;
  end if;
  if not exists (
    select 1
    from public.project_expenses e
    where e.description = '__ROLLBACK_ONLY_BATCH_EXPENSE_1__'
      and e.amount = 1234.56
  ) or not exists (
    select 1
    from public.project_expenses e
    where e.description = '__ROLLBACK_ONLY_BATCH_EXPENSE_2__'
      and e.amount = 789.01
  ) then
    raise exception 'Project expense batch RPC did not save all rows.';
  end if;
end;
$$;

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
