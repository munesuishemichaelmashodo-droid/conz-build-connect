-- 0135: optional mobilisation deposit in an offer; the customer must accept the stated terms before selecting.
begin;
select plan(16);

select set_config('t.cust',  tests.create_user('od_cust')::text, true);
select set_config('t.cust2', tests.create_user('od_cust2')::text, true);
select set_config('t.drv',   tests.create_driver('od_drv', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('od_drv2', 100)::text, true);

select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);

-- 1. No-deposit offers stay possible and select normally
select set_config('t.b0', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.drv')::uuid, 190)::text, true);
select is((select deposit_required from public.bids where id = current_setting('t.b0')::uuid), false, 'an offer without a deposit stays the default');
select ok((select deposit_amount is null and deposit_reason is null and deposit_terms is null from public.bids where id = current_setting('t.b0')::uuid), 'and carries no deposit fields');

-- 2. Validation on the driver's side
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id, deposit_required, deposit_amount, deposit_reason, deposit_terms)
  values (%L, %L, 190, %L, true, 500, 'to buy fuel and book the loader', 'Refundable if I cancel; kept if you cancel after loading')$$,
  current_setting('t.j2'), current_setting('t.drv2'), tests.truck_of(current_setting('t.drv2')::uuid)), '22023', null, 'a deposit above the offer price is refused');
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id, deposit_required, deposit_amount, deposit_reason, deposit_terms)
  values (%L, %L, 190, %L, true, 50, 'x', 'Refundable if I cancel; kept if you cancel after loading')$$,
  current_setting('t.j2'), current_setting('t.drv2'), tests.truck_of(current_setting('t.drv2')::uuid)), '22023', null, 'a deposit needs a reason');
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id, deposit_required, deposit_amount, deposit_reason, deposit_terms)
  values (%L, %L, 190, %L, true, 50, 'to buy fuel and book the loader', 'no')$$,
  current_setting('t.j2'), current_setting('t.drv2'), tests.truck_of(current_setting('t.drv2')::uuid)), '22023', null, 'and cancellation / refund terms');

-- 3. A valid deposit offer; the driver cannot pre-accept it
with ins as (
  insert into public.bids (job_id, driver_id, price, truck_id, deposit_required, deposit_amount, deposit_reason, deposit_terms, deposit_terms_accepted_at)
  values (current_setting('t.j2')::uuid, current_setting('t.drv2')::uuid, 190, tests.truck_of(current_setting('t.drv2')::uuid), true, 50,
          'to buy fuel and book the loader', 'Refundable if I cancel; kept if you cancel after loading', now())
  returning id)
select set_config('t.bd', (select id::text from ins), true);
select ok((select deposit_required and deposit_amount = 50 and deposit_terms_accepted_at is null from public.bids where id = current_setting('t.bd')::uuid),
  'a deposit offer is stored, and a driver-supplied acceptance is ignored');

select tests.login_as(current_setting('t.drv2')::uuid);
select throws_ok(format($$update public.bids set deposit_terms_accepted_at = now() where id = %L$$, current_setting('t.bd')), '42501', null, 'the driver cannot accept for the customer');
select throws_ok(format($$select public.acknowledge_deposit_terms(%L)$$, current_setting('t.bd')), '42501', null, 'nor through the function');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select public.acknowledge_deposit_terms(%L)$$, current_setting('t.bd')), '42501', null, 'another customer cannot either');

-- 4. Selecting without accepting the terms is refused; after accepting it works
select tests.login_as(current_setting('t.cust')::uuid);
select is((select deposit_amount from public.bids where id = current_setting('t.bd')::uuid), 50.00::numeric, 'the customer sees the deposit and its terms');
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bd')), 'P0001', null, 'selecting the driver before accepting the deposit terms is refused');
select lives_ok(format($$select public.acknowledge_deposit_terms(%L)$$, current_setting('t.bd')), 'the customer accepts the terms');
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bd')), 'then selecting the driver works');

-- 5. Commission is unaffected by the deposit
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.j2')::uuid), 13.30::numeric, 'commission is still 7% of the job price (deposit is not part of it)');

-- 6. Changing the terms after acceptance resets it; no-deposit offers still select normally
select set_config('t.j3', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select set_config('t.bd3', tests.create_bid(current_setting('t.j3')::uuid, current_setting('t.drv')::uuid, 190)::text, true);
update public.bids set deposit_required = true, deposit_amount = 40, deposit_reason = 'to book the loader', deposit_terms = 'Refundable before loading starts' where id = current_setting('t.bd3')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select public.acknowledge_deposit_terms(current_setting('t.bd3')::uuid);
select tests.as_owner();
update public.bids set deposit_amount = 90 where id = current_setting('t.bd3')::uuid;
select is((select deposit_terms_accepted_at from public.bids where id = current_setting('t.bd3')::uuid), null, 'changing the amount after acceptance asks the customer again');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.b0')), 'an offer with no deposit is selected exactly as before');

select * from finish();
rollback;
