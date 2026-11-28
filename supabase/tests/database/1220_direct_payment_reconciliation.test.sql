-- 0188: direct-payment reconciliation. Deposits, partial payments, wrong and reused references, duplicate statements,
-- proof that never upgrades a status, screenshots never accepted as independent proof, disputes, reversals, reviews,
-- privacy, and no effect at all on wallets or commission.
begin;
select plan(40);
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select tests.as_owner();
select set_config('t.cust',  tests.create_user('rc_customer')::text, true);
select set_config('t.cust2', tests.create_user('rc_other_customer')::text, true);
select set_config('t.adm',   tests.create_user('rc_admin', array['admin'])::text, true);
select set_config('t.drv1',  tests.create_driver('rc_driver1', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('rc_driver2', 100)::text, true);

create function pg_temp.direct_job(_cust uuid, _price numeric, _drv uuid) returns uuid language plpgsql as $f$
declare _job uuid; _bid uuid;
begin
  perform tests.as_owner();
  _job := tests.create_job(_cust, _price, 'direct');
  _bid := tests.create_bid(_job, _drv, _price);
  perform tests.login_as(_cust);
  perform public.accept_bid(_bid);
  perform tests.as_owner();
  return _job;
end $f$;
create function pg_temp.agree(_job uuid, _cust uuid, _drv uuid, _dep numeric) returns uuid language plpgsql as $f$
declare _a public.job_agreements;
begin
  perform tests.login_as(_drv);
  _a := public.propose_job_agreement_terms(_job, 'ecocash', 'on_delivery', _dep, case when _dep > 0 then 'before_pickup' end,
                                           case when _dep > 0 then 'Quarry needs payment upfront' end, 'T Driver', '0771234567');
  perform tests.login_as(_cust);
  perform public.accept_job_agreement(_a.id);
  perform tests.as_owner();
  return _a.id;
end $f$;
create function pg_temp.state(_job uuid, _stage text) returns text language sql as $f$
  select x->>'state' from jsonb_array_elements((public.job_payment_reconciliation(_job))->'stages') x where x->>'stage' = _stage $f$;
create function pg_temp.money() returns text language sql as $f$
  select coalesce((select string_agg(user_id::text || ':' || balance::text || ':' || coalesce(held, 0)::text, ',' order by user_id) from public.wallets), '')
    || '|' || (select count(*) from public.wallet_transactions)::text
    || '|' || (select string_agg(coalesce(held_commission::text, 'n') || ':' || coalesce(final_price::text, 'n'), ',' order by id) from public.jobs) $f$;

select set_config('t.job',  pg_temp.direct_job(current_setting('t.cust')::uuid, 200, current_setting('t.drv1')::uuid)::text, true);
select pg_temp.agree(current_setting('t.job')::uuid, current_setting('t.cust')::uuid, current_setting('t.drv1')::uuid, 50);
select set_config('t.job2', pg_temp.direct_job(current_setting('t.cust2')::uuid, 300, current_setting('t.drv2')::uuid)::text, true);
select set_config('t.money', pg_temp.money(), true);
select set_config('t.events', (select count(*) from public.direct_payment_stage_events)::text, true);

-- ============================================================ A. deposit, statements, statuses
select tests.login_as(current_setting('t.cust')::uuid);
select is(pg_temp.state(current_setting('t.job')::uuid, 'deposit'), 'not_reported', '1: nothing reported yet');
select public.customer_claim_stage_payment(current_setting('t.job')::uuid, 'deposit', 'ecocash', 50, 'EC-123 456');
select is(pg_temp.state(current_setting('t.job')::uuid, 'deposit'), 'payment_reported', '2: the customer''s "I paid" is only a reported payment');
select tests.login_as(current_setting('t.drv1')::uuid);
select public.driver_confirm_stage_payment(current_setting('t.job')::uuid, 'deposit', 'ecocash', 50, 'ec123456');
select is(pg_temp.state(current_setting('t.job')::uuid, 'deposit'), 'receipt_claimed', '3: the driver''s "I received" is a claimed receipt');
select tests.login_as(current_setting('t.cust')::uuid);
select public.customer_acknowledge_stage_payment(current_setting('t.job')::uuid, 'deposit');
select is(pg_temp.state(current_setting('t.job')::uuid, 'deposit'), 'both_confirmed', '4: both agree, still not checked by Con Z');
select ok((public.job_payment_reconciliation(current_setting('t.job')::uuid))->>'basis' like '%does not collect, hold or guarantee%A screenshot alone never confirms a payment.',
          '5: the record says Con Z does not hold the fare and a screenshot never confirms a payment');
select is(((public.job_payment_reconciliation(current_setting('t.job')::uuid))->'totals'->>'outstanding')::numeric, 150.00,
          '6: with the $50 deposit received, $150 of the $200 fare is outstanding');

-- ============================================================ B. partial payment, wrong and reused references
select public.customer_claim_stage_payment(current_setting('t.job')::uuid, 'balance', 'ecocash', 100, 'EC999');
select ok((select x->'flags' ? 'customer_amount_differs' from jsonb_array_elements((public.job_payment_reconciliation(current_setting('t.job')::uuid))->'stages') x
            where x->>'stage' = 'balance'), '7: a partial balance ($100 of $150) is flagged');
select is(((public.job_payment_reconciliation(current_setting('t.job')::uuid))->'totals'->>'outstanding')::numeric, 150.00,
          '8: a customer''s report alone does not reduce what is outstanding');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select public.customer_claim_stage_payment(%L, 'full', 'ecocash', 300, 'ec 123-456')$$, current_setting('t.job2')),
                 '23505', null, '9: a reference already used for another payment is refused (spacing and case ignored)');
