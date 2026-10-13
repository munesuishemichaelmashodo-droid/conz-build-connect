-- 0096 — admin step-up policy (owner decision 12/10/2026):
--   * NO mandatory MFA for admin login or ordinary admin work;
--   * sensitive money actions need a FRESH second factor (aal2 + recent TOTP), enforced here in
--     the database, for the right roles, and they stop working when the step-up is missing or old.

begin;
select plan(34);
select tests.enable_launch_features();

select set_config('t.admin', tests.create_user('su_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('su_super', array['super_admin','admin'])::text, true);
select set_config('t.plain', tests.create_user('su_plain')::text, true);
select set_config('t.da', tests.create_driver('su_da', 100)::text, true);
select set_config('t.db', tests.create_driver('su_db', 100)::text, true);
select set_config('t.dc', tests.create_driver('su_dc', 100)::text, true);
select set_config('t.dd', tests.create_driver('su_dd', 100)::text, true);

create function pg_temp.wd(_who text) returns uuid language plpgsql as $$
declare _id uuid;
begin
  perform tests.login_as(current_setting(_who)::uuid);
  perform public.set_withdrawal_pin('2468', null);
  _id := (public.request_withdrawal(40, 'ecocash', '0771234567', '2468'))->'request'->>'id';
  perform tests.as_owner();
  return _id;
end $$;

select set_config('t.wda', pg_temp.wd('t.da')::text, true);
select set_config('t.wdb', pg_temp.wd('t.db')::text, true);
select set_config('t.wdc', pg_temp.wd('t.dc')::text, true);
select set_config('t.wdd', pg_temp.wd('t.dd')::text, true);

-- ===========================================================================
-- Ordinary admin work needs no MFA enrolment
-- ===========================================================================
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select count(*) from public.wallet_withdrawal_requests where status = 'pending') >= 4,
  '1: an ordinary admin (no MFA) can see the withdrawal queue');
select lives_ok(format($$select public.admin_reject_withdrawal(%L, 'duplicate request, please resubmit')$$, current_setting('t.wdb')),
  '2: an ordinary admin (no MFA) can reject a request');
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wdb')::uuid), 'rejected', '3: rejected');
select is((select withdrawal_reserved from public.wallets where user_id = current_setting('t.db')::uuid), 0.00::numeric,
  '4: the rejected request''s reservation was released');

-- ===========================================================================
-- Approving a payout: every admin role needs a fresh second factor
-- ===========================================================================
select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '%MFA_REQUIRED%', '5: an admin without a second-factor session cannot approve a payout');
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wda')::uuid), 'pending', '6: request still pending');
select is(tests.balance(current_setting('t.da')::uuid), 100.00::numeric, '7: no money moved');

select tests.login_as(current_setting('t.plain')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '%Forbidden%', '8: a non-admin cannot approve even with an aal2 claim');
select tests.login_as_mfa(current_setting('t.plain')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '%Forbidden%', '9: MFA does not make a non-admin an admin');
select tests.as_anon();
select throws_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '42501', null, '10: anonymous callers cannot execute payout functions');

select tests.login_as_mfa_aged(current_setting('t.admin')::uuid, 30);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '%expired%', '11: an expired step-up (verified 30 minutes ago) is refused');
select tests.as_owner();
select is(tests.balance(current_setting('t.da')::uuid), 100.00::numeric, '12: still no money moved');

select tests.login_as_mfa_aged(current_setting('t.admin')::uuid, 5);
select lives_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '13: a fresh step-up (verified 5 minutes ago) approves the payout');
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wda')::uuid), 'approved', '14: approved');
select is(tests.balance(current_setting('t.da')::uuid), 60.00::numeric, '15: debited exactly once');
select is((select count(*)::int from public.wallet_audit_log where user_id = current_setting('t.da')::uuid and action = 'withdrawal_approved'), 1,
  '16: the approval is in the audit log');

select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wda')),
  '%Not pending%', '17: approving twice is refused (no double debit)');
select tests.as_owner();
select is(tests.balance(current_setting('t.da')::uuid), 60.00::numeric, '18: balance unchanged by the repeat');

-- ===========================================================================
-- Recording a payout as sent / marking it failed
-- ===========================================================================
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select public.admin_approve_withdrawal(current_setting('t.wdc')::uuid);

select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-STEP-1')$$, current_setting('t.wda')),
  '%MFA_REQUIRED%', '19: recording a payout as sent needs a second factor');
select throws_like(format($$select public.admin_mark_withdrawal_failed(%L, 'wrong number supplied')$$, current_setting('t.wdc')),
  '%MFA_REQUIRED%', '20: marking a payout failed (which returns the money) needs a second factor');
select tests.as_owner();
select ok((select paid_at is null from public.wallet_withdrawal_requests where id = current_setting('t.wda')::uuid), '21: nothing was recorded as sent');
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wdc')::uuid), 'approved', '22: the failed-payout attempt changed nothing');

select tests.login_as_mfa_aged(current_setting('t.admin')::uuid, 30);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-STEP-1')$$, current_setting('t.wda')),
  '%expired%', '23: an expired step-up cannot record a payout either');

select tests.login_as_mfa(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-STEP-1')$$, current_setting('t.wda')), '24: with a fresh step-up the payout is recorded');
select lives_ok(format($$select public.admin_mark_withdrawal_failed(%L, 'wrong number supplied')$$, current_setting('t.wdc')), '25: and a failed payout can be reversed');
select tests.as_owner();
select is(tests.balance(current_setting('t.dc')::uuid), 100.00::numeric, '26: the failed payout returned the money');

-- A token with aal2 but no timing information (no amr claim) behaves as before 0096.
select tests.login_as_mfa_no_amr(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wdd')),
  '27: aal2 without an amr claim is accepted (no timing information to check)');

-- ===========================================================================
-- Super-admin credits: aal2 + fresh, and nobody else can do them
-- ===========================================================================
select tests.login_as(current_setting('t.super')::uuid);
select throws_like(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'credit without a second factor')$$, current_setting('t.da')),
  '%MFA_REQUIRED%', '28: a super admin without a second-factor session cannot credit a wallet');
select tests.login_as_mfa_aged(current_setting('t.super')::uuid, 30);
select throws_like(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'credit with an expired factor')$$, current_setting('t.da')),
  '%expired%', '29: an expired step-up cannot credit a wallet');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'goodwill credit, fresh factor')$$, current_setting('t.da')),
  '30: a fresh step-up credits the wallet');
select tests.as_owner();
select is(tests.balance(current_setting('t.da')::uuid), 110.00::numeric, '31: credited once');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'an ordinary admin never creates money')$$, current_setting('t.da')),
  '%super admin%', '32: an ordinary admin cannot credit even with a fresh step-up');
select tests.login_as_mfa(current_setting('t.da')::uuid);
select throws_ok(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'a driver trying to credit themselves')$$, current_setting('t.da')),
  null, null, '33: an ordinary user cannot invoke the wallet adjustment function');

-- The window is a setting
select tests.as_owner();
update public.system_settings set value = '{"max_age_minutes": 1}'::jsonb where key = 'admin_stepup';
select tests.login_as_mfa_aged(current_setting('t.admin')::uuid, 5);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-STEP-2')$$, current_setting('t.wdd')),
  '%expired%', '34: the step-up window is configurable (1 minute here)');

select * from finish();
rollback;
