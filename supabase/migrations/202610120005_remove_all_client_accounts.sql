create temporary table client_accounts_to_remove (
  user_id uuid primary key
) on commit drop;

insert into client_accounts_to_remove (user_id)
select distinct access.user_id
from public.client_user_access access
where not exists (
  select 1
  from public.organization_memberships membership
  where membership.user_id = access.user_id
);

delete from public.client_user_access;

delete from auth.users account
using client_accounts_to_remove target
where account.id = target.user_id
  and not exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = account.id
  )
  and not exists (
    select 1
    from public.project_tasks task
    where task.created_by = account.id
  );
