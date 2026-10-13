-- 0097 — forgotten withdrawal-PIN recovery: identity is verified by a person outside the app,
-- approval needs a fresh second factor, the reset is one-use and time limited, rate limited,
-- audited, and withdrawals pause for 24 h afterwards.

begin;
select plan(46);
select tests.enable_launch_features();

select set_config('t.admin', tests.create_user('pr_admin', array['admin'])::text, true);
select set_config('t.drv',   tests.create_driver('pr_drv', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('pr_drv2', 100)::text, true);
select set_config('t.nopin', tests.create_driver('pr_nopin', 100)::text, true);
select set_config('t.cust',  tests.create_user('pr_cust')::text, true);
-- an admin who is also a driver with a PIN (to prove nobody approves their own reset)
select set_config('t.adrv',  tests.create_driver('pr_adrv', 100)::text, true);
insert into public.user_roles (user_id, role) values (current_setting('t.adrv')::uuid, 'admin') on conflict do nothing;

create function pg_temp.setpin(_who text, _pin text) returns void language plpgsql as $$
begin
  perform tests.login_as(current_setting(_who)::uuid);
  perform public.set_withdrawal_pin(_pin, null);
  perform tests.as_owner();
end $$;
select pg_temp.setpin('t.drv', '1111');
select pg_temp.setpin('t.drv2', '2222');
select pg_temp.setpin('t.adrv', '3333');

-- ===========================================================================
-- Asking for a reset
-- ===========================================================================
select tests.login_as(current_setting('t.nopin')::uuid);
select throws_like($$select public.request_pin_recovery()$$, '%not set a withdrawal PIN%', '1: a driver with no PIN is told to set one instead');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like($$select public.request_pin_recovery()$$, '%not set a withdrawal PIN%', '2: a user with no driver profile cannot request a reset');
select tests.as_anon();
select throws_ok($$select public.request_pin_recovery()$$, '42501', null, '3: anonymous callers cannot request a reset');

select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.r1', (public.request_pin_recovery())->>'id', true);
select tests.as_owner();
select is((select status from public.pin_recovery_requests where id = current_setting('t.r1')::uuid), 'pending', '4: the request is pending');
select is((select count(*)::int from public.wallet_audit_log where user_id = current_setting('t.drv')::uuid and action = 'pin_recovery_requested'), 1, '5: the request is audited');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.admin')::uuid and type = 'pin_recovery_request'), 1, '6: admins are told');
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.request_pin_recovery())->>'already', 'true', '7: asking again returns the same open request');
select tests.as_owner();
select is((select count(*)::int from public.pin_recovery_requests where user_id = current_setting('t.drv')::uuid), 1, '8: still exactly one request');

-- Nothing can be completed before approval
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like($$select public.complete_pin_recovery('4444')$$, '%No approved PIN reset%', '9: a pending request cannot set a PIN');

-- ===========================================================================
-- The admin decision
-- ===========================================================================
select tests.login_as(current_setting('t.drv2')::uuid);
select throws_like(format($$select public.admin_decide_pin_recovery(%L, true, 'verified on a video call')$$, current_setting('t.r1')),
  '%Forbidden%', '10: a driver cannot approve a reset');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_decide_pin_recovery(%L, true, 'verified on a video call')$$, current_setting('t.r1')),
  '%MFA_REQUIRED%', '11: an admin without a fresh second factor cannot approve');
select tests.login_as_mfa_aged(current_setting('t.admin')::uuid, 30);
select throws_like(format($$select public.admin_decide_pin_recovery(%L, true, 'verified on a video call')$$, current_setting('t.r1')),
  '%expired%', '12: an expired second factor cannot approve');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_decide_pin_recovery(%L, true, 'ok')$$, current_setting('t.r1')),
  '%how you verified%', '13: approval needs a real verification note');
select tests.as_owner();
select is((select status from public.pin_recovery_requests where id = current_setting('t.r1')::uuid), 'pending', '14: the failed attempts changed nothing');

-- An admin cannot approve their own reset
select tests.login_as(current_setting('t.adrv')::uuid);
select set_config('t.rself', (public.request_pin_recovery())->>'id', true);
select tests.login_as_mfa(current_setting('t.adrv')::uuid);
select throws_like(format($$select public.admin_decide_pin_recovery(%L, true, 'I verified myself, honest')$$, current_setting('t.rself')),
  '%your own request%', '15: nobody approves their own reset');

-- Approve drv's request
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_decide_pin_recovery(%L, true, 'Verified by video call and national ID match')$$, current_setting('t.r1')),
  '16: with a fresh second factor and a note the admin approves');
select tests.as_owner();
select is((select status from public.pin_recovery_requests where id = current_setting('t.r1')::uuid), 'approved', '17: approved');
select ok((select expires_at > now() and expires_at <= now() + interval '24 hours 1 minute' from public.pin_recovery_requests where id = current_setting('t.r1')::uuid),
  '18: the approval is valid for 24 hours');
select is((select count(*)::int from public.admin_audit_log where action = 'pin_recovery_approved' and target_user_id = current_setting('t.drv')::uuid), 1, '19: the approval is in the admin audit log');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.drv')::uuid and type = 'pin_recovery' and title = 'PIN reset approved'), 1, '20: the driver is told');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_decide_pin_recovery(%L, false, 'changing my mind after approval')$$, current_setting('t.r1')),
  '%Not pending%', '21: a decided request cannot be decided again');

