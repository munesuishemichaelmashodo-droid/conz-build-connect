-- 0171: provider-collected jobs. 7% of the transport fare from the collected payment, exactly once;
-- never from commission credit; earnings payable kept apart from the wallet; payouts never retried blindly;
-- duplicate / mismatched / out-of-order events; cancellation refund; reconciliation; direct jobs unchanged.
begin;
select plan(52);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('pv_customer')::text, true);
select set_config('t.drv',   tests.create_driver('pv_driver', 0)::text, true);     -- NO commission credit
select set_config('t.drv2',  tests.create_driver('pv_driver2', 100)::text, true);  -- direct-pay regression driver
select set_config('t.other', tests.create_driver('pv_other', 0)::text, true);
select set_config('t.sa',    tests.create_user('pv_super', array['super_admin'])::text, true);

-- ---------------------------------------------------------------- switches OFF by default
select is((select value #>> '{}' from public.system_settings where key = 'payment_provider'), 'none', '1: provider collection is off by default');
select is((select value #>> '{}' from public.system_settings where key = 'payouts_enabled'), 'false', '2: payouts are off by default');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like($$select tests.create_job(current_setting('t.cust')::uuid, 300, 'provider')$$,
                   '%not available yet%', '3: no provider-paid job while collection is off');

select tests.as_owner();
update public.system_settings set value = '"testpay"'::jsonb where key = 'payment_provider';
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like($$select tests.create_job(current_setting('t.cust')::uuid, 300, 'provider')$$,
                   '%transport-only%', '4: a provider-paid job must be transport-only');

-- A transport-only provider job (built as the owner: the quote path is covered by 950).
select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 300, 'direct')::text, true);
update public.jobs set payment_method = 'provider', pricing_basis = 'transport_only' where id = current_setting('t.job')::uuid;
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 300)::text, true);

-- ---------------------------------------------------------------- acceptance: no credit needed, none reserved
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select public.accept_bid(current_setting('t.bid')::uuid)$$, '5: a driver with $0 credit can be accepted on a provider-paid job');
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 0::numeric, '6: nothing reserved on the job');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric, '7: nothing held in the commission-credit wallet');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid), 0, '8: no wallet transaction at acceptance');
select throws_ok($$update public.jobs set held_commission = 5 where id = current_setting('t.job')::uuid$$, '23514', null,
                 '9: the database refuses a credit reserve on a provider-paid job');

-- ---------------------------------------------------------------- no loading before payment
select throws_like($$update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid$$,
                   '%payment has not been confirmed%', '10: the trip cannot start before the payment is confirmed');

-- ---------------------------------------------------------------- payment record (service role only)
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.create_provider_job_payment(current_setting('t.job')::uuid, 'testpay', 'ref-1')$$, '42501', null,
                 '11: a customer cannot create the payment record directly');
select throws_ok($$select public.apply_provider_payment('testpay','e0',gen_random_uuid(),'paid',300,'USD','ref-1')$$, '42501', null,
                 '12: a customer cannot apply a provider event');
select tests.as_service();
select set_config('t.pay', (public.create_provider_job_payment(current_setting('t.job')::uuid, 'testpay', 'ref-1')).id::text, true);
select is((public.create_provider_job_payment(current_setting('t.job')::uuid, 'testpay', 'ref-1')).id::text, current_setting('t.pay'),
          '13: asking again returns the same open payment (never a second charge)');
select is((select amount from public.payments where id = current_setting('t.pay')::uuid), 300::numeric, '14: payment amount = agreed fare');

-- ---------------------------------------------------------------- event verification
select is(public.apply_provider_payment('testpay','e1',current_setting('t.pay')::uuid,'paid',299.99,'USD','ref-1'), 'rejected_amount', '15: wrong amount rejected');
select is(public.apply_provider_payment('testpay','e2',current_setting('t.pay')::uuid,'paid',300,'ZWG','ref-1'), 'rejected_currency', '16: wrong currency rejected');
select is(public.apply_provider_payment('testpay','e3',current_setting('t.pay')::uuid,'paid',300,'USD','ref-X'), 'rejected_reference', '17: wrong reference rejected');
select is(public.apply_provider_payment('otherpay','e4',current_setting('t.pay')::uuid,'paid',300,'USD','ref-1'), 'rejected_unknown_payment', '18: another provider''s event rejected');
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'initiated', '19: rejected events change nothing');
select is(public.apply_provider_payment('testpay','e5',current_setting('t.pay')::uuid,'pending',300,'USD','ref-1'), 'pending_no_change', '20: pending changes nothing');
select is(public.apply_provider_payment('testpay','e6',current_setting('t.pay')::uuid,'SUCCESS',300,'usd','ref-1'), 'applied_paid', '21: verified success applied');
select is(public.apply_provider_payment('testpay','e6',current_setting('t.pay')::uuid,'SUCCESS',300,'usd','ref-1'), 'duplicate', '22: the same event again is a duplicate');
select is(public.apply_provider_payment('testpay','e7',current_setting('t.pay')::uuid,'paid',300,'USD','ref-1'), 'already_paid', '23: a second success does nothing');
select is(public.apply_provider_payment('testpay','e8',current_setting('t.pay')::uuid,'failed',300,'USD','ref-1'), 'regression_flagged', '24: a late failure never downgrades a confirmed payment');
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'paid', '25: payment stays paid');
select tests.as_owner();   -- the ledger and event tables are read as the owner (service_role has no SELECT there)
select is((select count(*)::int from public.platform_ledger where payment_id = current_setting('t.pay')::uuid and kind = 'provider_payment_received'), 2,
          '26: the receipt is posted to the ledger once (one balanced pair)');
