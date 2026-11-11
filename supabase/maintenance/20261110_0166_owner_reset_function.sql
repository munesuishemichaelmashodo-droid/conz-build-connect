-- The last part of migration 0166 (optional authenticator app for admins). The owner runs it:
-- Supabase Dashboard > project conz-build-connect > SQL Editor > paste this whole file > Run.
--
-- WHY BY HAND: the other three parts of 0166 were applied on 10/11/2026 and match git. This function
-- contains the words "delete from", which makes the Supabase tool ask for a confirmation the Claude
-- app cannot show, so the tool cannot apply it. Creating the function deletes nothing.
--
-- WHAT IT ADDS: "Reset" in Admin > Settings > Authenticator app, so one owner can remove another
-- admin's authenticator when a phone is lost. Until this is run, do not set up an authenticator app
-- (a lost phone could then only be fixed in the Supabase dashboard under Authentication > Users).
--
-- EXPECTED RESULT: one row, ok = true.
create or replace function public.owner_reset_authenticator(_target uuid, _reason text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _n integer;
begin
  if _me is null or not public.has_role(_me, 'super_admin')
     or not exists (select 1 from public.super_admin_owners o where o.user_id = _me) then
    raise exception 'Only an owner can reset an authenticator' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _target is null or _target = _me then
    raise exception 'Ask the other owner to reset your authenticator. You cannot reset your own.';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'A written reason (at least 5 characters) is required';
  end if;
  if not exists (select 1 from public.user_roles r where r.user_id = _target and r.role in ('admin', 'super_admin')) then
    raise exception 'That account is not an admin';
  end if;

  perform set_config('conz.authenticator_reset_by', _me::text, true);
  delete from auth.mfa_factors f where f.user_id = _target;
  get diagnostics _n = row_count;
  perform set_config('conz.authenticator_reset_by', '', true);
  if _n = 0 then
    raise exception 'That account has no authenticator set up';
  end if;
  perform public.log_admin_action('authenticator_reset', jsonb_build_object('factors_removed', _n),
                                  btrim(_reason), null, _target);
  return _n;
end $$;
revoke all on function public.owner_reset_authenticator(uuid, text) from public, anon;
grant execute on function public.owner_reset_authenticator(uuid, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
select '20261110100000', '0166_admin_authenticator_optional_strong'
 where not exists (select 1 from supabase_migrations.schema_migrations where version = '20261110100000');

select md5(regexp_replace(prosrc, '\s', '', 'g')) = '4c1752531bfc3fb2724ea35e92d7db2b' as ok
  from pg_proc where proname = 'owner_reset_authenticator' and pronamespace = 'public'::regnamespace;
