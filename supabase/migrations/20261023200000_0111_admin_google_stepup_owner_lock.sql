-- 0111: admin protection without authenticator codes.
--
-- APPLIED to production 23/10/2026 with the owner's approval, in four transactions
-- through the SQL tool (apply_migration timed out: the tool holds DROP statements
-- for a confirmation, so triggers use CREATE OR REPLACE TRIGGER instead). Recorded
-- as version 20261023200000. Pre-change state is in the rollback file below.
--
-- Problem (read-only checks on production, 23/10/2026):
--   * 14 money and role functions call require_aal2(), which accepts only a recent
--     authenticator-app (or SMS) code. No admin has a second factor enrolled
--     (auth.mfa_factors has 0 rows), so approving top-ups and withdrawals, wallet
--     credits, commission changes and granting admin roles fail for everyone.
--   * The owners found authenticator apps too hard to use.
--
-- Owner decision (23/10/2026): both super admins sign in with Google only.
-- Google's own 2-Step Verification (a "Yes, it's me" prompt on the phone) becomes
-- the second lock, and the database adds three protections that need no effort:
--
--   1. require_aal2() ALSO accepts a Google sign-in made in the last 12 hours
--      (system_settings admin_stepup.google_max_age_minutes, default 720, never
--      more than 1440). The token's amr claim must show an "oauth" sign-in and the
--      account must really have a Google identity. A password sign-in alone is
--      never enough. The authenticator-code path is unchanged.
--   2. Super admin can only be held by a listed owner (public.super_admin_owners,
--      seeded with today's super admins). Only database access (SQL editor or the
--      service role) can add an owner; nobody can do it from the app.
--   3. An admin or super admin account cannot gain a new sign-in identity whose
--      email differs from the account's email. This stops someone with a stolen
--      password linking their own Google account to pass check 1.
--   4. Alerts: every listed owner gets a notification (in the app, and as a push
--      through the existing trigger) when an admin account signs in and whenever
--      an admin action is written to admin_audit_log (payouts, top-ups, wallet
--      credits, roles, pricing, commission). A failing alert never blocks the
--      sign-in or the action.
--
-- Residual risk, stated plainly: check 1 is only as strong as the owners' Google
-- accounts. Google 2-Step Verification must be ON for both (cannot be checked from
-- here).
--
-- Deploy order: the app that offers "Sign in again with Google" for MFA_REQUIRED
-- errors should ship first; the database change works with the current app too
-- (an admin who signed in with Google in the last 12 hours simply stops seeing the
-- authenticator prompt).
--
-- Rollback: supabase/rollbacks/20261023200000_0111_rollback.sql (restores the exact
-- pre-change production definition of require_aal2, its grants and the setting,
-- and removes everything below; verified locally).

-- -----------------------------------------------------------------------------
-- 1. Step-up accepts a recent Google sign-in
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('admin_stepup', '{"max_age_minutes": 15, "google_max_age_minutes": 720}'::jsonb)
on conflict (key) do nothing;

update public.system_settings
   set value = value || '{"google_max_age_minutes": 720}'::jsonb
 where key = 'admin_stepup' and not (value ? 'google_max_age_minutes');

-- SECURITY DEFINER so it can confirm the account has a Google identity
-- (auth.identities is not readable by signed-in users). It reads only the
-- caller's own token and identities and returns nothing.
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

revoke all on function public.require_aal2() from public, anon;
grant execute on function public.require_aal2() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Super admin = listed owners only
-- -----------------------------------------------------------------------------
create table if not exists public.super_admin_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.super_admin_owners enable row level security;
revoke all on table public.super_admin_owners from public, anon, authenticated;
grant select, insert, update, delete on table public.super_admin_owners to service_role;

insert into public.super_admin_owners (user_id, note)
select distinct r.user_id, 'super admin when 0111 was applied'
  from public.user_roles r
 where r.role = 'super_admin'
on conflict (user_id) do nothing;

