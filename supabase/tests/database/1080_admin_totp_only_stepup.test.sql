-- 0174: only an authenticator-app (TOTP) code satisfies the admin step-up; 15-minute rule kept; owner-only switch.
begin;
select plan(22);

create function pg_temp.login_amr(_uid uuid, _aal text, _method text, _minutes integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated', 'aal', _aal,
      'amr', json_build_array(json_build_object('method', _method,
        'timestamp', floor(extract(epoch from now()) - _minutes * 60)::bigint)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.add_totp(_uid uuid) returns void language plpgsql as $$
begin
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), _uid, 'Con Z Admin', 'totp', 'verified', now(), now(), 'not-a-real-secret');
end $$;

select tests.as_owner();
select set_config('t.o1',  tests.create_user('tt_owner1', array['super_admin'])::text, true);
select set_config('t.o2',  tests.create_user('tt_owner2', array['super_admin'])::text, true);
select set_config('t.adm', tests.create_user('tt_admin', array['admin'])::text, true);
select pg_temp.add_totp(current_setting('t.o1')::uuid);
select pg_temp.add_totp(current_setting('t.adm')::uuid);

-- Accepted: a fresh TOTP code, under either name Supabase uses.
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'totp', 0);
select lives_ok($$select public.require_aal2()$$, '1: a fresh authenticator code (totp) is accepted');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'mfa/totp', 0);
select lives_ok($$select public.require_aal2()$$, '2: the same under the name mfa/totp');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'totp', 14);
select lives_ok($$select public.require_aal2()$$, '3: a code from 14 minutes ago still counts');

-- Rejected: too old, or not TOTP.
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'totp', 16);
select throws_like($$select public.require_aal2()$$, '%verification has expired%', '4: a code older than 15 minutes is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'mfa/webauthn', 0);
select throws_like($$select public.require_aal2()$$, '%only a code from your authenticator app%', '5: a passkey / WebAuthn second factor is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'webauthn', 0);
select throws_like($$select public.require_aal2()$$, '%only a code from your authenticator app%', '6: the old webauthn name is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'mfa/phone', 0);
select throws_like($$select public.require_aal2()$$, '%only a code from your authenticator app%', '7: a phone (SMS) second factor is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'phone', 0);
select throws_like($$select public.require_aal2()$$, '%only a code from your authenticator app%', '8: the old phone name is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'passkey', 0);
select throws_like($$select public.require_aal2()$$, '%only a code from your authenticator app%', '9: a passkey sign-in is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'password', 0);
select throws_like($$select public.require_aal2()$$, '%only a code from your authenticator app%', '10: a password claimed as aal2 is refused');
select tests.login_as_mfa_no_amr(current_setting('t.o1')::uuid);
select throws_like($$select public.require_aal2()$$, '%MFA_REQUIRED%', '11: aal2 with no amr list is refused (fail closed)');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal1', 'totp', 0);
select throws_like($$select public.require_aal2()$$, '%MFA_REQUIRED%', '12: a TOTP entry on an aal1 token is refused');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal1', 'oauth', 0);
select throws_like($$select public.require_aal2()$$, '%MFA_REQUIRED%', '13: with an authenticator set up, Google alone is still refused');

-- A real money action: same rule.
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'mfa/webauthn', 0);
select throws_like($$select public.admin_set_commission(7, 'Keep the rate at seven')$$, '%MFA_REQUIRED%',
                   '14: a commission change is refused with a passkey step-up');

-- The 30-day record: TOTP only.
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'mfa/totp', 0);
select isnt(public.admin_note_authenticator_check(), null, '15: a fresh mfa/totp code records the 30-day check');
select pg_temp.login_amr(current_setting('t.adm')::uuid, 'aal2', 'mfa/webauthn', 0);
select throws_like($$select public.admin_note_authenticator_check()$$, '%MFA_REQUIRED%', '16: a passkey cannot record the 30-day check');

-- Owner-only switch.
select pg_temp.login_amr(current_setting('t.adm')::uuid, 'aal2', 'totp', 0);
select throws_ok($$select public.admin_set_authenticator_required(true, 'Turn it on now')$$, '42501', null,
                 '17: an ordinary admin with a fresh code cannot change the requirement');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'mfa/webauthn', 0);
select throws_like($$select public.admin_set_authenticator_required(true, 'Turn it on now')$$, '%MFA_REQUIRED%',
                   '18: an owner with a passkey step-up cannot change it');
-- A super admin who is no longer a listed owner (removed from the list by database access only).
select tests.as_owner();
delete from public.super_admin_owners where user_id = current_setting('t.o2')::uuid;
select pg_temp.add_totp(current_setting('t.o2')::uuid);
select pg_temp.login_amr(current_setting('t.o2')::uuid, 'aal2', 'totp', 0);
select throws_like($$select public.admin_set_authenticator_required(true, 'Turn it on now')$$, '%Only an owner%',
                   '19: a super admin who is not a listed owner cannot change it');
select pg_temp.login_amr(current_setting('t.o1')::uuid, 'aal2', 'totp', 0);
select is((public.admin_set_authenticator_required(true, 'Both owners verified'))->>'required', 'true',
          '20: a listed owner with a fresh code switches it on');
select is((public.admin_set_authenticator_required(false, 'Back off for the test'))->>'required', 'false',
          '21: and off again');
select tests.as_owner();
select is((select count(*)::int from public.admin_audit_log where action = 'authenticator_required_changed'
            and actor_id = current_setting('t.o1')::uuid), 2, '22: both changes are in the audit log');

select * from finish();
rollback;
