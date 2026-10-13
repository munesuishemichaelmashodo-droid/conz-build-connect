-- Test-only bootstrap for the LOCAL pgTAP database.
--
-- scripts/db-test.mjs installs this as the last migration in .dbtest/
-- (29991231235959_test_helpers.sql). It is never part of
-- supabase/migrations/ and never reaches a hosted project.

create extension if not exists pgtap with schema extensions;

-- tg_send_push_on_notification posts to the PRODUCTION send-push URL
-- (hard-coded). Test transactions roll back, so pg_net never sends, but the
-- local database must not be able to emit anything towards production.
alter table public.notifications disable trigger trg_send_push_on_notification;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Identity switching (role + JWT claims), the same way PostgREST does it.
-- SET ROLE permission is checked against the session user (postgres), so
-- these work from inside an impersonated session too.
-- ---------------------------------------------------------------------------
create or replace function tests.login_as(_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Same as login_as but with a FRESH multi-factor session: aal2, and the token's
-- amr claim says a TOTP code was verified just now (what Supabase puts there).
create or replace function tests.login_as_mfa(_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal2',
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- aal2 whose TOTP verification happened _minutes ago (an aged / expired step-up).
create or replace function tests.login_as_mfa_aged(_uid uuid, _minutes integer)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal2',
      'amr', json_build_array(json_build_object('method', 'totp',
        'timestamp', (extract(epoch from now()) - _minutes * 60)::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- aal2 claim with no amr claim at all (no timing information in the token).
create or replace function tests.login_as_mfa_no_amr(_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

-- Back to the table owner (bypasses RLS; used for fixtures and assertions).
create or replace function tests.as_owner()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures. Run as the owner (call tests.as_owner() first if impersonating).
-- ---------------------------------------------------------------------------
create or replace function tests.create_user(_name text, _roles text[] default array['customer'])
returns uuid language plpgsql as $$
declare _id uuid := gen_random_uuid(); _r text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          _name || '.' || left(_id::text, 8) || '@test.local', '', now(),
          '{"provider":"email"}', '{}', now(), now());
  insert into public.profiles (id, full_name) values (_id, _name) on conflict (id) do nothing;
  foreach _r in array _roles loop
    insert into public.user_roles (user_id, role) values (_id, _r::public.app_role) on conflict do nothing;
  end loop;
  insert into public.wallets (user_id, balance) values (_id, 0) on conflict (user_id) do nothing;
  return _id;
end $$;

-- A verified driver with a truck and a funded wallet. first_job_free_used
-- defaults to true so commission is actually charged.
create or replace function tests.create_driver(_name text, _balance numeric default 100,
                                               _first_job_free_used boolean default true)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  _id := tests.create_user(_name, array['driver']);
  insert into public.driver_profiles (user_id, verification_status, verified_at, first_job_free_used)
  values (_id, 'verified', now(), _first_job_free_used)
  on conflict (user_id) do update set verification_status = 'verified', verified_at = now(),
                                      first_job_free_used = excluded.first_job_free_used;
  update public.wallets set balance = _balance where user_id = _id;
  insert into public.trucks (driver_id, registration, capacity_m3) values (_id, 'TEST-' || left(_id::text, 6), 15);
  return _id;
end $$;

create or replace function tests.truck_of(_driver uuid)
returns uuid language sql stable as $$
  select id from public.trucks where driver_id = _driver order by created_at limit 1
$$;

-- 0107 pauses escrow and withdrawals and caps job/bid/wallet amounts by default (the MVP
-- launch settings). Tests of those older features call this first; 370_mvp_launch_switches
-- does NOT, so it proves the real defaults.
create or replace function tests.enable_launch_features()
returns void language sql as $$
  update public.system_settings set value = 'true'::jsonb where key in ('escrow_enabled', 'withdrawals_enabled');
  update public.system_settings set value = '100000'::jsonb where key in ('max_job_budget', 'max_wallet_balance');
$$;

-- An open job. 'custom' material is not price-enforced, which is the
-- material the F1 budget path relies on.
create or replace function tests.create_job(_customer uuid, _budget numeric default 400,
                                            _method text default 'direct',
                                            _material text default 'custom',
                                            _qty numeric default 12)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method)
  values (_customer, _material::public.material_category, _qty, 'Test address', _budget, _method)
  returning id into _id;
  return _id;
end $$;

-- A pending bid inserted directly (owner context, bypassing client guards),
-- used to model rows that pre-date a constraint or to set up scenarios.
create or replace function tests.create_bid(_job uuid, _driver uuid, _price numeric)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into public.bids (job_id, driver_id, price, truck_id)
  values (_job, _driver, _price, tests.truck_of(_driver))
  returning id into _id;
  return _id;
end $$;

create or replace function tests.balance(_uid uuid)
returns numeric language sql stable as $$
  select balance from public.wallets where user_id = _uid
$$;

-- Ledger invariant for one wallet: sum of ledger rows = balance.
create or replace function tests.ledger_matches(_uid uuid)
returns boolean language sql stable as $$
  select coalesce((select sum(amount) from public.wallet_transactions where user_id = _uid), 0)
         = coalesce((select balance from public.wallets where user_id = _uid), 0)
$$;

-- Delivery proof as the app records it: a real job_evidence row of kind 'delivery'
-- for this job and its driver, jobs.delivery_photo_url pointing at it, and a delivery
-- code. Returns the code (NULL for a job with no driver yet). Safe to call twice.
create or replace function tests.deliver(_job uuid)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare _j public.jobs; _path text;
begin
  select * into _j from public.jobs where id = _job;
  if not found or _j.driver_id is null then return null; end if;
  _path := coalesce(_j.delivery_photo_url, 'test/' || _job || '/delivery.jpg');
  if not exists (select 1 from public.job_evidence
                  where job_id = _job and kind = 'delivery' and storage_path = _path and uploaded_by = _j.driver_id) then
    insert into public.job_evidence (job_id, kind, storage_path, uploaded_by) values (_job, 'delivery', _path, _j.driver_id);
  end if;
  if _j.delivery_photo_url is null then
    update public.jobs set delivery_photo_url = _path where id = _job;
  end if;
  insert into public.job_delivery_pins (job_id, pin) values (_job, '123456') on conflict (job_id) do nothing;
  return (select pin from public.job_delivery_pins where job_id = _job);
end $$;

-- "The customer confirms delivery" the legitimate way: evidence + code, then the real
-- complete_job. Run it logged in as the customer.
create or replace function tests.complete(_job uuid)
returns jsonb language sql as $$
  select public.complete_job(_job, tests.deliver(_job))
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
