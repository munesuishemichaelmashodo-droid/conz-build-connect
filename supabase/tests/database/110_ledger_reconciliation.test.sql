-- Phase 15 / I-7 — every money flow lands in the platform ledger and the
-- reconciliation passes; injected discrepancies are flagged, never fixed.

begin;
select plan(24);

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 0)::text, true);
select set_config('t.super', tests.create_user('super', array['super_admin','admin'])::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);

create or replace function pg_temp.check_ok(_name text) returns boolean language sql as $$
  select ok from public.financial_reconciliation() where check_name = _name
$$;
create or replace function pg_temp.acct(_a text) returns numeric language sql as $$
  select coalesce(-sum(amount), 0) from public.platform_ledger where account = _a
$$;

-- 1. Paynow top-up $100 for the customer
insert into public.payments (user_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, 'topup', 100, 'USD', 'paynow', 'initiated') returning set_config('t.p1', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.p1')::uuid, 'ipn', 'Paid', '100.00', current_setting('t.p1'));

-- 2. Manual (EcoCash) top-up $150 for the driver, approved by a super admin with MFA
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.tu', (public.request_topup(150, 'ecocash', 'MP241008.0001')).id::text, true);
select tests.login_as_mfa(current_setting('t.super')::uuid);
select public.admin_approve_topup(current_setting('t.tu')::uuid);

-- 3. Direct-pay job $400 -> 7% commission ($28) from the driver
select tests.as_owner();
select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b1', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b1')::uuid);
select public.complete_job(current_setting('t.j1')::uuid);

-- 4. Escrow job $300, paid and released ($279 driver, $21 revenue)
select tests.as_owner();
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow')::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 300 where id = current_setting('t.j2')::uuid;
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, current_setting('t.j2')::uuid, 'escrow', 300, 'USD', 'paynow', 'initiated') returning set_config('t.p2', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.p2')::uuid, 'ipn', 'Paid', '300.00', current_setting('t.p2'));
select tests.login_as(current_setting('t.cust')::uuid);
select public.complete_job(current_setting('t.j2')::uuid);

-- 5. Escrow job $200 paid, cancelled -> refund_due -> refunded via Paynow
select tests.as_owner();
select set_config('t.j3', tests.create_job(current_setting('t.cust')::uuid, 200, 'escrow')::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 200 where id = current_setting('t.j3')::uuid;
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, current_setting('t.j3')::uuid, 'escrow', 200, 'USD', 'paynow', 'initiated') returning set_config('t.p3', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.p3')::uuid, 'ipn', 'Paid', '200.00', current_setting('t.p3'));
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j3')::uuid, 'not needed');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select public.admin_mark_escrow_refunded(current_setting('t.p3')::uuid, 'PNR-77');

-- 6. Driver withdraws $100 (PIN), approved by an ordinary admin
select tests.login_as(current_setting('t.drv')::uuid);
select public.set_withdrawal_pin('5791', null);
select set_config('t.wd', public.request_withdrawal(100, 'ecocash', '0771234567', '5791')->'request'->>'id', true);
select tests.login_as(current_setting('t.admin')::uuid);
select public.admin_approve_withdrawal(current_setting('t.wd')::uuid);

-- 7. Admin correction: debit the customer $10
select public.admin_wallet_adjust(current_setting('t.cust')::uuid, -10, 'payment_correction', 'duplicate credit correction');

-- 8. Referral reward $15 (as process_referral_lifecycle writes it)
select tests.as_owner();
update public.wallets set balance = balance + 15 where user_id = current_setting('t.cust')::uuid;
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
values (current_setting('t.cust')::uuid, 'referral_bonus', 15, (select balance from public.wallets where user_id = current_setting('t.cust')::uuid), 'Referral reward');

-- ---------------------------------------------------------------------------
-- Balances and ledger
-- ---------------------------------------------------------------------------
select is(tests.balance(current_setting('t.cust')::uuid), 105.00::numeric, 'Customer: 100 top-up - 10 correction + 15 referral');
select is(tests.balance(current_setting('t.drv')::uuid), 301.00::numeric, 'Driver: 150 top-up - 28 commission + 279 escrow - 100 withdrawal');
select is(pg_temp.acct('platform_revenue'), 49.00::numeric, 'Revenue: $28 direct + $21 escrow commission');
select is(pg_temp.acct('paynow_clearing'), -400.00::numeric, 'Paynow clearing: +100 +300 +200 collected, -200 refunded (debit balance 400)');
select is(pg_temp.acct('manual_topups_clearing'), -150.00::numeric, 'Manual top-ups received: $150');
select is(pg_temp.acct('payouts_clearing'), 100.00::numeric, 'Paid out to users: $100');
select is(pg_temp.acct('referral_expense'), -15.00::numeric, 'Referral expense: $15');
select is(pg_temp.acct('admin_adjustments'), 10.00::numeric, 'Admin corrections: $10 removed from wallets');
select is(pg_temp.acct('escrow_held'), 0.00::numeric, 'No escrow held at the end');
select is(pg_temp.acct('refunds_payable'), 0.00::numeric, 'No refunds outstanding');

-- ---------------------------------------------------------------------------
-- Reconciliation passes
-- ---------------------------------------------------------------------------
select ok(pg_temp.check_ok('ledger_groups_balanced'), 'Every ledger entry balances');
select ok(pg_temp.check_ok('wallets_match_transactions'), 'Every wallet equals its transactions');
select ok(pg_temp.check_ok('user_wallets_match_balances'), 'Ledger user money equals the sum of wallet balances');
select ok(pg_temp.check_ok('escrow_held_matches_payments'), 'Escrow liability matches held payments');
select ok(pg_temp.check_ok('refunds_payable_matches_payments'), 'Refunds owed match refund_due payments');
select ok(pg_temp.check_ok('topups_credited_once'), 'No top-up credited twice');
select ok(pg_temp.check_ok('no_stranded_escrow'), 'No paid escrow stranded on a closed job');
select ok(pg_temp.check_ok('held_commission_matches_jobs'), 'Held commission matches active jobs');
select tests.as_service();
select ok((public.run_financial_reconciliation()).ok, 'Scheduled reconciliation run passes');

-- ---------------------------------------------------------------------------
-- Injected discrepancies are detected, reported, and NOT auto-fixed
-- ---------------------------------------------------------------------------
select tests.as_owner();
update public.wallets set balance = balance + 5 where user_id = current_setting('t.cust')::uuid;   -- money from nowhere
select ok(not pg_temp.check_ok('wallets_match_transactions') and not pg_temp.check_ok('user_wallets_match_balances'),
  'A balance change with no transaction is detected');
select tests.as_service();
select set_config('t.run', (public.run_financial_reconciliation()).id::text, true);
select tests.as_owner();
select ok((select not ok and 'wallets_match_transactions' = any(failed) from public.reconciliation_runs where id = current_setting('t.run')::uuid),
  'The run records the failing checks');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.super')::uuid and title like 'Financial reconciliation found%'),
  'Super admins are alerted');
select is(tests.balance(current_setting('t.cust')::uuid), 110.00::numeric, 'Reconciliation never "fixes" balances by itself');

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.run_financial_reconciliation()$$, '42501', null, 'Clients cannot run (or spam) reconciliation');

select * from finish();
rollback;
