-- Commission basis and the driver-level multiplier (audit, 11/10/2026).
--
-- CURRENT BEHAVIOUR (pinned here, NOT changed): the commission HELD at
-- acceptance and the affordability gate (driver_can_accept) use
--   round(price * commission_rate / 100, 2)               -- no level multiplier
-- while the amount actually CHARGED at completion (complete_job /
-- release_escrow_and_complete) uses
--   round(price * commission_rate / 100 * level_multiplier, 2).
-- For a gold driver (x0.90) on a $400 job at 7%: held/required $28.00, charged $25.20.
-- The hold is conservative (never less than the charge) and is released in full
-- at completion, so no money is stranded. If the owner approves aligning them,
-- flip assertions 1-2 to 25.20 and keep the rest unchanged.

begin;
select plan(7);

select set_config('t.cust', tests.create_user('cm_cust')::text, true);
select set_config('t.drv',  tests.create_driver('cm_gold', 100)::text, true);

select tests.as_owner();
update public.driver_profiles set level = 'gold' where user_id = current_setting('t.drv')::uuid;
select set_config('t.j', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b', tests.create_bid(current_setting('t.j')::uuid, current_setting('t.drv')::uuid, 400)::text, true);

-- affordability gate (as the driver)
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.driver_can_accept(current_setting('t.j')::uuid)->>'required')::numeric, 28.00::numeric,
  'Gate/hold use the base rate: 7% of $400, level multiplier ignored');

-- customer accepts -> commission is held on the driver's wallet
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b')::uuid);
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 28.00::numeric, 'Held at acceptance = $28.00');
select set_config('t.held', (select held::text from public.wallets where user_id = current_setting('t.drv')::uuid), true);

-- completion charges the level-adjusted commission and releases the whole hold
select tests.login_as(current_setting('t.cust')::uuid);
select public.complete_job(current_setting('t.j')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j')::uuid), 25.20::numeric, 'Charged commission = 7% x 0.90 (gold) = $25.20');
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 74.80::numeric, 'Driver balance = 100 - 25.20');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0.00::numeric, 'The entire hold is released at completion');
select cmp_ok(current_setting('t.held')::numeric, '>=', (select commission from public.jobs where id = current_setting('t.j')::uuid),
  'Invariant: the hold never under-collects the commission actually charged');
select is((select amount from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and job_id = current_setting('t.j')::uuid and type = 'commission'),
  -25.20::numeric, 'The ledger row records the charged amount');

select * from finish();
rollback;
