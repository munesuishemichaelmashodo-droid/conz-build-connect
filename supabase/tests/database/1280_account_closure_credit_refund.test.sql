-- 0194: closing an account refunds UNUSED PURCHASED Commission Credit only, through a super admin who records the
-- refund sent outside the app (reference required, step-up required). Promo credit is forfeited, never refunded.
-- Nothing is paid automatically; while a request is open the driver cannot send offers; afterwards deletion is unblocked.
begin;
select plan(24);

select tests.as_owner();
update public.system_settings set value = '100000'::jsonb where key = 'max_wallet_balance';
select set_config('t.drv',   tests.create_driver('ac_driver', 35)::text, true);
select set_config('t.other', tests.create_driver('ac_other', 10)::text, true);
select set_config('t.cust',  tests.create_user('ac_cust')::text, true);
select set_config('t.admin', tests.create_user('ac_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('ac_super', array['super_admin','admin'])::text, true);
update public.wallets set promo_balance = 20 where user_id = current_setting('t.drv')::uuid;
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid)::text, true);

-- ============================================================ A. before 0194 the balance blocked deletion forever
select ok('wallet_balance_positive' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)),
          '1: unused purchased credit blocks deletion');

-- ============================================================ B. the driver's request
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$ select public.request_account_closure('cash', '0771234567') $$, '22023', null, '2: unknown refund method refused');
select throws_ok($$ select public.request_account_closure('ecocash', ' ') $$, '22023', null, '3: a destination is required');
select set_config('t.req', public.request_account_closure('ecocash', '0771234567')::text, true);
select is((select status from public.account_closure_requests where id = current_setting('t.req')::uuid), 'requested', '4: request recorded');
select is((select purchased_credit_at_request from public.account_closure_requests where id = current_setting('t.req')::uuid), 35.00::numeric,
          '5: the purchased credit is recorded');
select is((select promo_forfeited from public.account_closure_requests where id = current_setting('t.req')::uuid), 20.00::numeric,
          '6: the promo credit is recorded as forfeited, not refundable');
select throws_ok($$ select public.request_account_closure('ecocash', '0771234567') $$, '23505', null, '7: one open request at a time');
select throws_ok($$ insert into public.account_closure_requests (user_id, purchased_credit_at_request, refund_method, refund_destination)
                    values (auth.uid(), 999, 'ecocash', '0771234567') $$, '42501', null, '8: no direct writes');
select throws_ok(format($$ insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 300, %L) $$,
                 current_setting('t.job'), current_setting('t.drv'), tests.truck_of(current_setting('t.drv')::uuid)),
                 '55000', null, '9: no new offers while the request is open');

-- other people cannot see it
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*) from public.account_closure_requests)::int, 0, '10: another driver sees nothing');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*) from public.account_closure_requests)::int, 1, '11: an admin can see it');

-- ============================================================ C. only a super admin with a step-up records the refund
select throws_ok(format($$ select public.admin_record_closure_refund(%L, 'MP2611ABCD', null) $$, current_setting('t.req')),
                 '42501', null, '12: a plain admin cannot record a refund');
select tests.login_as(current_setting('t.super')::uuid);
select throws_ok(format($$ select public.admin_record_closure_refund(%L, 'MP2611ABCD', null) $$, current_setting('t.req')),
                 null, null, '13: a super admin without a fresh step-up is refused');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$ select public.admin_record_closure_refund(%L, ' ', null) $$, current_setting('t.req')),
                 '22023', null, '14: a transaction reference is required');
select tests.as_owner();
update public.wallets set balance = 30 where user_id = current_setting('t.drv')::uuid;  -- e.g. a commission charged meanwhile
select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$ select public.admin_record_closure_refund(%L, 'MP2611ABCD', 'Sent by EcoCash') $$, current_setting('t.req')),
                '15: the super admin records the refund');
select tests.as_owner();
select is((select refunded_amount from public.account_closure_requests where id = current_setting('t.req')::uuid), 30.00::numeric,
          '16: the refund is the CURRENT purchased balance, not the amount at request time');
select is(tests.balance(current_setting('t.drv')::uuid), 0.00::numeric, '17: purchased credit is now 0');
select is((select promo_balance from public.wallets where user_id = current_setting('t.drv')::uuid), 20.00::numeric,
          '18: promo credit is not paid out');
select ok(exists (select 1 from public.wallet_transactions where user_id = current_setting('t.drv')::uuid
                   and amount = -30 and category = 'refund'), '19: the debit is in the wallet history as a refund');
select ok(exists (select 1 from public.admin_audit_log where action = 'account_closure_refunded'), '20: audited');
select ok(not ('wallet_balance_positive' = any(coalesce(public.account_deletion_blockers(current_setting('t.drv')::uuid), '{}'))),
          '21: deletion is no longer blocked by the balance');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$ select public.admin_record_closure_refund(%L, 'MP2611ABCE', null) $$, current_setting('t.req')),
                 '55000', null, '22: a request cannot be refunded twice');

-- ============================================================ D. a reference cannot be reused; cancel
select tests.login_as(current_setting('t.other')::uuid);
select set_config('t.req2', public.request_account_closure('bank', 'CBZ 0123456789')::text, true);
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$ select public.admin_record_closure_refund(%L, 'mp2611abcd', null) $$, current_setting('t.req2')),
                 '23505', null, '23: a reference already used is refused');
select tests.login_as(current_setting('t.other')::uuid);
select public.cancel_account_closure(current_setting('t.req2')::uuid);
select is((select status from public.account_closure_requests where id = current_setting('t.req2')::uuid), 'cancelled',
          '24: the driver can cancel an open request');

select * from finish();
rollback;
