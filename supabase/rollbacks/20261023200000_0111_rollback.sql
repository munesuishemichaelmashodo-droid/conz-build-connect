-- Undo 0111_admin_google_stepup_owner_lock. Restores production exactly as read on
-- 23/10/2026 before 0111 was applied (pg_get_functiondef of require_aal2, its ACL,
-- and the admin_stepup setting), then removes everything 0111 added.
-- Verified locally: after 0111 + this file, require_aal2's body hash equals the
-- pre-change production hash (a1b550d204b02b841133388e6ba27556, whitespace removed).

begin;

drop trigger if exists trg_alert_admin_action on public.admin_audit_log;
drop trigger if exists trg_alert_admin_signin on auth.sessions;
drop trigger if exists trg_admin_identity_guard on auth.identities;
drop trigger if exists trg_admin_identity_guard_move on auth.identities;
drop trigger if exists trg_user_roles_owner_lock on public.user_roles;
drop function if exists public.tg_alert_admin_action();
drop function if exists public.tg_alert_admin_signin();
drop function if exists public.notify_owners(text, text, text);
drop function if exists public.tg_admin_identity_guard();
drop function if exists public.tg_user_roles_owner_lock();
drop table if exists public.super_admin_owners;

CREATE OR REPLACE FUNCTION public.require_aal2()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare _amr jsonb; _latest bigint; _max integer;
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUIRED: verify with your authenticator app to perform this action.'
      using errcode = '42501';
  end if;

  -- Freshness. Supabase puts every authentication method the session used, with
  -- its time, in the token's amr claim. A session that verified a second factor
  -- long ago (refresh tokens keep aal2 alive) is asked to verify again.
  -- A token with no amr claim carries no timing information; it is treated as
  -- aal2 only (the previous behaviour) rather than locking admins out.
  _amr := auth.jwt() -> 'amr';
  if jsonb_typeof(_amr) = 'array' then
    select coalesce(
             (select case when (value ->> 'max_age_minutes') ~ '^[0-9]{1,3}$'
                          then (value ->> 'max_age_minutes')::integer end
                from public.system_settings where key = 'admin_stepup'),
             15)
      into _max;
    select max((e ->> 'timestamp')::bigint) into _latest
      from jsonb_array_elements(_amr) e
     where jsonb_typeof(e) = 'object'
       and e ->> 'method' in ('totp', 'webauthn', 'phone')
       and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
    if _latest is null or to_timestamp(_latest) < now() - make_interval(mins => greatest(_max, 1)) then
      raise exception 'MFA_REQUIRED: your verification has expired. Verify again with your authenticator app to continue.'
        using errcode = '42501';
    end if;
  end if;
end $function$;

-- ACL as it was: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
grant execute on function public.require_aal2() to public, anon, authenticated, service_role;

update public.system_settings set value = '{"max_age_minutes": 15}'::jsonb where key = 'admin_stepup';

commit;
