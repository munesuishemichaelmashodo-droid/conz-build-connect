-- 0130: referral rewards qualify on a verified completed delivery whatever the payment method,
-- admin-approved referrals are processed, and nothing is paid twice.
begin;
select plan(20);
select tests.enable_launch_features();

select set_config('t.ref',  tests.create_user('rf_ref')::text, true);          -- referrer (customer)
select set_config('t.c1',   tests.create_user('rf_c1')::text, true);           -- paid the driver directly
select set_config('t.c2',   tests.create_user('rf_c2')::text, true);           -- paid through Con Z (released payment)
select set_config('t.c3',   tests.create_user('rf_c3')::text, true);           -- only a cancelled job
select set_config('t.c4',   tests.create_user('rf_c4')::text, true);           -- rejected referral
select set_config('t.c5',   tests.create_user('rf_c5')::text, true);           -- admin-approved, not qualified yet
select set_config('t.c6',   tests.create_user('rf_c6')::text, true);           -- delivered by the referrer
select set_config('t.c7',   tests.create_user('rf_c7')::text, true);           -- open dispute on the only job
select set_config('t.c8',   tests.create_user('rf_c8')::text, true);           -- approved with amount, hold passed
select set_config('t.drv',  tests.create_driver('rf_drv', 100)::text, true);
select set_config('t.rdrv', tests.create_driver('rf_rdrv', 100)::text, true);  -- referring driver
select set_config('t.d1',   tests.create_driver('rf_d1', 100)::text, true);    -- referred driver, 5 deliveries
select set_config('t.d2',   tests.create_driver('rf_d2', 100)::text, true);    -- referred driver, 4 deliveries

create function pg_temp.done_job(_cust uuid, _driver uuid, _method text) returns uuid language plpgsql as $$
declare _j uuid;
begin
  _j := tests.create_job(_cust, 200, _method);
  update public.jobs set status = 'completed', driver_id = _driver, final_price = 200, completed_at = now() where id = _j;
  return _j;
end $$;
create function pg_temp.ref(_referrer uuid, _referred uuid, _role text default 'customer') returns uuid language sql as $$
  insert into public.referrals (referrer_id, referred_id, referral_code, referred_role)
  values (_referrer, _referred, 'TEST', _role) returning id $$;