-- ===========================================================================
-- Setting the new PIN
-- ===========================================================================
select tests.as_owner();
update public.pin_attempts set fail_count = 5, locked_until = now() + interval '15 minutes' where user_id = current_setting('t.drv')::uuid;
insert into public.pin_attempts (user_id, fail_count, locked_until) values (current_setting('t.drv')::uuid, 5, now() + interval '15 minutes') on conflict do nothing;

select tests.login_as(current_setting('t.drv2')::uuid);
select throws_like($$select public.complete_pin_recovery('4444')$$, '%No approved PIN reset%', '22: another driver cannot use this approval');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like($$select public.complete_pin_recovery('12')$$, '%4-8 digits%', '23: a malformed PIN is refused');
select is((public.complete_pin_recovery('4444'))->>'ok', 'true', '24: the verified driver sets a new PIN');
select tests.as_owner();
select is(public.check_withdrawal_pin(current_setting('t.drv')::uuid, '4444'), 'ok', '25: the new PIN works');
select is(public.check_withdrawal_pin(current_setting('t.drv')::uuid, '1111'), 'wrong', '26: the old PIN no longer works');
select ok((select locked_until is null and fail_count <= 1 from public.pin_attempts where user_id = current_setting('t.drv')::uuid), '27: the lockout was cleared');
select is((select status from public.pin_recovery_requests where id = current_setting('t.r1')::uuid), 'completed', '28: the request is completed');
select is((select count(*)::int from public.wallet_audit_log where user_id = current_setting('t.drv')::uuid and action = 'pin_recovery_completed'), 1, '29: completion is audited');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like($$select public.complete_pin_recovery('5555')$$, '%No approved PIN reset%', '30: the approval is single-use');

-- ===========================================================================
-- Cooling-off after a reset
-- ===========================================================================
select throws_like($$select public.request_withdrawal(40, 'ecocash', '0771234567', '4444')$$, '%WITHDRAWALS_PAUSED%', '31: withdrawals are paused for 24 hours after a reset');
select tests.as_owner();
select is((select count(*)::int from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid), 0, '32: no withdrawal was created');
update public.pin_recovery_requests set completed_at = now() - interval '25 hours' where id = current_setting('t.r1')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok($$select public.request_withdrawal(40, 'ecocash', '0771234567', '4444')$$, '33: after 24 hours withdrawals work with the new PIN');

-- ===========================================================================
-- Expiry, rejection, cancel, rate limit
-- ===========================================================================
select tests.login_as(current_setting('t.drv2')::uuid);
select set_config('t.r2', (public.request_pin_recovery())->>'id', true);
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select public.admin_decide_pin_recovery(current_setting('t.r2')::uuid, true, 'Verified in person at the depot');
select tests.as_owner();
update public.pin_recovery_requests set expires_at = now() - interval '1 minute' where id = current_setting('t.r2')::uuid;
select tests.login_as(current_setting('t.drv2')::uuid);
select is((public.complete_pin_recovery('6666'))->>'error', 'recovery_expired', '34: an expired approval cannot set a PIN');
select tests.as_owner();
select is(public.check_withdrawal_pin(current_setting('t.drv2')::uuid, '2222'), 'ok', '35: the PIN was not changed');
select is((select status from public.pin_recovery_requests where id = current_setting('t.r2')::uuid), 'expired', '36: the request is marked expired');

select tests.login_as(current_setting('t.drv2')::uuid);
select set_config('t.r3', (public.request_pin_recovery())->>'id', true);
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_decide_pin_recovery(%L, false, 'Could not reach the driver to verify')$$, current_setting('t.r3')), '37: an admin can reject a request');
select tests.as_owner();
select is((select status from public.pin_recovery_requests where id = current_setting('t.r3')::uuid), 'rejected', '38: rejected');
select tests.login_as(current_setting('t.drv2')::uuid);
select throws_like($$select public.complete_pin_recovery('7777')$$, '%No approved PIN reset%', '39: a rejected request cannot set a PIN');
select set_config('t.r4', (public.request_pin_recovery())->>'id', true);
select is((public.cancel_pin_recovery())->>'cancelled', '1', '40: the driver can cancel their own open request');
select is((public.request_pin_recovery())->>'error', 'too_many_requests', '41: a 4th request within 24 hours is refused');
select tests.as_owner();
select is((select count(*)::int from public.pin_recovery_requests where user_id = current_setting('t.drv2')::uuid and status in ('pending','approved')), 0,
  '42: a refused request leaves nothing open');
select tests.login_as(current_setting('t.drv2')::uuid);

-- ===========================================================================
-- Visibility
-- ===========================================================================
select is((select count(*)::int from public.pin_recovery_requests where user_id <> current_setting('t.drv2')::uuid), 0, '43: a driver sees only their own requests');
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select count(*) from public.pin_recovery_requests) >= 4, '44: an admin can see the requests (without any MFA)');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.pin_recovery_requests), 0, '45: other users see none');
select throws_ok($$insert into public.pin_recovery_requests (user_id, status) values (auth.uid(), 'approved')$$, '42501', null, '46: nobody can write a request directly');

select * from finish();
rollback;
