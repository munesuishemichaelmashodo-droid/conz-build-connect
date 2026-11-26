-- 0179/0180 edge cases for direct-payment stages: who may write, on which jobs, and what an agreement change after a
-- recorded payment does. Complements 1130 (plans, write-once, privacy, commission untouched).
begin;
select plan(16);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('pe_customer')::text, true);
select set_config('t.adm',   tests.create_user('pe_admin', array['admin'])::text, true);
select set_config('t.drv1',  tests.create_driver('pe_driver1', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('pe_driver2', 100)::text, true);
select set_config('t.drv3',  tests.create_driver('pe_driver3', 100)::text, true);

create function pg_temp.direct_job(_price numeric, _drv uuid) returns uuid language plpgsql as $f$
declare _job uuid; _bid uuid;
begin
  perform tests.as_owner();
  _job := tests.create_job(current_setting('t.cust')::uuid, _price, 'direct');
  _bid := tests.create_bid(_job, _drv, _price);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_bid);
  perform tests.as_owner();
  return _job;
end $f$;

-- ======================================================================== A. jobs that cannot take payment records
select tests.as_owner();
select set_config('t.open', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.customer_claim_stage_payment(%L, 'full', 'cash', 200)$$, current_setting('t.open')),
                   '%active or completed job%', '1: no payment can be recorded on a job with no driver');

select set_config('t.cxl', pg_temp.direct_job(300, current_setting('t.drv1')::uuid)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.cancel_job(%L, 'plans changed')$$, current_setting('t.cxl')), '2: the customer cancels');
select throws_like(format($$select public.customer_claim_stage_payment(%L, 'full', 'cash', 300)$$, current_setting('t.cxl')),
                   '%active or completed job%', '3: no payment can be recorded after cancellation');
select tests.login_as(current_setting('t.drv1')::uuid);
select throws_like(format($$select public.driver_confirm_stage_payment(%L, 'full', 'cash', 300)$$, current_setting('t.cxl')),
                   '%active or completed job%', '4: nor can the driver confirm one');

-- ======================================================================== B. callers who are not the two parties
select set_config('t.job', pg_temp.direct_job(400, current_setting('t.drv2')::uuid)::text, true);
select tests.as_anon();
select throws_ok(format($$select public.customer_claim_stage_payment(%L, 'full', 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '5: signed-out callers cannot record a payment');
select throws_ok(format($$select * from public.job_payment_plan(%L)$$, current_setting('t.job')),
                 '42501', null, '6: nor read the payment plan');
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$select public.customer_claim_stage_payment(%L, 'full', 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '7: an admin cannot record a payment on someone else''s behalf');
select throws_ok(format($$select public.driver_confirm_stage_payment(%L, 'full', 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '8: nor confirm one');
select tests.login_as(current_setting('t.drv3')::uuid);
select throws_ok(format($$select public.driver_confirm_stage_payment(%L, 'full', 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '9: a driver who was not chosen cannot confirm a payment');

-- ======================================================================== C. agreement changed after a deposit was recorded
-- driver asks for a $100 deposit to 0771234567; customer accepts, then records paying it
select tests.login_as(current_setting('t.drv2')::uuid);
select set_config('t.a1', (public.propose_job_agreement_terms(current_setting('t.job')::uuid, 'ecocash', 'on_delivery', 100, 'before_pickup',
        'Quarry wants payment first', 'T Driver', '0771234567', 'EcoCash, reference = job number'))::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_job_agreement((select id from public.job_agreements where job_id = current_setting('t.job')::uuid and status = 'proposed'));
select lives_ok(format($$select public.customer_claim_stage_payment(%L, 'deposit', 'ecocash', 100, 'MP1234')$$, current_setting('t.job')),
                '10: customer records the deposit');

-- the driver now proposes new payment details
select tests.login_as(current_setting('t.drv2')::uuid);
select public.propose_job_agreement_terms(current_setting('t.job')::uuid, 'ecocash', 'on_delivery', 100, 'before_pickup',
        'Quarry wants payment first', 'Other Person', '0719999999', 'Pay my cousin instead');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select recipient_account from public.job_payment_plan(current_setting('t.job')::uuid) where stage = 'balance'), '0771234567',
          '11: until the customer accepts, the plan keeps the accepted payment details');

select public.accept_job_agreement((select id from public.job_agreements where job_id = current_setting('t.job')::uuid and status = 'proposed'));
select is((select recipient_account from public.direct_payment_stages where job_id = current_setting('t.job')::uuid and stage = 'deposit'),
          '0771234567', '12: the recorded deposit keeps the details it was paid to');
select is((select recipient_account from public.job_payment_plan(current_setting('t.job')::uuid) where stage = 'balance'), '0719999999',
          '13: the balance follows the newly accepted details');

-- repeated requests
select is((public.customer_claim_stage_payment(current_setting('t.job')::uuid, 'deposit', 'ecocash', 100, 'MP1234')).customer_reference, 'MP1234',
          '14: repeating the same statement is harmless');
select is((select count(*)::int from public.direct_payment_stage_events where job_id = current_setting('t.job')::uuid and action = 'customer_claimed'), 1,
          '15: and is recorded once');
select is((select count(*)::int from public.direct_payment_stages where job_id = current_setting('t.job')::uuid and stage = 'deposit'), 1,
          '16: one deposit record per job');

select * from finish();
rollback;