create or replace function public.tg_user_roles_owner_lock()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.role = 'super_admin'
     and not exists (select 1 from public.super_admin_owners o where o.user_id = new.user_id)
  then
    raise exception 'Super admin can only be given to a listed owner; this account is not a listed owner.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_user_roles_owner_lock() from public, anon, authenticated;

create or replace trigger trg_user_roles_owner_lock
  before insert or update of role, user_id on public.user_roles
  for each row execute function public.tg_user_roles_owner_lock();

-- -----------------------------------------------------------------------------
-- 3. Admin accounts cannot gain a sign-in identity with another email
-- -----------------------------------------------------------------------------
create or replace function public.tg_admin_identity_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _account_email text; _identity_email text;
begin
  if not exists (select 1 from public.user_roles r
                  where r.user_id = new.user_id and r.role in ('admin', 'super_admin')) then
    return new;
  end if;
  select lower(u.email) into _account_email from auth.users u where u.id = new.user_id;
  _identity_email := lower(coalesce(new.identity_data ->> 'email', ''));
  if _account_email is null or _identity_email = '' or _identity_email <> _account_email then
    raise exception 'Admin accounts cannot link a sign-in with a different email.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_admin_identity_guard() from public, anon, authenticated;

-- Only a NEW identity, or one moved to another account, is checked. Ordinary
-- sign-ins update existing identities and never reach this check.
create or replace trigger trg_admin_identity_guard
  before insert on auth.identities
  for each row execute function public.tg_admin_identity_guard();
create or replace trigger trg_admin_identity_guard_move
  before update on auth.identities
  for each row when (old.user_id is distinct from new.user_id)
  execute function public.tg_admin_identity_guard();

-- -----------------------------------------------------------------------------
-- 4. Alerts to owners
-- -----------------------------------------------------------------------------
create or replace function public.notify_owners(_type text, _title text, _body text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notifications (user_id, type, title, body)
  select o.user_id, _type, _title, _body
    from public.super_admin_owners o
    join public.user_roles r on r.user_id = o.user_id and r.role = 'super_admin';
end $$;
revoke all on function public.notify_owners(text, text, text) from public, anon, authenticated;

create or replace function public.tg_alert_admin_signin()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _name text;
begin
  begin
    if exists (select 1 from public.user_roles r
                where r.user_id = new.user_id and r.role in ('admin', 'super_admin')) then
      select coalesce(nullif(trim(p.full_name), ''), 'An admin') into _name
        from public.profiles p where p.id = new.user_id;
      perform public.notify_owners(
        'admin_signin',
        'Admin sign-in',
        coalesce(_name, 'An admin') || ' signed in to Con Z admin at '
          || to_char(now() at time zone 'Africa/Harare', 'DD Mon HH24:MI') || ' (Harare time). If this was not them, change the password and tell the other owner.');
    end if;
  exception when others then
    -- An alert must never stop someone signing in.
    raise warning 'admin sign-in alert failed: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_alert_admin_signin() from public, anon, authenticated;

create or replace trigger trg_alert_admin_signin
  after insert on auth.sessions
  for each row execute function public.tg_alert_admin_signin();

create or replace function public.tg_alert_admin_action()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _name text;
begin
  begin
    select coalesce(nullif(trim(p.full_name), ''), 'An admin') into _name
      from public.profiles p where p.id = new.actor_id;
    perform public.notify_owners(
      'admin_action',
      'Admin action: ' || replace(new.action, '_', ' '),
      coalesce(_name, 'An admin') || ': ' || replace(new.action, '_', ' ')
        || coalesce(' (' || left(new.reason, 80) || ')', '')
        || ' at ' || to_char(now() at time zone 'Africa/Harare', 'DD Mon HH24:MI') || ' (Harare time).');
  exception when others then
    raise warning 'admin action alert failed: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_alert_admin_action() from public, anon, authenticated;

create or replace trigger trg_alert_admin_action
  after insert on public.admin_audit_log
  for each row execute function public.tg_alert_admin_action();