select tests.login_as(current_setting('t.drv1')::uuid);
select throws_ok(format($$select public.driver_confirm_stage_payment(%L, 'balance', 'ecocash', 100, 'EC123456')$$, current_setting('t.job')),
                 '23505', null, '10: the driver cannot reuse the deposit''s reference for the balance');
select lives_ok(format($$select public.driver_confirm_stage_payment(%L, 'balance', 'ecocash', 100, 'EC999X')$$, current_setting('t.job')),
                '11: the driver records what arrived under a different reference');
select ok((select x->'flags' ? 'references_differ' and x->'flags' ? 'driver_amount_differs'
             from jsonb_array_elements((public.job_payment_reconciliation(current_setting('t.job')::uuid))->'stages') x where x->>'stage' = 'balance'),
          '12: the mismatched reference and the short amount are both flagged');

-- ============================================================ C. duplicates and direct changes
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.customer_claim_stage_payment(%L, 'deposit', 'ecocash', 50, 'EC-123 456')$$, current_setting('t.job')),
                '13: repeating the same statement is harmless');
select tests.as_owner();
select is((select count(*)::int from public.direct_payment_stage_events where job_id = current_setting('t.job')::uuid and action = 'customer_claimed' and stage = 'deposit'), 1,
          '14: and records it once');
select tests.login_as(current_setting('t.drv1')::uuid);
select throws_like(format($$select public.driver_confirm_stage_payment(%L, 'deposit', 'ecocash', 80)$$, current_setting('t.job')),
                   '%already confirmed%', '15: a second, different confirmation is refused');
select throws_ok(format($$update public.direct_payment_stages set driver_amount = 150 where job_id = %L$$, current_setting('t.job')),
                 '42501', null, '16: a party cannot change a payment record directly');
select tests.as_owner();
select throws_like(format($$update public.direct_payment_stages set customer_amount = 150 where job_id = %L and stage = 'balance'$$, current_setting('t.job')),
                   '%cannot be changed%', '17: the guard refuses a privileged SQL change to a recorded statement');

-- ============================================================ D. proof
insert into storage.objects (bucket_id, name) values
  ('chat-media', current_setting('t.job') || '/' || current_setting('t.cust') || '/pay-1.png'),
  ('chat-media', current_setting('t.job') || '/' || current_setting('t.drv1') || '/statement.pdf');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.attach_stage_payment_evidence(%L, 'balance', 'screenshot', %L, 'EcoCash message')$$,
                       current_setting('t.job'), current_setting('t.job') || '/' || current_setting('t.cust') || '/pay-1.png'),
                '18: the customer attaches a screenshot');
select is(pg_temp.state(current_setting('t.job')::uuid, 'balance'), 'receipt_claimed', '19: proof never upgrades a status');
select ok((select (x->>'screenshot_only')::boolean and (x->>'evidence_submitted')::boolean
             from jsonb_array_elements((public.job_payment_reconciliation(current_setting('t.job')::uuid))->'stages') x where x->>'stage' = 'balance'),
          '20: it is shown as evidence submitted, screenshot only');
select throws_ok(format($$select public.attach_stage_payment_evidence(%L, 'balance', 'screenshot', %L)$$,
                        current_setting('t.job'), current_setting('t.job') || '/' || current_setting('t.drv1') || '/statement.pdf'),
                 '42501', null, '21: nobody can attach another person''s file');
