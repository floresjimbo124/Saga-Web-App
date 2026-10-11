drop trigger if exists on_auth_user_created_staff_registration on auth.users;
drop function if exists public.register_pending_staff_account();

drop policy if exists pending_staff_registration_read_own on public.pending_staff_registrations;
revoke all on public.pending_staff_registrations from public, anon, authenticated;

drop function if exists public.assign_pending_staff_role(uuid, text, uuid);

notify pgrst, 'reload schema';
