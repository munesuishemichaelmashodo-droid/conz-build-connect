-- Undo 0166: back to the 0111 step-up (Google sign-in in the last 12 hours, or an authenticator
-- code within admin_stepup.max_age_minutes), and remove the authenticator audit trigger, the
-- overview and the owner reset. Enrolled authenticators are left in Supabase Auth untouched.
-- Contains DROP: run it in the Supabase SQL editor, not through the MCP tool.
create or replace function public.require_aal2()
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _amr jsonb := auth.jwt() -> 'amr';
  _latest bigint; _max integer; _google bigint; _gmax integer;
begin
  -- (a) A Google sign-in within the window, on an account that has Google linked.
  if _uid is not null and jsonb_typeof(_amr) = 'array' then
    select max((e ->> 'timestamp')::bigint) into _google
      from jsonb_array_elements(_amr) e
     where jsonb_typeof(e) = 'object'
       and e ->> 'method' = 'oauth'
       and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
    if _google is not null then
      select least(greatest(coalesce(
               (select case when (value ->> 'google_max_age_minutes') ~ '^[0-9]{1,7}$'
                            then (value ->> 'google_max_age_minutes')::integer end
                  from public.system_settings where key = 'admin_stepup'),
               720), 1), 1440)
        into _gmax;
      if to_timestamp(_google) >= now() - make_interval(mins => _gmax)
         and exists (select 1 from auth.identities i where i.user_id = _uid and i.provider = 'google')
      then
        return;
      end if;
    end if;
  end if;

  -- (b) Unchanged from 0096: aal2 with a recent second factor.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUIRED: sign in again with Google to approve this (or verify with your authenticator app).'
      using errcode = '42501';
  end if;
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
      raise exception 'MFA_REQUIRED: your verification has expired. Sign in again with Google to continue.'
        using errcode = '42501';
    end if;
  end if;
end $$;

drop trigger if exists trg_audit_admin_authenticator on auth.mfa_factors;
drop function if exists public.tg_audit_admin_authenticator();
drop function if exists public.owner_reset_authenticator(uuid, text);
drop function if exists public.admin_authenticator_overview();
