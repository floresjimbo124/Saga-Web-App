do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_tasks'
    ) then
    alter publication supabase_realtime add table public.project_tasks;
  end if;
end;
$$;

notify pgrst, 'reload schema';
