-- 0166 — optional authenticator app for admins (owner request 10/11/2026):
--   * no authenticator on the account: the Google rule works exactly as before;
--   * a verified authenticator on the account: its code is required, Google alone is refused;
--   * an unfinished (unverified) set-up changes nothing;
--   * lost phone: only the OTHER owner can reset it, with their own step-up and a reason;
--   * set-up, removal and reset are written to the admin audit log;
--   * customers, drivers, visitors and ordinary admins cannot use the owner tools.
begin;
select plan(31);
select tests.enable_launch_features();

create function pg_temp.add_google(_uid uuid) returns void language plpgsql as $$
begin
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), 'g-' || left(_uid::text, 8) || '-' || left(md5(random()::text), 6), _uid,
          jsonb_build_object('sub', 'g-' || left(_uid::text, 8), 'email', (select email from auth.users where id = _uid)),
          'google', now(), now(), now());
end $$;

create function pg_temp.login_google(_uid uuid, _minutes integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', 'aal1',
      'amr', json_build_array(json_build_object('method', 'oauth',
        'timestamp', (extract(epoch from now()) - _minutes * 60)::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.add_factor(_uid uuid, _status text) returns uuid language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (_id, _uid, 'Con Z Admin ' || left(_id::text, 6), 'totp', _status::auth.factor_status, now(), now(), 'not-a-real-secret');
  return _id;
end $$;

create function pg_temp.audit_count(_action text, _target uuid) returns integer language sql as $$
  select count(*)::int from public.admin_audit_log where action = _action and target_user_id = _target
$$;

select set_config('t.o1', tests.create_user('aa_owner1', array['super_admin', 'admin'])::text, true);
select set_config('t.o2', tests.create_user('aa_owner2', array['super_admin', 'admin'])::text, true);
select set_config('t.adm', tests.create_user('aa_admin', array['admin'])::text, true);
select set_config('t.cust', tests.create_user('aa_cust')::text, true);
select set_config('t.drv', tests.create_driver('aa_drv', 0)::text, true);
select pg_temp.add_google(current_setting('t.o1')::uuid);
select pg_temp.add_google(current_setting('t.o2')::uuid);
select pg_temp.add_google(current_setting('t.adm')::uuid);

-- 1. Nothing changes for an account without an authenticator
select pg_temp.login_google(current_setting('t.o1')::uuid, 30);
select lives_ok($$select public.require_aal2()$$, '1: no authenticator: a recent Google sign-in is accepted, as before');

-- 2. An unfinished set-up changes nothing
select tests.as_owner();
select set_config('t.f_unv', pg_temp.add_factor(current_setting('t.o1')::uuid, 'unverified')::text, true);
select is(pg_temp.audit_count('authenticator_set_up', current_setting('t.o1')::uuid), 0, '2: an unfinished set-up is not logged as set up');
select pg_temp.login_google(current_setting('t.o1')::uuid, 30);
select lives_ok($$select public.require_aal2()$$, '3: an unfinished set-up does not change the rule');

-- 3. Finishing the set-up switches the account to "authenticator required"
select tests.as_owner();
update auth.mfa_factors set status = 'verified', updated_at = now() where id = current_setting('t.f_unv')::uuid;
select is(pg_temp.audit_count('authenticator_set_up', current_setting('t.o1')::uuid), 1, '4: finishing the set-up is written to the audit log');
select ok(exists (select 1 from public.notifications where type = 'admin_action' and user_id = current_setting('t.o2')::uuid
                   and title ilike '%authenticator set up%'), '5: the other owner is told');

select pg_temp.login_google(current_setting('t.o1')::uuid, 5);
select throws_like($$select public.require_aal2()$$, '%MFA_REQUIRED: enter the code from your authenticator app%',
  '6: with an authenticator, a fresh Google sign-in alone is refused');
select throws_like($$select public.admin_set_diesel_price(2.04)$$, '%MFA_REQUIRED%', '7: ... so a real money setting is refused too');

select tests.login_as_mfa(current_setting('t.o1')::uuid);
select lives_ok($$select public.require_aal2()$$, '8: the authenticator code is accepted');
select tests.login_as_mfa_aged(current_setting('t.o1')::uuid, 30);
select throws_like($$select public.require_aal2()$$, '%verification has expired%', '9: an old code is refused');

-- 4. Other accounts are unaffected
select pg_temp.login_google(current_setting('t.o2')::uuid, 30);
select lives_ok($$select public.require_aal2()$$, '10: the other owner (no authenticator) still uses Google');

-- 5. A non-admin setting one up is not an admin event
select tests.as_owner();
select pg_temp.add_factor(current_setting('t.cust')::uuid, 'verified');
select is(pg_temp.audit_count('authenticator_set_up', current_setting('t.cust')::uuid), 0, '11: a customer''s authenticator is not an admin audit event');

-- 6. Who may use the owner tools
select tests.as_anon();
select throws_ok($$select public.owner_reset_authenticator(gen_random_uuid(), 'lost phone')$$, '42501', null, '12: a visitor cannot reset');
select throws_ok($$select * from public.admin_authenticator_overview()$$, '42501', null, '13: a visitor cannot see the overview');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.o1')), '42501', null, '14: a customer cannot reset');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.o1')), '42501', null, '15: a driver cannot reset');
select throws_ok($$select * from public.admin_authenticator_overview()$$, '42501', null, '16: a driver cannot see the overview');
select pg_temp.login_google(current_setting('t.adm')::uuid, 5);
select throws_ok(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.o1')), '42501', null, '17: an ordinary admin cannot reset, even with a fresh Google sign-in');
select throws_ok($$select * from public.admin_authenticator_overview()$$, '42501', null, '18: an ordinary admin cannot see the overview');
select throws_ok($$delete from auth.mfa_factors$$, '42501', null, '19: no signed-in user can touch the factor table directly');

-- 7. The owner reset
select tests.login_as(current_setting('t.o2')::uuid);
select throws_like(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.o1')), '%MFA_REQUIRED%',
  '20: the other owner needs their own step-up first');
select pg_temp.login_google(current_setting('t.o2')::uuid, 5);
select throws_like(format($$select public.owner_reset_authenticator(%L, 'x')$$, current_setting('t.o1')), '%written reason%', '21: a reason is required');
select throws_like(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.o2')), '%cannot reset your own%', '22: an owner cannot reset their own');
select throws_like(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.cust')), '%not an admin%', '23: only admin accounts can be reset this way');
select throws_like(format($$select public.owner_reset_authenticator(%L, 'lost phone')$$, current_setting('t.adm')), '%no authenticator%', '24: nothing to reset is reported');

select is((select has_authenticator from public.admin_authenticator_overview() where user_id = current_setting('t.o1')::uuid), true,
  '25: the overview shows who has an authenticator');
select is(public.owner_reset_authenticator(current_setting('t.o1')::uuid, 'lost phone'), 1, '26: the other owner resets it');

select tests.as_owner();
select is((select count(*)::int from auth.mfa_factors where user_id = current_setting('t.o1')::uuid), 0, '27: the authenticator is gone');
select ok(exists (select 1 from public.admin_audit_log where action = 'authenticator_reset' and actor_id = current_setting('t.o2')::uuid
                   and target_user_id = current_setting('t.o1')::uuid and reason = 'lost phone'), '28: the reset is in the audit log with who, whom and why');
select is(pg_temp.audit_count('authenticator_removed', current_setting('t.o1')::uuid), 0, '29: ... and is not logged twice');

select pg_temp.login_google(current_setting('t.o1')::uuid, 5);
select lives_ok($$select public.require_aal2()$$, '30: after the reset the account is back on the Google rule (no lock-out)');

-- 8. An admin removing their own authenticator (Supabase allows it only after a current code) is logged
select tests.as_owner();
select set_config('t.f_adm', pg_temp.add_factor(current_setting('t.adm')::uuid, 'verified')::text, true);
delete from auth.mfa_factors where id = current_setting('t.f_adm')::uuid;
select is(pg_temp.audit_count('authenticator_removed', current_setting('t.adm')::uuid), 1, '31: removing an authenticator is written to the audit log');

select * from finish();
rollback;
