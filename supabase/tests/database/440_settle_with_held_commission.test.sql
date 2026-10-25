-- 0113: direct-pay settlement charges exactly the commission reserved at acceptance
-- (jobs.held_commission), not a fresh 7% of whatever the price and rate are at completion.
-- Also covers: duplicate completion, cancellation release, insufficient available credit,
-- the legacy fallback for jobs with no recorded reserve, and two jobs reserved as free.
-- (Parallel completions: scripts/db-concurrency-check.sh S7 and S8.)

begin;
select plan(23);

select set_config('t.cust', tests.create_user('sh_cust')::text, true);
select set_config('t.drv',  tests.create_driver('sh_drv', 100)::text, true);        -- free job already used

-- 1. Rate changed after acceptance -----------------------------------------------------------
select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b1', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b1')::uuid);
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.j1')::uuid), 28::numeric,
  'Acceptance reserves 7% of $400 = $28');
update public.system_settings set value = to_jsonb(10) where key = 'commission_rate';
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j1')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j1')::uuid), 28::numeric,
  'Rate raised to 10% after acceptance: the job is still charged the reserved $28, not $40');
select is(tests.balance(current_setting('t.drv')::uuid), 72::numeric, 'Wallet debited exactly the reserved $28');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric,
  'The reserve is released at completion');
select is((select sum(amount) from public.platform_ledger
            where job_id = current_setting('t.j1')::uuid and account = 'platform_revenue'), -28::numeric,
  'Platform revenue ledger shows $28');
update public.system_settings set value = to_jsonb(7) where key = 'commission_rate';

-- 2. Price changed by an admin after acceptance ----------------------------------------------
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b2', tests.create_bid(current_setting('t.j2')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b2')::uuid);
select tests.as_owner();
update public.jobs set final_price = 600 where id = current_setting('t.j2')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j2')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j2')::uuid), 28::numeric,
  'Price edited to $600 after acceptance: still charged the reserved $28, not $42');
select is(tests.balance(current_setting('t.drv')::uuid), 44::numeric, 'Wallet 72 - 28 = 44');

-- 3. Duplicate completion -----------------------------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.j2')::uuid))->>'already', 'true',
  'Completing the same job again is an idempotent no-op');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 44::numeric, 'No second charge');
select is((select count(*)::int from public.wallet_transactions
            where job_id = current_setting('t.j2')::uuid and type = 'commission'), 1,
  'Exactly one commission transaction for the job');
select is((select count(*)::int from public.platform_ledger
            where job_id = current_setting('t.j2')::uuid and account = 'platform_revenue'), 1,
  'Exactly one revenue ledger line for the job');

-- 4. Cancellation releases the reserve once ------------------------------------------------------
update public.wallets set balance = 100, held = 0 where user_id = current_setting('t.drv')::uuid;
select set_config('t.j3', tests.create_job(current_setting('t.cust')::uuid, 300)::text, true);
select set_config('t.b3', tests.create_bid(current_setting('t.j3')::uuid, current_setting('t.drv')::uuid, 300)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b3')::uuid);
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 21::numeric,
  '$21 (7% of $300) reserved');
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j3')::uuid, 'Changed plans');
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric,
  'Cancellation releases the reserve');
select is(tests.balance(current_setting('t.drv')::uuid), 100::numeric, 'Cancellation charges nothing');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.cancel_job(%L, 'again')$$, current_setting('t.j3')),
  '%already%', 'A cancelled job cannot be cancelled again');
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric,
  'The reserve never goes below zero');

-- 5. Insufficient available credit -------------------------------------------------------------
select set_config('t.poor', tests.create_driver('sh_poor', 20)::text, true);
select set_config('t.j4', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b4', tests.create_bid(current_setting('t.j4')::uuid, current_setting('t.poor')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.b4')),
  '%insufficient wallet balance%needs $28%has $20%',
  'Acceptance is refused when available credit ($20) is below the 7% reserve ($28)');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.j4')::uuid), 'open',
  'The job stays open');

-- 6. Legacy job with no recorded reserve keeps the old calculation ------------------------------
select set_config('t.j5', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b5', tests.create_bid(current_setting('t.j5')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b5')::uuid);
select tests.as_owner();
-- simulate a job accepted before reserves existed
update public.wallets set held = held - 28 where user_id = current_setting('t.drv')::uuid;
update public.jobs set held_commission = null where id = current_setting('t.j5')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j5')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j5')::uuid), 28::numeric,
  'No recorded reserve: falls back to 7% of the accepted price');

-- 7. Two jobs reserved as free; the second pays 7% once the free job is used --------------------
select set_config('t.new', tests.create_driver('sh_new', 100, false)::text, true);    -- free job unused
select set_config('t.j6', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.j7', tests.create_job(current_setting('t.cust')::uuid, 500)::text, true);
select set_config('t.b6', tests.create_bid(current_setting('t.j6')::uuid, current_setting('t.new')::uuid, 400)::text, true);
select set_config('t.b7', tests.create_bid(current_setting('t.j7')::uuid, current_setting('t.new')::uuid, 500)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b6')::uuid);
select public.accept_bid(current_setting('t.b7')::uuid);
select tests.as_owner();
select is((select array_agg(held_commission order by budget) from public.jobs
            where id in (current_setting('t.j6')::uuid, current_setting('t.j7')::uuid)), array[0,0]::numeric[],
  'Both jobs were reserved as free while the free job was unused');
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j6')::uuid);
select tests.complete(current_setting('t.j7')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j6')::uuid), 0::numeric,
  'First completion uses the free job');
select is((select commission from public.jobs where id = current_setting('t.j7')::uuid), 35::numeric,
  'Second completion pays 7% of its accepted $500 price because the free job is used');
select is(tests.balance(current_setting('t.new')::uuid), 65::numeric, 'Wallet 100 - 35 = 65');

select * from finish();
rollback;
