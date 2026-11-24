-- -----------------------------------------------------------------------------
-- 0174: the admin step-up accepts ONLY an authenticator-app (TOTP) code (owner decision 24/11/2026).
--
-- require_aal2():   the second factor must be a TOTP code ('totp', or Supabase's alternative name 'mfa/totp').
--                   Passkeys/WebAuthn ('mfa/webauthn'), phone ('mfa/phone') and anything else no longer count. Before,
--                   the list held 'webauthn' and 'phone' (names Supabase does not emit, so unused). A second-factor token
--                   with no amr list is now REFUSED (it was accepted without a freshness check). The 15-minute rule, the
--                   Google path for an admin with no authenticator while "required" is off, and every message prefix
--                   (MFA_REQUIRED) are unchanged.
-- admin_note_authenticator_check(): the 30-day record accepts the same two TOTP names (was 'totp' only).
-- admin_set_authenticator_required(): only a listed owner (super_admin_owners) may change it, explicitly. Today the
--                   super admin role can only be held by listed owners (0111 trigger), so nobody loses access.
-- No table, data or setting changes. No DROP. Undo: supabase/rollbacks/20261124140000_0174_rollback.sql (the 0169 bodies).
-- Tests: supabase/tests/database/1080_admin_totp_only_stepup.test.sql; 260 #27 now expects the no-amr refusal.
-- -----------------------------------------------------------------------------
begin;

create or replace function public.require_aal2()
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _amr jsonb := auth.jwt() -> 'amr';
  _latest bigint; _max integer; _google bigint; _gmax integer;
  _has_authenticator boolean := false;
  _required boolean := false;
begin
  -- 0169: when an owner has switched "authenticator required" on, Google alone is never enough.
  select exists (select 1 from public.system_settings s
                  where s.key = 'admin_authenticator_required' and s.value #>> '{}' = 'true')
    into _required;
  if _uid is not null then
    select exists (select 1 from auth.mfa_factors f
                    where f.user_id = _uid and f.status = 'verified' and f.factor_type = 'totp')
      into _has_authenticator;
  end if;

  -- (a) No authenticator on this account: a Google sign-in within the window, on an account
  --     that has Google linked (unchanged from 0111).
  if not _has_authenticator and not _required and _uid is not null and jsonb_typeof(_amr) = 'array' then
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
    if _required then
      raise exception 'MFA_REQUIRED: set up your authenticator app first, then enter its code to approve this.'
        using errcode = '42501';
    end if;
    raise exception 'MFA_REQUIRED: sign in again with Google to approve this (or verify with your authenticator app).'
      using errcode = '42501';
  end if;
  -- 0174: only an authenticator-app (TOTP) code counts, and the token must say when it was entered. A token with
  -- no amr list, or whose only second factor is a passkey/WebAuthn, phone or anything else, is refused.
  if jsonb_typeof(_amr) is distinct from 'array' then
    raise exception 'MFA_REQUIRED: enter a new code from your authenticator app.' using errcode = '42501';
  end if;
  select coalesce(
           (select case when (value ->> 'max_age_minutes') ~ '^[0-9]{1,3}$'
                        then (value ->> 'max_age_minutes')::integer end
              from public.system_settings where key = 'admin_stepup'),
           15)
    into _max;
  select max((e ->> 'timestamp')::bigint) into _latest
    from jsonb_array_elements(_amr) e
   where jsonb_typeof(e) = 'object'
     and e ->> 'method' in ('totp', 'mfa/totp')
     and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
  if _latest is null then
    raise exception 'MFA_REQUIRED: only a code from your authenticator app counts here. Enter it to approve this.'
      using errcode = '42501';
  end if;
  if to_timestamp(_latest) < now() - make_interval(mins => greatest(_max, 1)) then
    raise exception 'MFA_REQUIRED: your verification has expired. Enter a new code from your authenticator app.'
      using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_aal2() from public, anon;
grant execute on function public.require_aal2() to authenticated, service_role;

create or replace function public.admin_note_authenticator_check()
returns timestamptz language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _amr jsonb := auth.jwt() -> 'amr'; _latest bigint;
begin
  if _me is null or not (public.has_role(_me, 'admin') or public.has_role(_me, 'super_admin')) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' or jsonb_typeof(_amr) <> 'array' then
    raise exception 'MFA_REQUIRED: enter the code from your authenticator app.' using errcode = '42501';
  end if;
  select max((e ->> 'timestamp')::bigint) into _latest
    from jsonb_array_elements(_amr) e
   where jsonb_typeof(e) = 'object' and e ->> 'method' in ('totp', 'mfa/totp') and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
  if _latest is null or to_timestamp(_latest) < now() - interval '5 minutes' then
    raise exception 'MFA_REQUIRED: enter a new code from your authenticator app.' using errcode = '42501';
  end if;
  insert into public.admin_authenticator_checks (user_id, verified_at) values (_me, to_timestamp(_latest))
  on conflict (user_id) do update set verified_at = greatest(public.admin_authenticator_checks.verified_at, excluded.verified_at);
  return to_timestamp(_latest);
end $$;
revoke all on function public.admin_note_authenticator_check() from public, anon;
grant execute on function public.admin_note_authenticator_check() to authenticated;

create or replace function public.admin_set_authenticator_required(_required boolean, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _old boolean;
begin
  -- 0174: explicitly the listed owners (super_admin_owners), not only the super admin role.
  if _me is null or not public.has_role(_me, 'super_admin')
     or not exists (select 1 from public.super_admin_owners o where o.user_id = _me) then
    raise exception 'Only an owner can change this' using errcode = '42501';
  end if;
  if _required is null then
    raise exception 'Say whether the authenticator is required' using errcode = '22023';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'A written reason (at least 5 characters) is required' using errcode = '22023';
  end if;
  if _required and not exists (select 1 from auth.mfa_factors f
                                where f.user_id = _me and f.status = 'verified' and f.factor_type = 'totp') then
    raise exception 'Set up your own authenticator app first, so you are not locked out.' using errcode = '22023';
  end if;
  perform public.require_aal2();
  select exists (select 1 from public.system_settings s
                  where s.key = 'admin_authenticator_required' and s.value #>> '{}' = 'true') into _old;
  insert into public.system_settings (key, value, updated_by, updated_at)
  values ('admin_authenticator_required', to_jsonb(_required), _me, now())
  on conflict (key) do update set value = excluded.value, updated_by = _me, updated_at = now();
  perform public.log_admin_action('authenticator_required_changed',
            jsonb_build_object('required', _required, 'previous', _old), btrim(_reason));
  return jsonb_build_object('required', _required);
end $$;
revoke all on function public.admin_set_authenticator_required(boolean, text) from public, anon;
grant execute on function public.admin_set_authenticator_required(boolean, text) to authenticated;

commit;
