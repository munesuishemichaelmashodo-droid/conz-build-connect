-- 0111 — admin protection without authenticator codes (owner decision 23/10/2026):
--   * money actions accept a Google sign-in from the last 12 hours instead of an
--     authenticator code, but only for an account that really has Google linked;
--     a password sign-in alone is never enough;
--   * the authenticator-code path keeps working as before;
--   * super admin can only be held by a listed owner;
--   * an admin account cannot gain a sign-in identity with a different email;
--   * owners are notified when an admin signs in or an admin action is logged.

begin;
select plan(32);
select tests.enable_launch_features();

-- ---------------------------------------------------------------- fixtures
create function pg_temp.add_google(_uid uuid, _email text default null) returns void language plpgsql as $$
begin
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), 'g-' || left(_uid::text, 8) || '-' || left(md5(random()::text), 6), _uid,
          jsonb_build_object('sub', 'g-' || left(_uid::text, 8),
                             'email', coalesce(_email, (select email from auth.users where id = _uid))),
          'google', now(), now(), now());
end $$;

-- Signed in with Google _minutes ago (what Supabase puts in the token's amr claim).
create function pg_temp.login_google(_uid uuid, _minutes integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal1',
      'amr', json_build_array(json_build_object('method', 'oauth',
        'timestamp', (extract(epoch from now()) - _minutes * 60)::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Signed in with a password just now.
create function pg_temp.login_password(_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal1',
      'amr', json_build_array(json_build_object('method', 'password',
        'timestamp', extract(epoch from now())::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.wd(_who uuid) returns uuid language plpgsql as $$
declare _id uuid;
begin
  perform tests.login_as(_who);
  perform public.set_withdrawal_pin('2468', null);
  _id := (public.request_withdrawal(40, 'ecocash', '0771234567', '2468'))->'request'->>'id';
  perform tests.as_owner();
  return _id;
end $$;

select set_config('t.admin', tests.create_user('gs_admin', array['admin'])::text, true);
select set_config('t.nogoogle', tests.create_user('gs_admin_pw', array['admin'])::text, true);
select set_config('t.owner', tests.create_user('gs_owner', array['super_admin', 'admin'])::text, true);
select set_config('t.plain', tests.create_user('gs_plain')::text, true);
select pg_temp.add_google(current_setting('t.admin')::uuid);
select pg_temp.add_google(current_setting('t.owner')::uuid);
select pg_temp.add_google(current_setting('t.plain')::uuid);
select set_config('t.d1', tests.create_driver('gs_d1', 100)::text, true);
select set_config('t.d2', tests.create_driver('gs_d2', 100)::text, true);
select set_config('t.d3', tests.create_driver('gs_d3', 100)::text, true);
select set_config('t.w1', pg_temp.wd(current_setting('t.d1')::uuid)::text, true);
select set_config('t.w2', pg_temp.wd(current_setting('t.d2')::uuid)::text, true);
select set_config('t.w3', pg_temp.wd(current_setting('t.d3')::uuid)::text, true);

-- ======================================================= 1. Google step-up
select pg_temp.login_password(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w1')),
  '%MFA_REQUIRED%', '1: a password sign-in alone cannot approve a payout');

select pg_temp.login_google(current_setting('t.admin')::uuid, 13 * 60);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w1')),
  '%MFA_REQUIRED%', '2: a Google sign-in from 13 hours ago is too old');

select pg_temp.login_google(current_setting('t.nogoogle')::uuid, 5);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w1')),
  '%MFA_REQUIRED%', '3: an "oauth" claim on an account with no Google identity is not accepted');

select tests.as_owner();
select is(tests.balance(current_setting('t.d1')::uuid), 100.00::numeric, '4: no money moved so far');

select pg_temp.login_google(current_setting('t.admin')::uuid, 60);
select lives_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w1')),
  '5: an admin who signed in with Google an hour ago approves the payout');
select tests.as_owner();
select is(tests.balance(current_setting('t.d1')::uuid), 60.00::numeric, '6: debited exactly once');

select pg_temp.login_google(current_setting('t.plain')::uuid, 5);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w2')),
  '%Forbidden%', '7: a fresh Google sign-in does not make a non-admin an admin');

select tests.login_as_mfa(current_setting('t.nogoogle')::uuid);
select lives_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w2')),
  '8: the authenticator-code path still works');

select tests.login_as_mfa_aged(current_setting('t.nogoogle')::uuid, 30);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w3')),
  '%MFA_REQUIRED%', '9: an old authenticator code is still refused');

-- The Google window is a setting (minutes), bounded to 1..1440.
select tests.as_owner();
update public.system_settings set value = value || '{"google_max_age_minutes": 60}'::jsonb where key = 'admin_stepup';
select pg_temp.login_google(current_setting('t.admin')::uuid, 90);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w3')),
  '%MFA_REQUIRED%', '10: a shorter window set by the owner is honoured');
