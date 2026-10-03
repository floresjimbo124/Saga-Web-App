begin;

create temporary table client_access_project_backfill on commit drop as
select
  access.organization_id,
  access.user_id,
  access.invited_by,
  access.created_at,
  project.id as project_id
from public.client_user_access access
join public.projects project
  on project.organization_id = access.organization_id
  and project.client_id = access.client_id;

alter table public.client_user_access
  drop constraint client_user_access_pkey,
  drop constraint client_user_access_client_id_organization_id_fkey;

delete from public.client_user_access;

alter table public.client_user_access
  drop column client_id,
  add column project_id uuid;

insert into public.client_user_access (
  organization_id,
  user_id,
  invited_by,
  created_at,
  project_id
)
select
  organization_id,
  user_id,
  invited_by,
  created_at,
  project_id
from client_access_project_backfill;

alter table public.client_user_access
  alter column project_id set not null,
  add constraint client_user_access_pkey primary key (project_id, user_id),
  add constraint client_user_access_project_id_organization_id_fkey
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id)
    on delete cascade;

create or replace function public.can_access_client(p_organization_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(
      p_organization_id,
      array['owner', 'site_staff']::public.org_role[]
    )
    or exists (
      select 1
      from public.client_user_access access
      join public.projects project
        on project.id = access.project_id
        and project.organization_id = access.organization_id
      where access.organization_id = p_organization_id
        and project.client_id = p_client_id
        and access.user_id = (select auth.uid())
    );
$$;

create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects project
    where project.id = p_project_id
      and (
        public.has_org_role(project.organization_id, array['owner', 'site_staff']::public.org_role[])
        or exists (
          select 1
          from public.client_user_access access
          where access.organization_id = project.organization_id
            and access.project_id = project.id
            and access.user_id = (select auth.uid())
        )
      )
  );
$$;

commit;
