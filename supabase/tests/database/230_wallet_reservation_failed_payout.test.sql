-- 0095 — withdrawal reservation, failed-payout reversal, limited-flag logic, top-up limits.

begin;
select plan(27);
select tests.enable_launch_features();

select set_config('t.drv',   tests.create_driver('rs_drv', 100)::text, true);
select set_config('t.neg',   tests.create_driver('rs_neg', 100)::text, true);
select set_config('t.admin', tests.create_user('rs_admin', array['admin'])::text, true);
select set_config('t.admin2',tests.create_user('rs_admin2', array['admin'])::text, true);
select set_config('t.super', tests.create_user('rs_super', array['super_admin','admin'])::text, true);
select set_config('t.cust',  tests.create_user('rs_cust')::text, true);

create or replace function pg_temp.w(_u text) returns public.wallets language sql as $$
  select * from public.wallets where user_id = current_setting(_u)::uuid $$;

-- ── Reservation ─────────────────────────────────────────────
select tests.login_as(current_setting('t.drv')::uuid);
select public.set_withdrawal_pin('4826', null);
select public.request_withdrawal(70, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.wd', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status='pending'), true);
select is((pg_temp.w('t.drv')).withdrawal_reserved, 70::numeric, 'A pending withdrawal reserves its amount');
select is((pg_temp.w('t.drv')).balance, 100::numeric, 'The balance itself is untouched until approval');
select is(public.wallet_available(current_setting('t.drv')::uuid), 30::numeric, 'Available = balance - held - reserved');

select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_wallet_adjust(%L, -40, 'other', 'trying to eat reserved funds')$$, current_setting('t.drv')),
  '%reserved funds%', 'An admin debit cannot eat into reserved withdrawal funds');
select tests.as_owner();
select is((pg_temp.w('t.drv')).balance, 100::numeric, 'Refused debit left the balance unchanged');

-- Cancel releases
select tests.login_as(current_setting('t.drv')::uuid);
select public.cancel_withdrawal(current_setting('t.wd')::uuid);
select tests.as_owner();
select is((pg_temp.w('t.drv')).withdrawal_reserved, 0::numeric, 'Cancelling releases the reservation');

-- Reject releases
select tests.login_as(current_setting('t.drv')::uuid);
select public.request_withdrawal(50, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.wd', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status='pending'), true);
select is((pg_temp.w('t.drv')).withdrawal_reserved, 50::numeric, 'Second request reserves again');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select public.admin_reject_withdrawal(current_setting('t.wd')::uuid, 'rejecting for the reservation test');
select tests.as_owner();
select is((pg_temp.w('t.drv')).withdrawal_reserved, 0::numeric, 'Rejecting releases the reservation');

-- Approve: reservation converts into the debit
select tests.login_as(current_setting('t.drv')::uuid);
select public.request_withdrawal(40, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.wd', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status='pending'), true);
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select public.admin_approve_withdrawal(current_setting('t.wd')::uuid);
select tests.as_owner();
select is((pg_temp.w('t.drv')).balance, 60::numeric, 'Approval debits the wallet once');
select is((pg_temp.w('t.drv')).withdrawal_reserved, 0::numeric, 'Approval clears the reservation (no double count)');
select is(public.wallet_available(current_setting('t.drv')::uuid), 60::numeric, 'Available after approval = new balance');

-- ── Failed payout reversal ──────────────────────────────────
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_failed(%L, 'driver tries it')$$, current_setting('t.wd')), '%Forbidden%', 'A driver cannot mark a payout failed');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_failed(%L, 'no')$$, current_setting('t.wd')), '%reason%', 'A reason is mandatory');
select public.admin_mark_withdrawal_failed(current_setting('t.wd')::uuid, 'EcoCash transfer bounced: wrong number');
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wd')::uuid), 'failed', 'Request is now failed');
select is((pg_temp.w('t.drv')).balance, 100::numeric, 'The debit was returned to the wallet');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and type='withdrawal' and amount > 0 and reversal_of_transaction_id is not null),
  1, 'Exactly one linked reversal transaction exists; the original is not deleted');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and type='withdrawal' and amount < 0),
  1, 'The original debit row is preserved');
select tests.login_as_mfa(current_setting('t.admin2')::uuid);
select lives_ok(format($$select public.admin_mark_withdrawal_failed(%L, 'repeat click, should be idempotent')$$, current_setting('t.wd')), 'Marking failed twice is idempotent');
select tests.as_owner();
select is((pg_temp.w('t.drv')).balance, 100::numeric, 'The repeat did not credit again');
select ok((select bool_and(ok) from public.financial_reconciliation() where check_name in ('ledger_groups_balanced','withdrawal_reserved_matches_pending','failed_payouts_reversed_once')),
  'Reconciliation (ledger groups, reservation, failed-payout reversal) is clean');

-- A payout recorded as sent can no longer be failed
select tests.login_as(current_setting('t.drv')::uuid);
select public.request_withdrawal(10, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.wd2', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status='pending'), true);
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select public.admin_approve_withdrawal(current_setting('t.wd2')::uuid);
select tests.login_as_mfa(current_setting('t.admin2')::uuid);
select public.admin_mark_withdrawal_paid(current_setting('t.wd2')::uuid, 'EC-REF-12345');
select throws_like(format($$select public.admin_mark_withdrawal_failed(%L, 'too late to fail it')$$, current_setting('t.wd2')), '%already been recorded as sent%', 'A sent payout cannot be marked failed');

-- ── limited flag follows the balance ────────────────────────
select tests.as_owner();
update public.wallets set balance = -30 where user_id = current_setting('t.neg')::uuid;
select ok((pg_temp.w('t.neg')).limited, 'Negative balance => limited');
insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url)
values (current_setting('t.neg')::uuid, 'topup', 10, 'USD', 'paynow', 'initiated', 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=n1')
returning set_config('t.pn1', id::text, true);
select public.credit_wallet_from_payment(current_setting('t.pn1')::uuid);
select ok((pg_temp.w('t.neg')).limited, 'A Paynow top-up that leaves the wallet negative does NOT lift the restriction');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select public.admin_wallet_adjust(current_setting('t.neg')::uuid, 30, 'payment_correction', 'brings the wallet positive');
select tests.as_owner();
select ok(not (pg_temp.w('t.neg')).limited, 'Once the balance is >= 0 the restriction lifts');

-- ── top-up limits ───────────────────────────────────────────
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like($$select public.request_topup(10, 'ecocash', '')$$, '%reference%', 'A manual top-up needs a reference');
select public.request_topup(10, 'ecocash', 'MP-REF-0001');
select throws_like($$select public.request_topup(10, 'ecocash', 'mp-ref-0001')$$, '%already been submitted%', 'A transfer reference cannot be submitted twice');
select tests.as_owner();
do $$ begin
  for i in 1..5 loop
    insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url)
    values (current_setting('t.cust')::uuid, 'topup', 1, 'USD', 'paynow', 'initiated', 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=r' || i);
  end loop;
end $$;
select throws_like($$insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url) values (current_setting('t.cust')::uuid, 'topup', 1, 'USD', 'paynow', 'initiated', 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=r6')$$,
  '%Too many top-up attempts%', 'More than 5 top-up attempts per hour is refused');

select * from finish();
rollback;