select tests.as_owner();
update public.system_settings set value = value || '{"google_max_age_minutes": 999999}'::jsonb where key = 'admin_stepup';
select pg_temp.login_google(current_setting('t.admin')::uuid, 25 * 60);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.w3')),
  '%MFA_REQUIRED%', '11: the window can never exceed 24 hours');
select tests.as_owner();
select is((select value ->> 'google_max_age_minutes' from public.system_settings where key = 'admin_stepup'), '999999',
  '12: (setting stored as given; the cap is applied when read)');

-- ===================================================== 2. Super admin = listed owners
select ok(exists (select 1 from public.super_admin_owners where user_id = current_setting('t.owner')::uuid),
  '13: test owners are listed (fixture registers them)');
select throws_like(format($$insert into public.user_roles (user_id, role) values (%L, 'super_admin')$$, current_setting('t.admin')),
  '%not a listed owner%', '14: even the table owner cannot give super admin to someone who is not listed');

select tests.login_as_mfa(current_setting('t.owner')::uuid);
select throws_like(format($$select public.admin_grant_role(%L, 'super_admin', 'test')$$, current_setting('t.admin')),
  '%not a listed owner%', '15: a super admin cannot promote an unlisted account');
select tests.as_owner();
select is((select count(*)::int from public.user_roles where user_id = current_setting('t.admin')::uuid and role = 'super_admin'), 0,
  '16: no super admin role was created');

select tests.login_as(current_setting('t.owner')::uuid);
select throws_ok($$select * from public.super_admin_owners$$, '42501', null, '17: signed-in users cannot read the owner list');
select throws_ok(format($$insert into public.super_admin_owners (user_id) values (%L)$$, current_setting('t.admin')),
  '42501', null, '18: signed-in users cannot add owners');

select tests.as_owner();
insert into public.super_admin_owners (user_id, note) values (current_setting('t.admin')::uuid, 'test');
select lives_ok(format($$insert into public.user_roles (user_id, role) values (%L, 'super_admin')$$, current_setting('t.admin')),
  '19: once listed (database access only), the account can be made super admin');

-- ===================================================== 3. No foreign sign-in identities on admin accounts
select throws_like(format($$select pg_temp.add_google(%L, 'someone.else@example.com')$$, current_setting('t.nogoogle')),
  '%different email%', '20: an admin account cannot gain a Google identity with another email');
select lives_ok(format($$select pg_temp.add_google(%L)$$, current_setting('t.nogoogle')),
  '21: the admin''s own Google account (same email) can be linked');
select lives_ok(format($$select pg_temp.add_google(%L, 'any@example.com')$$, tests.create_user('gs_customer')),
  '22: customers are not affected');

select lives_ok(format($$update auth.identities set identity_data = identity_data || '{"email":"changed@example.com"}', last_sign_in_at = now() where user_id = %L and provider = 'google'$$, current_setting('t.admin')),
  '22a: an ordinary sign-in update of an admin''s identity is never blocked');
select throws_like(format($$update auth.identities set user_id = %L where user_id = %L and provider = 'google'$$,
    current_setting('t.nogoogle'), current_setting('t.plain')),
  '%different email%', '22b: an identity with another email cannot be moved onto an admin account');

-- ===================================================== 4. Alerts to owners
delete from public.notifications where type = 'admin_signin';

insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), current_setting('t.nogoogle')::uuid, now(), now());
select is((select count(*)::int from public.notifications where type = 'admin_signin'),
  (select count(*)::int from public.super_admin_owners o join public.user_roles r on r.user_id = o.user_id and r.role = 'super_admin'),
  '23: every owner is told when an admin signs in');
select ok((select bool_and(body like '%gs_admin_pw%') from public.notifications where type = 'admin_signin'),
  '24: the alert names who signed in');

delete from public.notifications where type = 'admin_signin';
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), current_setting('t.plain')::uuid, now(), now());
select is((select count(*)::int from public.notifications where type = 'admin_signin'), 0, '25: customer sign-ins send nothing');

select ok((select count(*) from public.notifications where type = 'admin_action'
            and user_id = current_setting('t.owner')::uuid) >= 1,
  '26: owners were told about the payout approvals and role changes above');
select ok((select bool_or(body like '%gs_admin%') from public.notifications where type = 'admin_action'),
  '27: the action alert names the admin');

-- A broken alert must never block a sign-in.
alter table public.notifications add constraint t_block_alerts check (type <> 'admin_signin') not valid;
select lives_ok(format($$insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), %L, now(), now())$$,
  current_setting('t.nogoogle')), '28: a failing alert does not stop the admin signing in');
alter table public.notifications drop constraint t_block_alerts;

-- ===================================================== 5. Grants unchanged for callers
select tests.as_anon();
select throws_ok($$select public.require_aal2()$$, '42501', null, '29: anonymous callers still cannot run the step-up check');
select tests.login_as(current_setting('t.plain')::uuid);
select throws_like($$select public.require_aal2()$$, '%MFA_REQUIRED%', '30: a plain session still fails the step-up');

select * from finish();
rollback;
