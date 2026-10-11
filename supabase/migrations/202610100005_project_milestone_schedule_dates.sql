alter table public.project_milestones
  add column start_date date;

alter table public.project_milestones
  add constraint project_milestones_schedule_dates_valid
  check (start_date is null or planned_date is null or start_date <= planned_date);
