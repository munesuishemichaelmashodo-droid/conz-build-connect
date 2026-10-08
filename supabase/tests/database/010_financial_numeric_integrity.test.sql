-- Phase 1 / audit F1 — financial numeric integrity.
--
-- Proves that no client or admin path can put a negative, zero, NaN,
-- ±Infinity or absurdly large amount into a money column, and that the money
-- RPCs refuse such values even when they are already present in a row
-- (legacy data, or a constraint ever being dropped).
--
-- Identities are switched exactly the way PostgREST does it (role + JWT
-- claims), so "as driver" below means "a signed-in driver calling the API".

begin;
select plan(39);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select set_config('t.customer', tests.create_user('cust')::text, true);
select set_config('t.driver',   tests.create_driver('drv', 100)::text, true);
select set_config('t.super',    tests.create_user('super', array['super_admin','admin'])::text, true);
select set_config('t.admin',    tests.create_user('admin', array['admin'])::text, true);
select set_config('t.job',      tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.jb1', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.jb2', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.jb3', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.jb4', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.jb5', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.jb6', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);

-- ---------------------------------------------------------------------------
-- 1. Bids: a driver cannot submit a non-positive / non-finite / huge price
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.driver')::uuid);

select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, -1000, %L)$$,
         current_setting('t.jb1'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  '23514', null, 'F1: negative bid price rejected');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 0, %L)$$,
         current_setting('t.jb2'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  '23514', null, 'F1: zero bid price rejected');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 'NaN', %L)$$,
         current_setting('t.jb3'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  '23514', null, 'F1: NaN bid price rejected');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 'Infinity', %L)$$,
         current_setting('t.jb4'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  null, null, 'F1: Infinity bid price rejected');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, '-Infinity', %L)$$,
         current_setting('t.jb5'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  null, null, 'F1: -Infinity bid price rejected');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 100000.01, %L)$$,
         current_setting('t.jb6'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  '23514', null, 'F1: bid price above the $100,000 platform limit rejected');
select lives_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 380, %L)$$,
         current_setting('t.job'), current_setting('t.driver'), tests.truck_of(current_setting('t.driver')::uuid)),
  'Happy path: a normal $380 bid is accepted');

-- A driver editing their own pending bid to a bad price is also rejected.
select throws_ok(
  format($$update public.bids set price = -5 where job_id = %L and driver_id = %L$$,
         current_setting('t.job'), current_setting('t.driver')),
  '23514', null, 'F1: editing a bid to a negative price rejected');
select throws_ok(
  format($$update public.bids set price = 'NaN' where job_id = %L and driver_id = %L$$,
         current_setting('t.job'), current_setting('t.driver')),
  '23514', null, 'F1: editing a bid to NaN rejected');

-- ---------------------------------------------------------------------------
-- 2. Counter-offers and budgets (customer side)
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.customer')::uuid);
select set_config('t.bid', (select id::text from public.bids where job_id = current_setting('t.job')::uuid), true);

select throws_ok(format($$select public.counter_bid(%L, 'NaN')$$, current_setting('t.bid')),
  null, null, 'F1: NaN counter-offer rejected');
select throws_ok(format($$select public.counter_bid(%L, -50)$$, current_setting('t.bid')),
  null, null, 'F1: negative counter-offer rejected');
select throws_ok(format($$select public.counter_bid(%L, 'Infinity')$$, current_setting('t.bid')),
  null, null, 'F1: Infinity counter-offer rejected');
select throws_ok(format($$select public.counter_bid(%L, 100001)$$, current_setting('t.bid')),
  null, null, 'F1: counter-offer above the platform limit rejected');

-- Custom material is not price-enforced, so the budget CHECK is the only guard.
select throws_ok($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget)
                   values (auth.uid(), 'custom', 10, 'x', -500)$$,
  '23514', null, 'F1: negative job budget rejected');
select throws_ok($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget)
                   values (auth.uid(), 'custom', 10, 'x', 'NaN')$$,
  '23514', null, 'F1: NaN job budget rejected');
select throws_ok($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget)
                   values (auth.uid(), 'custom', 10, 'x', 0)$$,
  '23514', null, 'F1: zero job budget rejected');
select throws_ok($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget)
                   values (auth.uid(), 'custom', -3, 'x', 100)$$,
  '23514', null, 'F1: negative quantity rejected');
select throws_ok($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget)
                   values (auth.uid(), 'custom', 'NaN', 'x', 100)$$,
  '23514', null, 'F1: NaN quantity rejected');

select throws_ok(format($$select public.raise_job_budget(%L, 'NaN')$$, current_setting('t.job')),
  null, null, 'F1: raising a budget to NaN rejected');
select throws_ok(format($$select public.raise_job_budget(%L, 100001)$$, current_setting('t.job')),
  null, null, 'F1: raising a budget above the platform limit rejected');

-- ---------------------------------------------------------------------------
-- 3. End-to-end money-minting attack (direct pay): even if a bad value were
--    already sitting in a row (legacy data), accept/complete must refuse it.
--    The constraint is dropped inside this rolled-back transaction purely to
--    model such a row; it is restored immediately after.
-- ---------------------------------------------------------------------------
select tests.as_owner();
alter table public.bids drop constraint if exists bids_price_valid;
select set_config('t.badbid',
  tests.create_bid(current_setting('t.job')::uuid, tests.create_driver('drv2', 100), -1000)::text, true);
alter table public.bids add constraint bids_price_valid
  check (price > 0 and price <= 100000) not valid;

select tests.login_as(current_setting('t.customer')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.badbid')),
  null, null, 'F1: accept_bid refuses a non-positive bid price already in the table');

