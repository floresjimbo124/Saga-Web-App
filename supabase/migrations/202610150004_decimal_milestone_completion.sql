alter table public.project_milestones
  alter column completion_percent type numeric(5, 2)
  using completion_percent::numeric(5, 2);
