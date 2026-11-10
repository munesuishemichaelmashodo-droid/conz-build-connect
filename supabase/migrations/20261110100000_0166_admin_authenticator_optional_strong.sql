-- 0166 — simple, stronger admin step-up (owner request 10/11/2026).
--
-- Today (0111) a money or role action needs a Google sign-in from the last 12 hours.
-- This adds ONE opt-in upgrade per admin account, with nothing new to manage until it is used:
--
--   * An admin who has set up an authenticator app (a verified Supabase TOTP factor) must use its
--     code for money and role actions. A Google sign-in alone is no longer enough for THAT account.
--     A code stays good for 15 minutes, as before (system_settings admin_stepup -> max_age_minutes);
--     entering a new one takes seconds and does not sign the admin out.
--   * An admin who has not set one up is unaffected: the Google rule works exactly as before.
--     So applying this migration changes nothing for anyone until they enrol, and nobody is locked out.
--   * Lost phone: the OTHER owner removes the authenticator with owner_reset_authenticator()
--     (owner only, their own step-up, written reason, audit row, both owners notified). The account
--     then falls back to the Google rule until an authenticator is set up again.
--   * Setting up or removing an authenticator on an admin account is written to admin_audit_log,
--     which already notifies the owners.
--
-- No secrets are stored by ConZ: factors live in Supabase Auth (auth.mfa_factors). No DROP.
-- Undo: supabase/rollbacks/20261110100000_0166_rollback.sql (restores the 0111 require_aal2 body).

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

-- Which admins have an authenticator. Owners only (it tells who is protected, nothing secret).
create or replace function public.admin_authenticator_overview()
returns table (user_id uuid, full_name text, is_owner boolean, has_authenticator boolean, since timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can view this' using errcode = '42501';
  end if;
  return query
    select a.user_id,
           coalesce(nullif(btrim(p.full_name), ''), 'Admin')::text,
           exists (select 1 from public.super_admin_owners o where o.user_id = a.user_id),
           f.since is not null,
           f.since
      from (select distinct r.user_id from public.user_roles r where r.role in ('admin', 'super_admin')) a
      left join public.profiles p on p.id = a.user_id
      left join lateral (select min(m.updated_at) as since from auth.mfa_factors m
                          where m.user_id = a.user_id and m.status = 'verified' and m.factor_type = 'totp') f on true
     order by 3 desc, 2;
end $$;
revoke all on function public.admin_authenticator_overview() from public, anon;
grant execute on function public.admin_authenticator_overview() to authenticated;

-- Lost phone: an owner removes ANOTHER admin's authenticator. Never their own (that would let a
-- stolen session switch the protection off); the account owner can remove their own from the
-- security screen, which Supabase only allows after entering a current code.
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
  if _n = 0 then
    raise exception 'That account has no authenticator set up';
  end if;
  perform public.log_admin_action('authenticator_reset', jsonb_build_object('factors_removed', _n),
                                  btrim(_reason), null, _target);
  return _n;
end $$;
revoke all on function public.owner_reset_authenticator(uuid, text) from public, anon;
grant execute on function public.owner_reset_authenticator(uuid, text) to authenticated;

-- Audit trail: an admin account gains or loses an authenticator (admin_audit_log already alerts owners).
create or replace function public.tg_audit_admin_authenticator()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _uid uuid; _action text; _type text;
begin
  begin
    if tg_op = 'DELETE' then
      -- an owner reset writes its own, fuller audit row
      if old.status = 'verified' and coalesce(current_setting('conz.authenticator_reset_by', true), '') = '' then
        _uid := old.user_id; _action := 'authenticator_removed'; _type := old.factor_type::text;
      end if;
    elsif tg_op = 'INSERT' then
      if new.status = 'verified' then
        _uid := new.user_id; _action := 'authenticator_set_up'; _type := new.factor_type::text;
      end if;
    elsif new.status = 'verified' and old.status is distinct from new.status then
      _uid := new.user_id; _action := 'authenticator_set_up'; _type := new.factor_type::text;
    end if;
    if _action is not null and exists (select 1 from public.user_roles r
                                        where r.user_id = _uid and r.role in ('admin', 'super_admin')) then
      insert into public.admin_audit_log (actor_id, action, target_user_id, reason, meta)
      values (_uid, _action, _uid, null, jsonb_build_object('factor_type', _type));
    end if;
  exception when others then
    -- an audit problem must never stop someone setting up or using their authenticator
    raise warning 'authenticator audit failed: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.tg_audit_admin_authenticator() from public, anon, authenticated;

create or replace trigger trg_audit_admin_authenticator
  after insert or update or delete on auth.mfa_factors
  for each row execute function public.tg_audit_admin_authenticator();
