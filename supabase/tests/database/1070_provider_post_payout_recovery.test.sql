-- 0173: a provider-paid job refunded AFTER the driver was paid out. The customer's whole payment becomes a refund owed,
-- ConZ's commission is reversed, the driver's earnings become money owed back to ConZ, closed as repaid or written off.
begin;
select plan(26);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('rc_customer')::text, true);
select set_config('t.drv',   tests.create_driver('rc_driver', 0)::text, true);
select set_config('t.other', tests.create_driver('rc_other', 0)::text, true);
select set_config('t.sa',    tests.create_user('rc_super', array['super_admin'])::text, true);
update public.system_settings set value = '"testpay"'::jsonb where key = 'payment_provider';

-- A $300 provider-paid job (materials + transport): paid, delivered, settled ($21 commission, $279 to the driver).
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 300, 'direct')::text, true);
update public.jobs set payment_method = 'provider' where id = current_setting('t.job')::uuid;
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 300)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_service();
select set_config('t.pay', (public.create_provider_job_payment(current_setting('t.job')::uuid, 'testpay', 'rc-1')).id::text, true);
select public.apply_provider_payment('testpay', 'rc-e1', current_setting('t.pay')::uuid, 'paid', 300, 'USD', 'rc-1');
select tests.as_owner();
update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.job')::uuid);
select tests.as_owner();
select set_config('t.payable', (select id::text from public.driver_payables where job_id = current_setting('t.job')::uuid), true);
select is((select amount from public.driver_payables where id = current_setting('t.payable')::uuid), 279.00::numeric, '1: settled: driver owed $279');

-- Not paid out yet: this action refuses and points to the existing reversal.
select tests.login_as_mfa(current_setting('t.sa')::uuid);
select throws_like($$select public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')$$,
                   '%use admin_reverse_provider_settlement%', '2: before payout, use the ordinary reversal');

-- Payout started but not confirmed: refused (never act on an unclear payout).
select tests.as_owner();
update public.system_settings set value = 'true'::jsonb where key = 'payouts_enabled';
select tests.as_service();
select set_config('t.po', (public.payout_prepare(current_setting('t.payable')::uuid, 'testpay', '+263***123')).id::text, true);
select public.payout_record_sent(current_setting('t.po')::uuid, 'po-rc-1');
select tests.login_as_mfa(current_setting('t.sa')::uuid);
select throws_like($$select public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')$$,
                   '%not confirmed paid%', '3: payout sent but not confirmed: refused');
select tests.as_service();
select public.payout_record_result(current_setting('t.po')::uuid, 'paid', null, null);

-- Who may open it.
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')$$, '42501', null,
                 '4: a customer cannot open a recovery');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$select public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')$$, '42501', null,
                 '5: a driver cannot open a recovery');
select tests.login_as(current_setting('t.sa')::uuid);
select throws_like($$select public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')$$,
                   '%MFA_REQUIRED%', '6: a super admin without a fresh step-up is refused');
select tests.login_as_mfa(current_setting('t.sa')::uuid);
select throws_like($$select public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'short')$$,
                   '%at least 10 characters%', '7: a written reason is required');

-- Open it.
select set_config('t.rec', (public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')).id::text, true);
select is((public.admin_open_post_payout_refund(current_setting('t.job')::uuid, 'Load never delivered to site')).id::text, current_setting('t.rec'),
          '8: opening again returns the same recovery');
select tests.as_owner();
select is((select amount from public.driver_recoveries where id = current_setting('t.rec')::uuid), 279.00::numeric, '9: the driver owes back what was paid ($279)');
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'refund_due', '10: the customer''s whole payment is a refund owed');
select is((select sum(amount) from public.platform_ledger where job_id = current_setting('t.job')::uuid and account = 'platform_revenue'), 0::numeric,
          '11: ConZ''s commission on the job is reversed (net revenue $0)');
select is((select sum(amount) from public.platform_ledger where job_id = current_setting('t.job')::uuid and account = 'driver_recoverable'), 279.00::numeric,
          '12: $279 recorded as owed back by the driver');
select ok('recovery_open' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)),
          '13: the driver cannot delete the account while the recovery is open');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.drv')::uuid and type = 'earnings_recovery'), 1,
          '14: the driver is told');
select ok(exists (select 1 from public.admin_audit_log where action = 'post_payout_refund_opened' and target_id = current_setting('t.job')::uuid),
          '15: written to the admin audit log');

-- Who can see it; nobody writes it directly.
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.driver_recoveries), 1, '16: the driver sees their own recovery');
select throws_ok($$update public.driver_recoveries set amount = 1$$, '42501', null, '17: a driver cannot change it');
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.driver_recoveries), 0, '18: another driver sees nothing');

-- The refund itself (existing 0171 function).
select tests.login_as_mfa(current_setting('t.sa')::uuid);
select is((public.admin_mark_provider_refunded(current_setting('t.pay')::uuid, 'rf-rc-1', 'Refunded after dispute')).status, 'refunded',
          '19: the refund to the customer is recorded');

-- Closing.
select throws_like($$select public.admin_close_driver_recovery(current_setting('t.rec')::uuid, 'forgiven', null, 'Driver cannot pay')$$,
                   '%repaid or written_off%', '20: only repaid or written_off');
select throws_like($$select public.admin_close_driver_recovery(current_setting('t.rec')::uuid, 'repaid', null, 'Driver paid back')$$,
                   '%provider reference%', '21: a repayment needs the provider reference');
select is((public.admin_close_driver_recovery(current_setting('t.rec')::uuid, 'written_off', null, 'Driver cannot be reached')).status, 'written_off',
          '22: written off');
select is((public.admin_close_driver_recovery(current_setting('t.rec')::uuid, 'written_off', null, 'Driver cannot be reached')).status, 'written_off',
          '23: closing again the same way changes nothing');
select throws_like($$select public.admin_close_driver_recovery(current_setting('t.rec')::uuid, 'repaid', 'rp-1', 'Paid after all')$$,
                   '%already written_off%', '24: a closed recovery cannot change outcome');

select tests.as_owner();
select is((select coalesce(sum(amount), 0) from public.platform_ledger where account = 'driver_recoverable' and job_id = current_setting('t.job')::uuid)
          || '/' || (select sum(amount) from public.platform_ledger where account = 'platform_losses' and job_id = current_setting('t.job')::uuid),
          '0.00/279.00', '25: nothing left owed; the $279 is a recorded loss');
select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'driver_payable_matches_payables', 'job_funds_match_paid_job_payments',
                                 'provider_refunds_match_payments', 'provider_jobs_never_use_commission_credit',
                                 'provider_jobs_settled_once', 'payouts_match_payables') and not ok), 0,
          '26: ledger and provider reconciliation checks pass');

select * from finish();
rollback;