select is((select count(*)::int from public.provider_payment_events where payment_id = current_setting('t.pay')::uuid), 7, '27: every distinct event recorded once');

-- ---------------------------------------------------------------- delivery and settlement
select tests.as_owner();
select lives_ok($$update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid$$, '28: the trip can start once paid');
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.job')::uuid)) ->> 'ok', 'true', '29: the customer confirms delivery');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.job')::uuid), 'completed', '30: job completed');
select is((select commission from public.jobs where id = current_setting('t.job')::uuid), 21.00::numeric, '31: commission = 7% of the $300 transport fare');
select is((select amount from public.driver_payables where job_id = current_setting('t.job')::uuid), 279.00::numeric, '32: driver is owed $279');
select is((select commission from public.driver_payables where job_id = current_setting('t.job')::uuid), 21.00::numeric, '33: payable records the same commission');
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric, '34: commission-credit wallet untouched');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.job')::uuid), 0, '35: no wallet transaction for the job (no double commission)');
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'released', '36: payment released to settlement');
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.job')::uuid)) ->> 'already', 'true', '37: confirming again settles nothing');
select tests.as_owner();
select is((select count(*)::int from public.driver_payables where job_id = current_setting('t.job')::uuid), 1, '38: exactly one payable');

-- ---------------------------------------------------------------- who can read earnings
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.driver_payables), 1, '39: the driver reads their own payable');
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.driver_payables), 0, '40: another driver reads nothing');
select throws_ok($$update public.driver_payables set amount = 1$$, '42501', null, '41: clients cannot write payables');

-- ---------------------------------------------------------------- payouts: off, then never retried blindly
select set_config('t.payable', (select id::text from public.driver_payables where job_id = current_setting('t.job')::uuid), true);
select tests.as_service();
select throws_like($$select public.payout_prepare(current_setting('t.payable')::uuid, 'testpay', '+263***123')$$, '%switched off%', '42: payouts refused while off');
select tests.as_owner();
update public.system_settings set value = 'true'::jsonb where key = 'payouts_enabled';
select tests.as_service();
select set_config('t.po', (public.payout_prepare(current_setting('t.payable')::uuid, 'testpay', '+263***123')).id::text, true);
select is((public.payout_prepare(current_setting('t.payable')::uuid, 'testpay', '+263***123')).id::text, current_setting('t.po'), '43: one payout record per payable');
select public.payout_record_sent(current_setting('t.po')::uuid, 'po-ref-1');
select public.payout_record_result(current_setting('t.po')::uuid, 'unknown', null, 'timeout');
select throws_like($$select public.payout_retry(current_setting('t.po')::uuid)$$, '%Only a failed payout%', '44: an unknown payout cannot be retried');
select public.payout_record_result(current_setting('t.po')::uuid, 'failed', null, 'wallet closed');
select is((select status from public.driver_payables where id = current_setting('t.payable')::uuid), 'payable', '45: a failed payout returns the earnings to payable');
select is((public.payout_retry(current_setting('t.po')::uuid)).attempts, 2, '46: a confirmed failure may be retried with a new attempt number');
select public.payout_record_result(current_setting('t.po')::uuid, 'paid', null, null);
select is((select status from public.driver_payables where id = current_setting('t.payable')::uuid), 'paid_out', '47: confirmed payout marks the earnings paid out');
select is((public.payout_record_result(current_setting('t.po')::uuid, 'paid', null, null)).status, 'paid', '48: a repeated paid result changes nothing');

-- ---------------------------------------------------------------- cancellation after payment -> refund owed
select tests.as_owner();
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct')::text, true);
update public.jobs set payment_method = 'provider', pricing_basis = 'transport_only' where id = current_setting('t.job2')::uuid;
select set_config('t.bid2', tests.create_bid(current_setting('t.job2')::uuid, current_setting('t.drv')::uuid, 200)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid2')::uuid);
select tests.as_service();
select set_config('t.pay2', (public.create_provider_job_payment(current_setting('t.job2')::uuid, 'testpay', 'ref-2')).id::text, true);
select public.apply_provider_payment('testpay','e20',current_setting('t.pay2')::uuid,'paid',200,'USD','ref-2');
select tests.as_owner();
update public.jobs set status = 'cancelled', cancelled_at = now() where id = current_setting('t.job2')::uuid;
select is((select status from public.payments where id = current_setting('t.pay2')::uuid), 'refund_due', '49: cancelling a paid job records a refund owed');
select tests.login_as_mfa(current_setting('t.sa')::uuid);
select is((public.admin_mark_provider_refunded(current_setting('t.pay2')::uuid, 'rf-123', 'Customer cancelled before loading')).status, 'refunded',
          '50: a super admin records the provider refund');

-- ---------------------------------------------------------------- reconciliation for the new money
select tests.as_owner();
select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'driver_payable_matches_payables', 'job_funds_match_paid_job_payments',
                                 'provider_refunds_match_payments', 'provider_jobs_never_use_commission_credit',
                                 'provider_jobs_settled_once', 'payouts_match_payables') and not ok), 0,
          '51: all provider-flow reconciliation checks pass');

-- ---------------------------------------------------------------- direct-pay jobs unchanged
select set_config('t.job3', tests.create_job(current_setting('t.cust')::uuid, 300, 'direct')::text, true);
select set_config('t.bid3', tests.create_bid(current_setting('t.job3')::uuid, current_setting('t.drv2')::uuid, 300)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid3')::uuid);
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job3')::uuid), 21.00::numeric,
          '52: a direct-pay job still reserves 7% from commission credit at acceptance');

select * from finish();
rollback;
