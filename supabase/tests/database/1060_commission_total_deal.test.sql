-- Commission rule (owner, 24/11/2026): ConZ earns 7% of the TOTAL agreed deal charge, materials and transport together.
-- Example from the owner: materials $300 + transport $100 = $400 deal -> $28 commission.
-- Same basis for driver-paid (commission credit) and provider-paid (taken from the collected payment) jobs; never both.
-- Covers: combined deal, transport-only deal, a deal priced for materials and delivery as one sum, a changed offer,
-- cancellation, repeat confirmation, duplicate provider events, refund of the whole deal, reconciliation.
begin;
select plan(22);

select tests.as_owner();
select set_config('t.cust', tests.create_user('cd_customer')::text, true);
-- Driver-paid driver with $100 commission credit (recorded as a top-up so the wallet reconciles).
select set_config('t.drv',  tests.create_driver('cd_driver', 100)::text, true);
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
  values (current_setting('t.drv')::uuid, 'topup', 100, 100, 'commission-rule test opening credit');
-- Provider-paid drivers with no commission credit at all.
select set_config('t.pdrv',  tests.create_driver('cd_pdriver', 0)::text, true);
select set_config('t.pdrv2', tests.create_driver('cd_pdriver2', 0)::text, true);

-- ---------------------------------------------------------------- driver-paid: $300 materials + $100 transport = $400
select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 400, 'direct')::text, true);
select is((select pricing_basis from public.jobs where id = current_setting('t.j1')::uuid), 'legacy_material_plus_transport',
          '1: a materials-and-transport deal (the default basis)');
select set_config('t.b1', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b1')::uuid);
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.j1')::uuid), 28.00::numeric,
          '2: 7% of the $400 total deal ($28) is reserved, not 7% of the $100 transport part');
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.j1')::uuid)) ->> 'ok', 'true', '3: delivery confirmed');
select is((tests.complete(current_setting('t.j1')::uuid)) ->> 'already', 'true', '4: confirming again charges nothing');
select tests.as_owner();
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 72.00::numeric, '5: $28 charged once ($100 - $28)');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.j1')::uuid and type = 'commission'), 1,
          '6: one commission line');

-- ---------------------------------------------------------------- driver-paid: the offer changes before acceptance
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 400, 'direct')::text, true);
select set_config('t.b2', tests.create_bid(current_setting('t.j2')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.drv')::uuid);
update public.bids set price = 450 where id = current_setting('t.b2')::uuid;   -- the app's re-offer
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b2')::uuid);
select tests.as_owner();
select is((select final_price from public.jobs where id = current_setting('t.j2')::uuid), 450::numeric, '7: the agreed total is the changed offer');
select is((select held_commission from public.jobs where id = current_setting('t.j2')::uuid), 31.50::numeric, '8: 7% of the changed total is reserved');
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j2')::uuid, 'Plans changed');
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric, '9: cancelling releases the whole reserve');
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 72.00::numeric, '10: no commission on a cancelled deal');

-- ---------------------------------------------------------------- driver-paid: a transport-only deal
select set_config('t.j3', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
update public.jobs set pricing_basis = 'transport_only' where id = current_setting('t.j3')::uuid;
select set_config('t.b3', tests.create_bid(current_setting('t.j3')::uuid, current_setting('t.drv')::uuid, 100)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b3')::uuid);
select tests.complete(current_setting('t.j3')::uuid);
select tests.as_owner();
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 65.00::numeric,
          '11: a $100 transport-only deal costs $7 (the deal is the transport)');
select ok(tests.ledger_matches(current_setting('t.drv')::uuid), '12: the commission-credit wallet equals its transactions');

-- ---------------------------------------------------------------- provider-paid: the same $400 deal
update public.system_settings set value = '"testpay"'::jsonb where key = 'payment_provider';
select set_config('t.j4', tests.create_job(current_setting('t.cust')::uuid, 400, 'direct')::text, true);
update public.jobs set payment_method = 'provider' where id = current_setting('t.j4')::uuid;
select set_config('t.b4', tests.create_bid(current_setting('t.j4')::uuid, current_setting('t.pdrv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b4')::uuid);
select tests.as_service();
select set_config('t.p4', (public.create_provider_job_payment(current_setting('t.j4')::uuid, 'testpay', 'cd-4')).id::text, true);
select is(public.apply_provider_payment('testpay','cd-e1',current_setting('t.p4')::uuid,'paid',400,'USD','cd-4'), 'applied_paid',
          '13: the customer pays the whole $400 deal');
select is(public.apply_provider_payment('testpay','cd-e1',current_setting('t.p4')::uuid,'paid',400,'USD','cd-4'), 'duplicate',
          '14: a duplicate event changes nothing');
select tests.as_owner();
update public.jobs set status = 'in_progress' where id = current_setting('t.j4')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j4')::uuid);
select tests.as_owner();
select is((select commission from public.driver_payables where job_id = current_setting('t.j4')::uuid), 28.00::numeric,
          '15: provider-paid commission is the same $28 (7% of the total deal)');
select is((select amount from public.driver_payables where job_id = current_setting('t.j4')::uuid), 372.00::numeric, '16: driver is owed $372');
select is((select held_commission from public.jobs where id = current_setting('t.j4')::uuid), 0::numeric,
          '17: nothing reserved from commission credit (no double commission)');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.j4')::uuid), 0,
          '18: no commission-credit line for a provider-paid job');

-- ---------------------------------------------------------------- provider-paid: cancelled after payment -> the whole deal is refunded
select set_config('t.j5', tests.create_job(current_setting('t.cust')::uuid, 400, 'direct')::text, true);
update public.jobs set payment_method = 'provider' where id = current_setting('t.j5')::uuid;
select set_config('t.b5', tests.create_bid(current_setting('t.j5')::uuid, current_setting('t.pdrv2')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b5')::uuid);
select tests.as_service();
select set_config('t.p5', (public.create_provider_job_payment(current_setting('t.j5')::uuid, 'testpay', 'cd-5')).id::text, true);
select public.apply_provider_payment('testpay','cd-e5',current_setting('t.p5')::uuid,'paid',400,'USD','cd-5');
select tests.as_owner();
update public.jobs set status = 'cancelled', cancelled_at = now() where id = current_setting('t.j5')::uuid;
select is((select status from public.payments where id = current_setting('t.p5')::uuid), 'refund_due', '19: cancellation after payment owes a refund');
select is((select amount from public.payments where id = current_setting('t.p5')::uuid), 400::numeric, '20: the refund is the whole deal');
select is((select count(*)::int from public.driver_payables where job_id = current_setting('t.j5')::uuid), 0, '21: no commission and no payable on it');

select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'held_commission_matches_jobs', 'driver_payable_matches_payables',
                                 'job_funds_match_paid_job_payments', 'provider_refunds_match_payments',
                                 'provider_jobs_never_use_commission_credit', 'provider_jobs_settled_once') and not ok), 0,
          '22: ledger, reserve and provider reconciliation checks pass');

select * from finish();
rollback;
