-- 0133: exact delivery location, notes contacts, tracking token and customer details stay private until a
-- driver is selected (commission reserved); cancellation and reassignment close access again.
begin;
select plan(31);


select set_config('t.cust',  tests.create_user('lp_cust')::text, true);
select set_config('t.dsel',  tests.create_driver('lp_dsel', 100)::text, true);    -- will be selected
select set_config('t.dpoor', tests.create_driver('lp_dpoor', 0)::text, true);     -- cannot cover the commission
select set_config('t.doth',  tests.create_driver('lp_doth', 100)::text, true);    -- verified, never selected
select set_config('t.admin', tests.create_user('lp_admin', array['admin'])::text, true);

select tests.as_owner();
update public.profiles set phone = '+263771234567', full_name = 'Private Customer' where id = current_setting('t.cust')::uuid;
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct', 'custom', 12)::text, true);
update public.jobs set delivery_address = 'Plot 12 Harward Road, Belvedere, Harare, Zimbabwe',
       delivery_lat = -17.8123, delivery_lng = 31.0456, notes = 'Call 0771234567 or a@b.co at the gate',
       receiver_name = 'Mr Moyo' where id = current_setting('t.job')::uuid;

-- Customer (owner) still sees everything on their own open job
select tests.login_as(current_setting('t.cust')::uuid);
select is((select delivery_address from public.jobs where id = current_setting('t.job')::uuid),
  'Plot 12 Harward Road, Belvedere, Harare, Zimbabwe', 'the customer still sees their own exact address');

-- 1-3 Unselected verified driver: table
select tests.login_as(current_setting('t.doth')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 0, 'an unselected driver cannot read the job row');
select is((select count(*)::int from public.jobs), 0, 'nor list jobs from the table');
select is((select count(*)::int from public.jobs where delivery_lat is not null), 0, 'nor filter on coordinates');
select is((select count(*)::int from public.profiles where id = current_setting('t.cust')::uuid), 0, 'nor read the customer profile (phone, e-mail)');

-- 4 What they CAN see: the area only
select is((select delivery_address from public.driver_open_job(current_setting('t.job')::uuid)), 'Belvedere, Harare', 'area only, no street');
select is((select delivery_lat from public.driver_open_job(current_setting('t.job')::uuid)), -17.81::double precision, 'latitude rounded to about 1 km');
select is((select delivery_lng from public.driver_open_job(current_setting('t.job')::uuid)), 31.05::double precision, 'longitude rounded to about 1 km');
select ok((select notes from public.driver_open_job(current_setting('t.job')::uuid)) !~ '0771234567|a@b\.co', 'phone numbers and e-mail addresses are removed from notes');
select ok((select tracking_token is null and receiver_name is null and dropoff_address is null from public.driver_open_job(current_setting('t.job')::uuid)),
  'no tracking token, receiver or drop-off details');
select is((select delivery_address from public.driver_available_jobs() where id = current_setting('t.job')::uuid), 'Belvedere, Harare', 'the feed shows the area only');
select is((select delivery_lat from public.driver_available_jobs() where id = current_setting('t.job')::uuid), -17.81::double precision, 'and rounded coordinates');
select is((select count(*)::int from public.driver_open_jobs()), 1, 'the open-jobs list works');

-- 5 Direct calls to the original (exact) functions are refused
select throws_ok($$select * from public._driver_available_jobs_exact(10, 0)$$, '42501', null, 'the exact feed function is not callable');
select throws_ok($$select * from public._find_next_loads_exact(auth.uid(), gen_random_uuid())$$, '42501', null, 'nor the exact next-loads function');
select throws_ok($$select public.mask_job_for_driver(j) from public.jobs j limit 1$$, '42501', null, 'nor the masking helper');

-- 6 Signed-out visitors
select tests.as_anon();
select is((select count(*)::int from public.jobs), 0, 'a signed-out visitor reads no job');
select throws_ok($$select * from public.driver_open_job(gen_random_uuid())$$, '42501', null, 'and cannot call the preview function');

-- 7 A failed commission reservation unlocks nothing
select tests.as_owner();
select set_config('t.bpoor', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.dpoor')::uuid, 190)::text, true);
select set_config('t.bsel',  tests.create_bid(current_setting('t.job')::uuid, current_setting('t.dsel')::uuid, 190)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bpoor')), null, null, 'selecting a driver who cannot cover the commission fails');
select tests.login_as(current_setting('t.dpoor')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 0, 'the driver whose reservation failed still cannot read the job');
select tests.as_owner();
select ok((select driver_id is null and status = 'open' from public.jobs where id = current_setting('t.job')::uuid), 'the job is still open and unassigned');

-- 8 Successful selection unlocks the selected driver only
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bsel')), 'selecting a driver who can cover it succeeds');
select tests.login_as(current_setting('t.dsel')::uuid);
select ok((select delivery_address = 'Plot 12 Harward Road, Belvedere, Harare, Zimbabwe' and delivery_lat = -17.8123 from public.jobs where id = current_setting('t.job')::uuid),
  'the selected driver now reads the exact address and coordinates');
select is((select phone from public.profiles where id = current_setting('t.cust')::uuid), '+263771234567', 'and the customer contact for this job');
select tests.login_as(current_setting('t.doth')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 0, 'other drivers are still locked out');

-- 9 Cancellation closes access again
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.cancel_job(%L, 'changed my mind')$$, current_setting('t.job')), 'the customer cancels');
select tests.login_as(current_setting('t.dsel')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 0, 'a cancelled job is no longer readable by the former driver');
select ok((select delivery_address = 'Belvedere, Harare' and customer_name is null from public.driver_job_history() where id = current_setting('t.job')::uuid),
  'driver history shows the area only and no customer name for a cancelled job');

-- 10 Reassignment closes access for the previous driver
select tests.as_owner();
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct', 'custom', 12)::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.dsel')::uuid where id = current_setting('t.job2')::uuid;
update public.jobs set driver_id = current_setting('t.doth')::uuid where id = current_setting('t.job2')::uuid;
select tests.login_as(current_setting('t.dsel')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job2')::uuid), 0, 'the previous driver loses access after reassignment');
select tests.login_as(current_setting('t.doth')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job2')::uuid), 1, 'the new driver gains it');

-- 11 Admin keeps full access
select tests.login_as(current_setting('t.admin')::uuid);
select is((select delivery_address from public.jobs where id = current_setting('t.job')::uuid),
  'Plot 12 Harward Road, Belvedere, Harare, Zimbabwe', 'an admin still reads the exact address');

select * from finish();
rollback;
