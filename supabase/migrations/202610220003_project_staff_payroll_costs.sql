-- Assigned project staff can see finalised payroll COSTS charged to their projects
-- (so costs-to-date and profit match the owner's view). Employee names and daily
-- rates stay private: payroll_employees is still owner / liaison-officer only.
create policy payroll_weekly_entries_assigned_staff_read on public.payroll_weekly_entries
for select to authenticated
using (project_id is not null and finalized_at is not null and public.is_project_staff(project_id));
