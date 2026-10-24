-- 0109 — an expired offer can never be accepted; valid and repeated acceptance
-- stay exactly-once.
--
-- Written for the pgTAP harness (node scripts/db-test.mjs test). NOT YET RUN: the
-- authoring environment had no Docker daemon and no pgTAP. Run it before relying
-- on it.
--
-- Expiry is simulated by moving bids.expires_at into the past as the table owner
-- (the same way the clock would), never by editing function code. The explicit
-- check in accept_bid (0109) and the 0062 trigger are both exercised: test 4 also
-- passes without 0109 because of the trigger, test 5 proves the function alone by
-- switching the trigger off for one statement.
begin;
select plan(14);
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('exp_cust')::text, true);
select set_config('t.cust2', tests.create_user('exp_cust2')::text, true);
select set_config('t.drv1',  tests.create_driver('exp_d1', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('exp_d2', 100)::text, true);

select set_config('t.job_ok',  tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.job_old', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.job_tr',  tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.job_two', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);

select set_config('t.bid_ok',  tests.create_bid(current_setting('t.job_ok')::uuid,  current_setting('t.drv1')::uuid, 380)::text, true);
select set_config('t.bid_old', tests.create_bid(current_setting('t.job_old')::uuid, current_setting('t.drv1')::uuid, 380)::text, true);
select set_config('t.bid_tr',  tests.create_bid(current_setting('t.job_tr')::uuid,  current_setting('t.drv1')::uuid, 380)::text, true);
select set_config('t.bid_a',   tests.create_bid(current_setting('t.job_two')::uuid, current_setting('t.drv1')::uuid, 380)::text, true);
select set_config('t.bid_b',   tests.create_bid(current_setting('t.job_two')::uuid, current_setting('t.drv2')::uuid, 370)::text, true);

select tests.as_owner();
select cmp_ok((select expires_at from public.bids where id = current_setting('t.bid_ok')::uuid),
  '>', now(), '1: a new offer is stamped with a future expiry by the database');

-- Valid acceptance --------------------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_ok')),
  '2: customer accepts an unexpired offer');

select tests.as_owner();
select is((select status::text || ':' || driver_id::text from public.jobs where id = current_setting('t.job_ok')::uuid),
  'accepted:' || current_setting('t.drv1'), '3: job is assigned to the offering driver, status accepted');

-- Expired offer -----------------------------------------------------------------
update public.bids set expires_at = now() - interval '1 minute'
 where id = current_setting('t.bid_old')::uuid;

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_old')),
  '42501', 'This offer has expired. Ask the driver to send it again.',
  '4: accept_bid refuses an expired offer');

select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.job_old')::uuid), 'open',
  '5a: refusal leaves the job open');
select is((select status::text from public.bids where id = current_setting('t.bid_old')::uuid), 'pending',
  '5b: refusal leaves the bid pending (nothing partially applied)');
select is((select held_commission from public.jobs where id = current_setting('t.job_old')::uuid), null,
  '5c: no commission was reserved for the refused acceptance');

-- Function-only proof: trigger off for this statement, expired offer still refused.
alter table public.bids disable trigger trg_bids_offer_expiry;
update public.bids set expires_at = now() - interval '1 minute'
 where id = current_setting('t.bid_tr')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_tr')),
  '42501', 'This offer has expired. Ask the driver to send it again.',
  '6: accept_bid alone refuses an expired offer even with the trigger disabled');
select tests.as_owner();
alter table public.bids enable trigger trg_bids_offer_expiry;

-- Repeated / competing acceptance ------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_ok')),
  null, 'Job not open', '7: repeating the same acceptance is refused (no second assignment)');

select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job_ok')::uuid), 26.6::numeric,
  '8: commission was reserved exactly once, 7% of 380');
select is((select count(*)::int from public.wallet_transactions
            where job_id = current_setting('t.job_ok')::uuid), 0,
  '9: the reservation is a hold on the job, not a duplicated wallet deduction');

select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_a')),
  '10: with two offers on a job, accepting one succeeds');
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_b')),
  null, null, '11: the competing offer on the same job can no longer be accepted');

select tests.as_owner();
select is((select status::text from public.bids where id = current_setting('t.bid_b')::uuid), 'rejected',
  '12: the competing offer was rejected, so only one driver is assigned');

select * from finish();
rollback;