select tests.as_owner();
-- c1 direct pay, no payments row at all
select set_config('t.r1', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c1')::uuid)::text, true);
select pg_temp.done_job(current_setting('t.c1')::uuid, current_setting('t.drv')::uuid, 'direct');
-- c2 Con Z Pay: the payment is 'released' once the job completes
select set_config('t.r2', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c2')::uuid)::text, true);
select set_config('t.j2', pg_temp.done_job(current_setting('t.c2')::uuid, current_setting('t.drv')::uuid, 'escrow')::text, true);
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.c2')::uuid, current_setting('t.j2')::uuid, 'escrow', 200, 'USD', 'paynow', 'released');
-- c3 cancelled only
select set_config('t.r3', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c3')::uuid)::text, true);
update public.jobs set status = 'cancelled' where id = tests.create_job(current_setting('t.c3')::uuid, 200, 'direct');
-- c4 rejected referral with a completed job
select set_config('t.r4', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c4')::uuid)::text, true);
update public.referrals set reward_status = 'rejected' where id = current_setting('t.r4')::uuid;
select pg_temp.done_job(current_setting('t.c4')::uuid, current_setting('t.drv')::uuid, 'direct');
-- c5 admin approved before qualifying (no amount yet), job completed
select set_config('t.r5', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c5')::uuid)::text, true);
update public.referrals set reward_status = 'approved' where id = current_setting('t.r5')::uuid;
select pg_temp.done_job(current_setting('t.c5')::uuid, current_setting('t.drv')::uuid, 'direct');
-- c6 delivered by the referrer (a referring DRIVER)
select set_config('t.r6', pg_temp.ref(current_setting('t.rdrv')::uuid, current_setting('t.c6')::uuid)::text, true);
select pg_temp.done_job(current_setting('t.c6')::uuid, current_setting('t.rdrv')::uuid, 'direct');
-- c7 open dispute on the only completed job
select set_config('t.r7', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c7')::uuid)::text, true);
select set_config('t.j7', pg_temp.done_job(current_setting('t.c7')::uuid, current_setting('t.drv')::uuid, 'direct')::text, true);
insert into public.disputes (job_id, raised_by, against, reason, category, status)
values (current_setting('t.j7')::uuid, current_setting('t.c7')::uuid, current_setting('t.drv')::uuid, 'test dispute', 'other', 'open');
-- c8 approved with an amount and a hold that has passed
select set_config('t.r8', pg_temp.ref(current_setting('t.ref')::uuid, current_setting('t.c8')::uuid)::text, true);
update public.referrals set reward_status = 'approved', reward_amount = 10, verification_status = 'verified',
       reward_release_at = now() - interval '1 minute' where id = current_setting('t.r8')::uuid;
-- driver referrals
select set_config('t.rd1', pg_temp.ref(current_setting('t.rdrv')::uuid, current_setting('t.d1')::uuid, 'driver')::text, true);
select set_config('t.rd2', pg_temp.ref(current_setting('t.rdrv')::uuid, current_setting('t.d2')::uuid, 'driver')::text, true);
update public.driver_profiles set jobs_completed = 5 where user_id = current_setting('t.d1')::uuid;
update public.driver_profiles set jobs_completed = 4 where user_id = current_setting('t.d2')::uuid;

select public.process_referral_lifecycle();

create function pg_temp.st(_id text) returns text language sql as
  $$ select verification_status || '/' || reward_status || '/' || coalesce(reward_amount::text, '-') from public.referrals where id = _id::uuid $$;

select is(pg_temp.st(current_setting('t.r1')), 'verified/hold/10', 'customer who paid the driver directly qualifies (no ConZ payment row needed)');
select is(pg_temp.st(current_setting('t.r2')), 'verified/hold/10', 'customer who paid through Con Z qualifies (payment is released, not paid)');
select is(pg_temp.st(current_setting('t.r3')), 'pending/pending/-', 'a cancelled job does not qualify');
select is(pg_temp.st(current_setting('t.r4')), 'pending/rejected/-', 'a rejected referral is not processed');
select is(pg_temp.st(current_setting('t.r5')), 'verified/hold/10', 'an admin-approved referral that qualifies moves on to the hold period');
select is(pg_temp.st(current_setting('t.r6')), 'pending/pending/-', 'a delivery made by the referrer does not qualify');
select is(pg_temp.st(current_setting('t.r7')), 'pending/pending/-', 'a job with an open dispute does not qualify');
select is(pg_temp.st(current_setting('t.r8')), 'verified/released/10', 'an approved reward whose hold has passed is released');
select is(pg_temp.st(current_setting('t.rd1')), 'verified/hold/15', 'a verified driver with 5 deliveries qualifies the driver referral');
select is(pg_temp.st(current_setting('t.rd2')), 'pending/pending/-', 'a driver with 4 deliveries does not yet');
select is((select balance from public.wallets where user_id = current_setting('t.c1')::uuid), 5.00::numeric,
  'the referred customer gets the existing first-order credit once');

-- Pay the held rewards, then run again: nothing is paid twice.
update public.referrals set reward_release_at = now() - interval '1 minute' where reward_status = 'hold';
select public.process_referral_lifecycle();
select public.process_referral_lifecycle();
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.ref')::uuid and type = 'referral_bonus'),
  4, 'four rewards released to the referrer (c1, c2, c5, c8), each exactly once after repeated runs');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.c1')::uuid and note = 'First-order referral credit'),
  1, 'the first-order credit was not repeated');
select is((select count(*)::int from public.referrals where reward_status = 'released' and reward_transaction_id is null), 0,
  'every released reward points at its ledger row');
select is((select count(*)::int from (select reward_transaction_id from public.referrals where reward_transaction_id is not null
           group by 1 having count(*) > 1) d), 0, 'no ledger row is shared by two referrals');

-- Claims: self-referral and a second claim are refused.
select tests.login_as(current_setting('t.ref')::uuid);
select throws_ok(format($$select public.record_referral((select referral_code from public.profiles where id = %L), 'customer')$$, current_setting('t.ref')),
  'P0001', 'You cannot refer yourself', 'self-referral is refused');
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok(format($$select public.record_referral((select referral_code from public.profiles where id = %L), 'customer')$$, current_setting('t.c3')),
  'P0001', 'This account has already redeemed a referral code', 'a second claim is refused');
select tests.as_owner();
select is((select value #>> '{}' from public.system_settings where key = 'commission_rate'), '7', 'the 7% commission is untouched');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and type = 'referral_bonus'), 0,
  'the delivering driver gets no referral money');
select is((select count(*)::int from public.wallet_transactions where type = 'commission' and user_id = current_setting('t.rdrv')::uuid), 0,
  'referral processing writes no commission entries');

select * from finish();
rollback;
