-- Undo 0169. Contains DROP: run it in the Supabase SQL editor, not via the MCP tool.
-- Restores the 0166 require_aal2() body exactly.
begin;
create or replace function public.require_aal2()
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _amr jsonb := auth.jwt() -> 'amr';
  _latest bigint; _max integer; _google bigint; _gmax integer;
  _has_authenticator boolean := false;
begin
  if _uid is not null then
    select exists (select 1 from auth.mfa_factors f
                    where f.user_id = _uid and f.status = 'verified' and f.factor_type = 'totp')
      into _has_authenticator;
  end if;

  -- (a) No authenticator on this account: a Google sign-in within the window, on an account
  --     that has Google linked (unchanged from 0111).
  if not _has_authenticator and _uid is not null and jsonb_typeof(_amr) = 'array' then
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

  -- (b) A second factor on this sign-in, used recently enough.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    if _has_authenticator then
      raise exception 'MFA_REQUIRED: enter the code from your authenticator app to approve this.'
        using errcode = '42501';
    end if;
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
      raise exception 'MFA_REQUIRED: your verification has expired. Enter a new code from your authenticator app.'
        using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function public.require_aal2() from public, anon;
grant execute on function public.require_aal2() to authenticated, service_role;
drop function if exists public.admin_set_authenticator_required(boolean, text);
drop function if exists public.admin_authenticator_policy();
drop function if exists public.admin_note_authenticator_check();
drop table if exists public.admin_authenticator_checks;
delete from public.system_settings where key = 'admin_authenticator_required';
commit;
