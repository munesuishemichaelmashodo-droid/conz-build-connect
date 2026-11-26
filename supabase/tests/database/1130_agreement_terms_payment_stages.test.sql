-- 0179: payment terms in the agreement (driver sets deposit and where to pay; customer can't change them), and
-- direct payments recorded per stage: no deposit, deposit + balance, full advance, payment after delivery; each
-- statement write-once, private to the two parties and admins, mismatches flagged, commission untouched.
begin;
select plan(34);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('ps_customer')::text, true);
select set_config('t.cust2', tests.create_user('ps_other_customer')::text, true);
select set_config('t.adm',   tests.create_user('ps_admin', array['admin'])::text, true);
select set_config('t.drv1',  tests.create_driver('ps_driver1', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('ps_driver2', 100)::text, true);
select set_config('t.drv3',  tests.create_driver('ps_driver3', 100)::text, true);
select set_config('t.drv4',  tests.create_driver('ps_driver4', 100)::text, true);

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
-- driver proposes, customer accepts
create function pg_temp.agree(_job uuid, _drv uuid, _method text, _timing text, _dep numeric, _due text) returns uuid language plpgsql as $f$
declare _a public.job_agreements;
begin
  perform tests.login_as(_drv);
  _a := public.propose_job_agreement_terms(_job, _method, _timing, _dep, _due, case when _dep > 0 then 'Quarry needs payment upfront' end,
                                           'T Driver', '0771234567', 'Send to my EcoCash, reference = job number', 'Deposit refunded if I cancel');
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_job_agreement(_a.id);
  perform tests.as_owner();
  return _a.id;
end $f$;

-- ======================================================================== A. deposit + balance ($400, $100 deposit)
select set_config('t.jobA', pg_temp.direct_job(400, current_setting('t.drv1')::uuid)::text, true);
select set_config('t.heldA', (select held_commission from public.jobs where id = current_setting('t.jobA')::uuid)::text, true);

-- terms: who may set what
select tests.login_as(current_setting('t.drv1')::uuid);
select throws_like(format($$select public.propose_job_agreement_terms(%L, 'ecocash', 'on_delivery', 100, null)$$, current_setting('t.jobA')),
                   '%deposit is due%', '1: a deposit needs a due stage');
select throws_like(format($$select public.propose_job_agreement_terms(%L, 'ecocash', 'on_delivery', 500, 'before_pickup')$$, current_setting('t.jobA')),
                   '%more than the fare%', '2: a deposit above the price is refused');
select throws_like(format($$select public.propose_job_agreement_terms(%L, 'bitcoin', 'on_delivery', 0, null)$$, current_setting('t.jobA')),
                   '%payment method%', '3: unknown method refused');
select set_config('t.agrA', (public.propose_job_agreement_terms(current_setting('t.jobA')::uuid, 'onemoney', 'on_delivery', 100, 'before_pickup',
        'Quarry wants cash first', 'T Driver', '0771234567', 'OneMoney to this number', 'Deposit back if I do not arrive'))::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.propose_job_agreement_terms(%L, 'onemoney', 'on_delivery', 0, null)$$, current_setting('t.jobA')),
                   '%Only the driver can propose or change a deposit%', '4: the customer cannot remove the deposit');
select is((public.propose_job_agreement_terms(current_setting('t.jobA')::uuid, 'onemoney', 'on_delivery', 100, null, null,
           'Someone Else', '0700000000', 'pay my friend')).recipient_account, '0771234567',
          '5: a customer counter-proposal keeps the driver''s payment details (cannot redirect the money)');
select tests.login_as(current_setting('t.drv1')::uuid);
select lives_ok(format($$select public.accept_job_agreement((select id from public.job_agreements where job_id = %L and status = 'proposed'))$$,
                current_setting('t.jobA')), '6: the driver accepts the customer''s version');

-- privacy of payment details
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.job_agreements where job_id = current_setting('t.jobA')::uuid), 0,
          '7: another driver cannot read this job''s payment details');
select throws_ok(format($$select * from public.job_payment_plan(%L)$$, current_setting('t.jobA')), '42501', null,
                 '8: nor its payment plan');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select * from public.job_payment_plan(%L)$$, current_setting('t.jobA')), '42501', null,
                 '9: nor can another customer');

-- the plan
select tests.login_as(current_setting('t.cust')::uuid);
select results_eq(format($$select stage, expected_amount, due from public.job_payment_plan(%L) order by stage desc$$, current_setting('t.jobA')),
                  $$values ('deposit'::text, 100.00::numeric, 'before_pickup'::text), ('balance'::text, 300.00::numeric, 'on_delivery'::text)$$,
                  '10: deposit $100 before pickup, balance $300 on delivery');

-- stage statements
select tests.login_as(current_setting('t.drv1')::uuid);
select throws_ok(format($$select public.customer_claim_stage_payment(%L, 'deposit', 'onemoney', 100)$$, current_setting('t.jobA')),
                 '42501', null, '11: the driver cannot claim the customer paid');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.driver_confirm_stage_payment(%L, 'deposit', 'onemoney', 100)$$, current_setting('t.jobA')),
                 '42501', null, '12: the customer cannot confirm the driver received it');
