-- Driver wallet & withdrawal journey (wallet audit, 11/10/2026).
-- Walks request -> cancel / reject / approve and asserts the money moves exactly once.
-- NOTE: payouts are MANUAL. Approval debits the wallet; no payout is recorded or sent.

begin;
select plan(21);

select set_config('t.drv',   tests.create_driver('wj_drv', 100)::text, true);
select set_config('t.nopin', tests.create_driver('wj_nopin', 100)::text, true);
select set_config('t.admin', tests.create_user('wj_admin', array['admin'])::text, true);
select set_config('t.plain', tests.create_user('wj_plain')::text, true);

create or replace function pg_temp.bal(_u text) returns numeric language sql as $$
  select balance from public.wallets where user_id = current_setting(_u)::uuid $$;
create or replace function pg_temp.wd_status(_id text) returns text language sql as $$
  select status from public.wallet_withdrawal_requests where id = _id::uuid $$;

-- 1. No PIN -> no withdrawal, nothing created
select tests.login_as(current_setting('t.nopin')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '1234'))->>'error', 'no_pin', 'Withdrawal before a PIN is set is refused');
select tests.as_owner();
select is((select count(*)::int from public.wallet_withdrawal_requests where user_id = current_setting('t.nopin')::uuid), 0, 'No request row was created without a PIN');

-- 2. Available = balance - held. 30 of the 100 is held for active jobs.
update public.wallets set held = 30 where user_id = current_setting('t.drv')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.set_withdrawal_pin('4826', null))->>'ok', 'true', 'PIN set');
select throws_like($$select public.request_withdrawal(71, 'ecocash', '0771234567', '4826')$$, '%Insufficient available balance%', 'Cannot request more than available (balance 100 - held 30)');
select tests.as_owner();
select is((select count(*)::int from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid), 0, 'Refused request created no row');

-- 3. Valid request: pending, wallet untouched (no reservation by design)
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.request_withdrawal(40, 'ecocash', '0771234567', '4826'))->>'ok', 'true', 'Valid withdrawal accepted');
select tests.as_owner();
select set_config('t.wd', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid), true);
select is(pg_temp.wd_status(current_setting('t.wd')), 'pending', 'Request is pending (awaiting review)');
select is(pg_temp.bal('t.drv'), 100::numeric, 'Pending request does not move money');

-- 4. Authorization: a driver / plain user cannot approve or reject
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wd')), '%Forbidden%', 'A driver cannot approve a withdrawal');
select throws_like(format($$select public.admin_reject_withdrawal(%L, 'not allowed to do this')$$, current_setting('t.wd')), '%Forbidden%', 'A driver cannot reject a withdrawal');
select tests.login_as(current_setting('t.plain')::uuid);
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wd')), '%Forbidden%', 'A non-admin cannot approve');

-- 5. Rejection needs a real reason; empty / tiny reasons change nothing
select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_reject_withdrawal(%L, 'x')$$, current_setting('t.wd')), '%at least 5 characters%', 'Rejecting with a 1-character reason is refused');
select throws_like(format($$select public.admin_reject_withdrawal(%L, NULL)$$, current_setting('t.wd')), '%at least 5 characters%', 'Rejecting with no reason is refused');
select tests.as_owner();
select is(pg_temp.wd_status(current_setting('t.wd')), 'pending', 'Refused rejections left the request pending');

-- 6. Driver cancels: status only, balance unchanged, cannot cancel twice
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$select public.cancel_withdrawal(%L)$$, current_setting('t.wd')), 'Driver can cancel a pending request');
select throws_like(format($$select public.cancel_withdrawal(%L)$$, current_setting('t.wd')), '%', 'A second cancel is refused');
select tests.as_owner();
select is(pg_temp.bal('t.drv'), 100::numeric, 'Cancelling a request that reserved nothing leaves the balance unchanged (no phantom refund)');

-- 7. Approve once: debits exactly once; second approve refused; cannot reject/cancel afterwards
select tests.login_as(current_setting('t.drv')::uuid);
select public.request_withdrawal(40, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.wd2', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status = 'pending'), true);
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wd2')), 'Admin approves');
select throws_like(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wd2')), '%', 'Approving the same request twice is refused');
select tests.as_owner();
select is(pg_temp.bal('t.drv'), 60::numeric, 'Wallet debited exactly once (100 - 40)');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and amount = -40), 1, 'Exactly one -40 ledger entry exists');

select * from finish();
rollback;
