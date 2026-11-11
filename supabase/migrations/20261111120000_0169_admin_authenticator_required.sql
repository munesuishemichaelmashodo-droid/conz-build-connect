-- 0169 — "authenticator required" switch for admin money and role actions (owner request 11/11/2026).
-- Until now an admin WITHOUT an authenticator app could still approve money and role changes with a recent
-- Google sign-in (0111/0166). The owners decided the authenticator is the only protection they trust, so:
--   * system_settings.admin_authenticator_required (default OFF: neither owner has enrolled yet; turning it on
--     before that would stop them approving anything until they do);
--   * ON  -> require_aal2() never accepts Google alone: every crucial action needs the authenticator code
--           (valid 15 minutes, as before). An admin with no authenticator is told to set one up first;
--   * only a super admin who has an authenticator herself/himself can switch it ON, with a reason, a fresh
--     code, and an audit row (admin_audit_log also notifies the owners);
--   * admin_authenticator_policy() lets the admin screens show the right wording.
-- The 30-day rule: admin_authenticator_checks records each admin's last accepted code (written only by
-- admin_note_authenticator_check, from the verified session); the admin screens send an admin whose last check is older
-- than 30 days to the code screen. Every crucial action still needs a fresh code in the database, whatever the 30-day state. No DROP. Undo: supabase/rollbacks/20261111120000_0169_rollback.sql.
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

-- When each admin last passed an authenticator check (the 30-day rule). Written only by
-- admin_note_authenticator_check() below, which looks at the caller's own verified session.
create table if not exists public.admin_authenticator_checks (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table public.admin_authenticator_checks enable row level security;
revoke all on table public.admin_authenticator_checks from public, anon, authenticated;
grant select, insert, update on table public.admin_authenticator_checks to service_role;

-- Called by the code screen right after a code is accepted. Trusts nothing the browser says: the
-- session itself must be a second-factor (aal2) session with an authenticator code from the last 5 minutes.
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
   where jsonb_typeof(e) = 'object' and e ->> 'method' = 'totp' and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
  if _latest is null or to_timestamp(_latest) < now() - interval '5 minutes' then
    raise exception 'MFA_REQUIRED: enter a new code from your authenticator app.' using errcode = '42501';
  end if;
  insert into public.admin_authenticator_checks (user_id, verified_at) values (_me, to_timestamp(_latest))
  on conflict (user_id) do update set verified_at = greatest(public.admin_authenticator_checks.verified_at, excluded.verified_at);
  return to_timestamp(_latest);
end $$;
revoke all on function public.admin_note_authenticator_check() from public, anon;
grant execute on function public.admin_note_authenticator_check() to authenticated;

-- What the admin screens need: is the authenticator required, does this admin have one, when was it
-- last checked, and has the 30-day limit passed. Admins only; nothing secret.
create or replace function public.admin_authenticator_policy()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _has boolean; _last timestamptz; _max constant integer := 30;
begin
  if not (public.has_role(_me, 'admin') or public.has_role(_me, 'super_admin')) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select exists (select 1 from auth.mfa_factors f
                  where f.user_id = _me and f.status = 'verified' and f.factor_type = 'totp') into _has;
  select c.verified_at into _last from public.admin_authenticator_checks c where c.user_id = _me;
  return jsonb_build_object(
    'required', exists (select 1 from public.system_settings s
                         where s.key = 'admin_authenticator_required' and s.value #>> '{}' = 'true'),
    'has_authenticator', _has,
    'last_verified_at', _last,
    'max_age_days', _max,
    'expired', _has and (_last is null or _last < now() - make_interval(days => _max)),
    'days_left', case when _has and _last is not null
                      then greatest(0, ceil(extract(epoch from (_last + make_interval(days => _max) - now())) / 86400))::integer end);
end $$;
revoke all on function public.admin_authenticator_policy() from public, anon;
grant execute on function public.admin_authenticator_policy() to authenticated;

-- Switch it on or off. Super admin, current authenticator code, written reason, audited.
create or replace function public.admin_set_authenticator_required(_required boolean, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _old boolean;
begin
  if _me is null or not public.has_role(_me, 'super_admin') then
    raise exception 'Only super admins can change this' using errcode = '42501';
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

insert into public.system_settings (key, value) values ('admin_authenticator_required', 'false'::jsonb)
on conflict (key) do nothing;

commit;
