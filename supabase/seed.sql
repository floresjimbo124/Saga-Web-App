insert into public.organizations (id, name, currency_code, timezone)
values ('10000000-0000-4000-8000-000000000001', 'SAGACT', 'PHP', 'Asia/Manila')
on conflict (id) do nothing;

insert into public.projects (id, organization_id, name, prefix, status, progress_percent)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Salo Spot', 'SAL', 'planning', 0),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Dapitan Cafe', 'DAP', 'planning', 0)
on conflict (id) do nothing;

insert into public.project_financial_terms (
  project_id, organization_id, down_payment_percent, retention_rate_percent, retention_method
)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 40, 5, 'final_schedule'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 0, 5, 'per_billing')
on conflict (project_id) do nothing;