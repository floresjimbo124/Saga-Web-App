drop policy if exists project_cover_photos_client_read on storage.objects;

create policy project_cover_photos_client_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and exists (
      select 1
      from public.projects project
      where project.cover_photo_storage_path = objects.name
        and public.can_access_project(project.id)
    )
  );
