alter table public.projects
  add column cover_photo_storage_path text;

notify pgrst, 'reload schema';