select throws_like(format($$select public.attach_stage_payment_evidence(%L, 'balance', 'screenshot', %L)$$,
                          current_setting('t.job'), current_setting('t.job') || '/' || current_setting('t.cust') || '/missing.png'),
                   '%not uploaded%', '22: nor a file that was never uploaded');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select public.attach_stage_payment_evidence(%L, 'balance', 'screenshot', %L)$$,
                        current_setting('t.job'), current_setting('t.job') || '/' || current_setting('t.cust2') || '/x.png'),
                 '42501', null, '23: another customer cannot attach to this job');

-- ============================================================ E. independent checks
select tests.login_as(current_setting('t.adm')::uuid);
select set_config('t.bal', (select id::text from public.direct_payment_stages where job_id = current_setting('t.job')::uuid and stage = 'balance'), true);
select throws_like(format($$select public.admin_review_stage_payment(%L, 'independently_verified', 'screenshot', 'Customer sent a screenshot')$$, current_setting('t.bal')),
                   '%screenshot alone is not proof%', '24: a screenshot is never accepted as independent proof');
select throws_like(format($$select public.admin_review_stage_payment(%L, 'independently_verified', 'bank_statement', 'Checked the bank statement')$$, current_setting('t.bal')),
                   '%No bank statement is attached%', '25: a bank statement check needs the statement attached');
select throws_like(format($$select public.admin_review_stage_payment(%L, 'independently_verified', 'provider_lookup', 'ok')$$, current_setting('t.bal')),
                   '%reason%', '26: a check needs a reason');
select lives_ok(format($$select public.admin_review_stage_payment(%L, 'independently_verified', 'provider_lookup', 'EcoCash lookup shows $100 received')$$, current_setting('t.bal')),
                '27: an admin records an independent provider check');
select is(pg_temp.state(current_setting('t.job')::uuid, 'balance'), 'independently_confirmed', '28: only now is it independently confirmed');
select ok(exists (select 1 from public.admin_audit_log where action = 'direct_payment_independently_verified'), '29: and it is in the audit log');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.admin_review_stage_payment(%L, 'independently_verified', 'provider_lookup', 'I say it is fine')$$, current_setting('t.bal')),
                 '42501', null, '30: a customer cannot record an independent check');

-- ============================================================ F. disputes and reversals
select lives_ok(format($$select public.flag_stage_payment(%L, 'balance', 'disputed', 'I paid $150, not $100')$$, current_setting('t.job')),
                '31: the customer disputes the balance');
select is(pg_temp.state(current_setting('t.job')::uuid, 'balance'), 'disputed', '32: a dispute outranks the earlier check');
select throws_like(format($$select public.flag_stage_payment(%L, 'balance', 'disputed', 'Again, it was $150')$$, current_setting('t.job')),
                   '%already marked disputed%', '33: the same dispute cannot be filed twice');
select tests.login_as(current_setting('t.adm')::uuid);
select lives_ok(format($$select public.admin_review_stage_payment(%L, 'review_closed', null, 'Provider record shows $100; customer informed')$$, current_setting('t.bal')),
                '34: an admin closes the review with a reason');
select tests.login_as(current_setting('t.drv1')::uuid);
select lives_ok(format($$select public.flag_stage_payment(%L, 'deposit', 'reversal_reported', 'EcoCash reversed the $50 deposit')$$, current_setting('t.job')),
                '35: the driver reports the deposit was reversed');
select ok(pg_temp.state(current_setting('t.job')::uuid, 'deposit') = 'reversal_reported'
          and ((public.job_payment_reconciliation(current_setting('t.job')::uuid))->'totals'->>'received_by_driver')::numeric = 100.00,
          '36: a reversed payment no longer counts as received');
select tests.as_owner();
select throws_like($$delete from public.direct_payment_stage_reviews$$, '%append-only%', '37: reviews cannot be deleted');

-- ============================================================ G. privacy and money
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select public.job_payment_reconciliation(%L)$$, current_setting('t.job')), '42501', null,
                 '38: another customer cannot see this job''s payments');
select is((select count(*)::int from public.direct_payment_evidence) + (select count(*)::int from public.direct_payment_stage_reviews)
          + (select count(*)::int from public.direct_payment_stages where job_id = current_setting('t.job')::uuid), 0,
          '39: nor read its proof, reviews or payment rows');
select tests.as_owner();
select is(pg_temp.money(), current_setting('t.money'), '40: no wallet, wallet entry, held commission or price changed');

select * from finish();
rollback;
