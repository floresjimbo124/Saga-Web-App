alter table public.project_milestones
  add column completion_percent integer not null default 0
  check (completion_percent between 0 and 100);
