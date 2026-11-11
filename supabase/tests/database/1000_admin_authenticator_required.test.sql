-- 0169 — "authenticator required" switch (owner request 11/11/2026):
--   * default OFF: Google step-up works exactly as before (nobody is locked out on day one);
--   * only a super admin with their OWN authenticator can switch it on, with a reason and a fresh code;
--   * ON: Google alone is refused for every admin; an admin without an authenticator is told to set one up;
--   * ON: an admin with an authenticator and a fresh code still passes; OFF again restores the Google rule;
--   * every change is written to the admin audit log.
begin;
select plan(30);
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

select set_config('t.o1', tests.create_user('ar_owner1', array['super_admin', 'admin'])::text, true);
select set_config('t.o2', tests.create_user('ar_owner2', array['super_admin', 'admin'])::text, true);
select set_config('t.adm', tests.create_user('ar_admin', array['admin'])::text, true);
select set_config('t.cust', tests.create_user('ar_cust')::text, true);
select pg_temp.add_google(current_setting('t.o1')::uuid);
select pg_temp.add_google(current_setting('t.o2')::uuid);
select pg_temp.add_google(current_setting('t.adm')::uuid);

-- 1. Default OFF
select pg_temp.login_google(current_setting('t.o1')::uuid, 30);
select is((public.admin_authenticator_policy() ->> 'required')::boolean, false, '1: required is OFF by default');
select lives_ok($$select public.require_aal2()$$, '2: OFF: a recent Google sign-in still works');

-- 2. Who may read the policy / change it
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.admin_authenticator_policy()$$, '42501', null, '3: a customer cannot read the policy');
select tests.as_anon();
select throws_ok($$select public.admin_set_authenticator_required(true, 'make it strict')$$, '42501', null, '4: a visitor cannot switch it');
select pg_temp.login_google(current_setting('t.adm')::uuid, 5);
select lives_ok($$select public.admin_authenticator_policy()$$, '5: an ordinary admin can read the policy');
select throws_ok($$select public.admin_set_authenticator_required(true, 'make it strict')$$, '42501', null, '6: an ordinary admin cannot switch it');

-- 3. Owner without an authenticator cannot switch it on (they would lock themselves out)
select pg_temp.login_google(current_setting('t.o1')::uuid, 5);
select throws_like($$select public.admin_set_authenticator_required(true, 'make it strict')$$, '%own authenticator%',
  '7: an owner with no authenticator cannot switch it on');

-- 4. Owner with an authenticator: needs a fresh code and a reason
select tests.as_owner();
select pg_temp.add_factor(current_setting('t.o1')::uuid, 'verified');
select pg_temp.login_google(current_setting('t.o1')::uuid, 5);
select throws_like($$select public.admin_set_authenticator_required(true, 'make it strict')$$, '%MFA_REQUIRED%',
  '8: even a fresh Google sign-in is not enough once they have an authenticator');
select tests.login_as_mfa(current_setting('t.o1')::uuid);
select throws_like($$select public.admin_set_authenticator_required(true, 'x')$$, '%written reason%', '9: a reason is required');
select is((public.admin_set_authenticator_required(true, 'owners decided: authenticator only') ->> 'required')::boolean, true,
  '10: the owner switches it on with a code and a reason');

select tests.as_owner();
select ok(exists (select 1 from public.admin_audit_log where action = 'authenticator_required_changed'
                   and actor_id = current_setting('t.o1')::uuid and reason = 'owners decided: authenticator only'),
  '11: the change is in the audit log with who and why');
select ok(exists (select 1 from public.notifications where type = 'admin_action' and user_id = current_setting('t.o2')::uuid
                   and created_at > now() - interval '5 minutes'), '12: the other owner is told');
select is((select (value #>> '{}')::boolean from public.system_settings where key = 'admin_authenticator_required'), true,
  '13: the setting is stored');

-- 4b. The 30-day rule: a record of the last accepted code, written only from a verified session
select tests.login_as_mfa(current_setting('t.o1')::uuid);
select is((public.admin_authenticator_policy() ->> 'expired')::boolean, true, '13a: has an authenticator but never checked: counts as expired');
select pg_temp.login_google(current_setting('t.o1')::uuid, 5);
select throws_like($$select public.admin_note_authenticator_check()$$, '%MFA_REQUIRED%', '13b: a Google-only session cannot record a check');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.admin_note_authenticator_check()$$, '42501', null, '13c: a customer cannot record a check');
select tests.login_as_mfa_aged(current_setting('t.o1')::uuid, 30);
select throws_like($$select public.admin_note_authenticator_check()$$, '%new code%', '13d: an old code cannot record a check');
select tests.login_as_mfa(current_setting('t.o1')::uuid);
select ok(public.admin_note_authenticator_check() is not null, '13e: a fresh code records the check');
select is((public.admin_authenticator_policy() ->> 'expired')::boolean, false, '13f: after a check the 30-day limit is not passed');
select is((public.admin_authenticator_policy() ->> 'days_left')::integer, 30, '13g: 30 days left right after a check');
select tests.as_owner();
update public.admin_authenticator_checks set verified_at = now() - interval '31 days'
 where user_id = current_setting('t.o1')::uuid;
select tests.login_as_mfa(current_setting('t.o1')::uuid);
select is((public.admin_authenticator_policy() ->> 'expired')::boolean, true, '13h: 31 days after the last check it is expired again');

-- 5. ON: Google alone is refused, for anyone without an authenticator
select pg_temp.login_google(current_setting('t.o2')::uuid, 5);
select throws_like($$select public.require_aal2()$$, '%set up your authenticator app first%',
  '14: ON: an owner with no authenticator is told to set one up (Google is refused)');
select throws_like($$select public.admin_set_diesel_price(2.04)$$, '%MFA_REQUIRED%', '15: ON: a money setting is refused with Google alone');
select pg_temp.login_google(current_setting('t.adm')::uuid, 5);
select throws_like($$select public.require_aal2()$$, '%set up your authenticator app first%', '16: ON: same for an ordinary admin');

-- 6. ON: a fresh code still passes; an old one does not
select tests.login_as_mfa(current_setting('t.o1')::uuid);
select lives_ok($$select public.require_aal2()$$, '17: ON: the authenticator code is accepted');
select tests.login_as_mfa_aged(current_setting('t.o1')::uuid, 30);
select throws_like($$select public.require_aal2()$$, '%verification has expired%', '18: ON: a code older than the window is refused');

-- 7. Switching it off restores the Google rule
select tests.login_as_mfa(current_setting('t.o1')::uuid);
select is((public.admin_set_authenticator_required(false, 'testing the off switch') ->> 'required')::boolean, false, '19: the owner can switch it off');
select pg_temp.login_google(current_setting('t.o2')::uuid, 30);
select lives_ok($$select public.require_aal2()$$, '20: OFF again: Google works for an admin with no authenticator');
select tests.as_owner();
select is((select count(*)::int from public.admin_audit_log where action = 'authenticator_required_changed'), 2, '21: both changes are logged');
select is((select (value #>> '{}')::boolean from public.system_settings where key = 'admin_authenticator_required'), false, '22: the setting is stored as off');

select * from finish();
rollback;
