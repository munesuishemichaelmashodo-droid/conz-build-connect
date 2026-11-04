-- -----------------------------------------------------------------------------
-- 0141: make sure sign-up creates the profile, role, driver profile and wallet (the `on_auth_user_created` trigger).
--
-- Production already has this trigger (checked 04/11: AFTER INSERT ON auth.users, enabled, running public.handle_new_user(),
-- SECURITY DEFINER, search_path public) and it was first created in 20260617113139. The 13/08 baseline that fresh
-- databases are built from does not include objects in the auth schema, so a rebuilt database would register users with no
-- profile, role or wallet. This migration creates the trigger ONLY when it is missing. It never replaces or drops an existing
-- one, so on production it does nothing. It changes no function and no data: handle_new_user() is the 0115 version.
-- Undo: supabase/rollbacks/20261104120000_0141_rollback.sql (read its warning first).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;