select throws_like(format($$select public.customer_claim_stage_payment(%L, 'full', 'onemoney', 400)$$, current_setting('t.jobA')),
                   '%no full payment%', '13: a stage that is not in the agreement is refused');
select is((public.customer_claim_stage_payment(current_setting('t.jobA')::uuid, 'deposit', 'onemoney', 100, 'OM-1')).customer_amount, 100.00::numeric,
          '14: customer says they paid the deposit');
select is((public.customer_claim_stage_payment(current_setting('t.jobA')::uuid, 'deposit', 'onemoney', 100, 'OM-1')).customer_reference, 'OM-1',
          '15: the same claim again changes nothing');
select throws_like(format($$select public.customer_claim_stage_payment(%L, 'deposit', 'cash', 90)$$, current_setting('t.jobA')),
                   '%already recorded%', '16: a different second claim is refused');
select tests.login_as(current_setting('t.drv1')::uuid);
select lives_ok(format($$select public.driver_confirm_stage_payment(%L, 'deposit', 'onemoney', 100, 'OM-1')$$, current_setting('t.jobA')),
                '17: driver confirms the deposit');
select throws_like(format($$select public.driver_confirm_stage_payment(%L, 'deposit', 'onemoney', 50)$$, current_setting('t.jobA')),
                   '%already confirmed%', '18: the driver cannot confirm twice with another amount');
select lives_ok(format($$select public.driver_confirm_stage_payment(%L, 'balance', 'cash', 250)$$, current_setting('t.jobA')),
                '19: driver confirms a balance of $250 (less than agreed)');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.customer_acknowledge_stage_payment(%L, 'deposit')$$, current_setting('t.jobA')),
                '20: customer agrees with the deposit confirmation');
select tests.as_owner();
select is((select customer_amount from public.direct_payment_stages where job_id = current_setting('t.jobA')::uuid and stage = 'deposit'), 100.00::numeric,
          '21: recording the balance did not touch the deposit record');
select is((select count(*)::int from public.direct_payment_stages where job_id = current_setting('t.jobA')::uuid), 2,
          '22: deposit and balance are separate records');
select is((select array_agg(action order by id)::text from public.direct_payment_stage_events where job_id = current_setting('t.jobA')::uuid),
          '{customer_claimed,driver_confirmed,driver_confirmed,customer_acknowledged}',
          '23: every statement is in the append-only history');
select ok((select count(*) from public.notifications where type = 'payment_anomaly' and job_id = current_setting('t.jobA')::uuid) >= 1,
          '24: the short balance alerts admins');
select is((select held_commission from public.jobs where id = current_setting('t.jobA')::uuid)::text, current_setting('t.heldA'),
          '25: commission is unchanged by any payment record');
select throws_ok(format($$update public.direct_payment_stages set driver_amount = 300 where job_id = %L and stage = 'balance'$$, current_setting('t.jobA')),
                 '42501', null, '26: a recorded statement cannot be edited, even by the owner role');
select throws_ok($$delete from public.direct_payment_stage_events$$, '42501', null, '27: history cannot be deleted');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$insert into public.direct_payment_stages (job_id, stage, expected_amount) values (%L, 'full', 1)$$, current_setting('t.jobA')),
                 '42501', null, '28: nobody writes the table directly');
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.direct_payment_stages), 0, '29: another driver reads no payment records');
select tests.login_as(current_setting('t.adm')::uuid);
select is((select count(*)::int from public.direct_payment_stages where job_id = current_setting('t.jobA')::uuid), 2, '30: admins read them');

-- ======================================================================== B. no deposit, payment after delivery
select set_config('t.jobB', pg_temp.direct_job(300, current_setting('t.drv2')::uuid)::text, true);
select pg_temp.agree(current_setting('t.jobB')::uuid, current_setting('t.drv2')::uuid, 'cash', 'on_delivery', 0, null);
select tests.login_as(current_setting('t.cust')::uuid);
select results_eq(format($$select stage, expected_amount, due from public.job_payment_plan(%L)$$, current_setting('t.jobB')),
                  $$values ('full'::text, 300.00::numeric, 'on_delivery'::text)$$, '31: no deposit = one full payment on delivery');

-- ======================================================================== C. full advance
select set_config('t.jobC', pg_temp.direct_job(250, current_setting('t.drv3')::uuid)::text, true);
select pg_temp.agree(current_setting('t.jobC')::uuid, current_setting('t.drv3')::uuid, 'ecocash', 'before_pickup', 250, 'on_agreement');
select tests.login_as(current_setting('t.cust')::uuid);
select results_eq(format($$select stage, expected_amount, due from public.job_payment_plan(%L)$$, current_setting('t.jobC')),
                  $$values ('full'::text, 250.00::numeric, 'on_agreement'::text)$$, '32: full advance = one full payment due on agreement');

-- ======================================================================== D. no agreement yet
select set_config('t.jobD', pg_temp.direct_job(180, current_setting('t.drv4')::uuid)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select results_eq(format($$select stage, expected_amount from public.job_payment_plan(%L)$$, current_setting('t.jobD')),
                  $$values ('full'::text, 180.00::numeric)$$, '33: without an agreement, one full payment of the agreed price');
select lives_ok(format($$select public.customer_claim_stage_payment(%L, 'full', 'cash', 180)$$, current_setting('t.jobD')),
                '34: and it can be recorded');

select * from finish();
rollback;