-- Same for a legacy job whose final_price is invalid at completion time.
select tests.as_owner();
select set_config('t.drv3', tests.create_driver('drv3', 100)::text, true);
select set_config('t.job3', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
alter table public.jobs drop constraint if exists jobs_final_price_valid;
update public.jobs set status = 'accepted', driver_id = current_setting('t.drv3')::uuid,
       final_price = -1000 where id = current_setting('t.job3')::uuid;
alter table public.jobs add constraint jobs_final_price_valid
  check (final_price is null or (final_price > 0 and final_price <= 100000)) not valid;

select tests.login_as(current_setting('t.customer')::uuid);
select throws_ok(format($$select public.complete_job(%L)$$, current_setting('t.job3')),
  null, null, 'F1: complete_job refuses a negative final price (no negative commission)');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv3')::uuid), 100.00::numeric,
  'F1: driver balance unchanged after the refused completion');

-- Legacy job with an invalid budget cannot be taken via a dispatch offer.
select set_config('t.drv4', tests.create_driver('drv4', 100)::text, true);
select set_config('t.job4', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
alter table public.jobs drop constraint if exists jobs_budget_valid;
update public.jobs set budget = -1000 where id = current_setting('t.job4')::uuid;
alter table public.jobs add constraint jobs_budget_valid
  check (budget > 0 and budget <= 100000) not valid;
insert into public.job_dispatch_offers (job_id, driver_id, expires_at)
  values (current_setting('t.job4')::uuid, current_setting('t.drv4')::uuid, now() + interval '10 minutes')
  on conflict (job_id, driver_id) do update set status = 'pending', expires_at = excluded.expires_at;
select set_config('t.offer4', (select id::text from public.job_dispatch_offers
                               where job_id = current_setting('t.job4')::uuid and driver_id = current_setting('t.drv4')::uuid), true);
select tests.login_as(current_setting('t.drv4')::uuid);
select throws_ok(format($$select public.accept_dispatch_offer(%L)$$, current_setting('t.offer4')),
  null, null, 'F1: accept_dispatch_offer refuses a job with a non-positive budget');

-- ---------------------------------------------------------------------------
-- 4. Happy path: a normal direct-pay job charges a positive commission
-- ---------------------------------------------------------------------------
select tests.as_owner();
select set_config('t.drv5', tests.create_driver('drv5', 100)::text, true);
select set_config('t.job5', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.bid5', tests.create_bid(current_setting('t.job5')::uuid, current_setting('t.drv5')::uuid, 400)::text, true);
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
  values (current_setting('t.drv5')::uuid, 'topup', 100, 100, 'test opening balance');

select tests.login_as(current_setting('t.customer')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid5')),
  'Happy path: customer accepts a valid $400 bid');
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job5')::uuid), 28.00::numeric,
  'Happy path: 7% commission ($28) reserved on acceptance');
select tests.login_as(current_setting('t.customer')::uuid);
select lives_ok(format($$select public.complete_job(%L)$$, current_setting('t.job5')),
  'Happy path: customer confirms completion');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv5')::uuid), 72.00::numeric,
  'Happy path: driver wallet debited exactly the $28 commission');
select ok((select commission >= 0 from public.jobs where id = current_setting('t.job5')::uuid),
  'Happy path: recorded commission is non-negative');
select ok(tests.ledger_matches(current_setting('t.drv5')::uuid),
  'Ledger invariant: driver ledger sum equals wallet balance');

-- ---------------------------------------------------------------------------
-- 5. Wallet columns can never hold non-finite / negative-held values,
--    even for the table owner (constraint-level).
-- ---------------------------------------------------------------------------
select throws_ok(format($$update public.wallets set balance = 'NaN' where user_id = %L$$, current_setting('t.drv5')),
  '23514', null, 'F1: wallet balance cannot be NaN');
select throws_ok(format($$update public.wallets set held = -1 where user_id = %L$$, current_setting('t.drv5')),
  '23514', null, 'F1: wallet held cannot be negative');
select throws_ok(format($$update public.wallets set held = 'NaN' where user_id = %L$$, current_setting('t.drv5')),
  '23514', null, 'F1: wallet held cannot be NaN');
select throws_ok(format($$insert into public.wallet_transactions (user_id, type, amount, balance_after) values (%L, 'topup', 'NaN', 0)$$, current_setting('t.drv5')),
  '23514', null, 'F1: ledger amount cannot be NaN');

-- ---------------------------------------------------------------------------
-- 6. Admin money RPCs reject invalid amounts (super_admin, the most
--    privileged caller; MFA/caps are covered in the Phase 6 tests)
-- ---------------------------------------------------------------------------
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$select public.admin_credit_wallet(%L, 'NaN', 'test')$$, current_setting('t.customer')),
  null, null, 'F1: admin_credit_wallet rejects NaN');
select throws_ok(format($$select public.admin_credit_wallet(%L, 'Infinity', 'test')$$, current_setting('t.customer')),
  null, null, 'F1: admin_credit_wallet rejects Infinity');
select throws_ok(format($$select public.admin_wallet_adjust(%L, 'NaN', 'other', 'test')$$, current_setting('t.customer')),
  null, null, 'F1: admin_wallet_adjust rejects NaN');
select throws_ok(format($$select public.admin_wallet_adjust(%L, '-Infinity', 'other', 'test')$$, current_setting('t.customer')),
  null, null, 'F1: admin_wallet_adjust rejects -Infinity');
select tests.as_owner();
select is(tests.balance(current_setting('t.customer')::uuid), 0.00::numeric,
  'F1: customer balance unchanged after rejected admin calls');

select * from finish();
rollback;
