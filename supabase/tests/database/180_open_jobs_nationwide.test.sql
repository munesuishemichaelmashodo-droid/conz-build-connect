-- Owner decision 11/10/2026: the open-jobs feed shows distance and flags far jobs
-- in the app, but the DATABASE keeps nationwide visibility and bidding for every
-- eligible driver, while verification, wallet and truck rules stay enforced.
-- (Instant-dispatch geography is covered separately by 150.)

begin;
select plan(10);

select set_config('t.cust',    tests.create_user('ov_cust')::text, true);
select set_config('t.near',    tests.create_driver('ov_near', 100)::text, true);
select set_config('t.far',     tests.create_driver('ov_far', 100)::text, true);
select set_config('t.limited', tests.create_driver('ov_limited', 100)::text, true);
select set_config('t.pending', tests.create_driver('ov_pending', 100)::text, true);

select tests.as_owner();
-- A job whose pickup is in Bulawayo; one driver is 'near' it, one is ~370 km away.
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set pickup_lat = -20.15, pickup_lng = 28.58 where id = current_setting('t.job')::uuid;
insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at) values
  (current_setting('t.near')::uuid, -20.16, 28.59, true, now()),
  (current_setting('t.far')::uuid, -17.83, 31.05, true, now());
update public.wallets set limited = true where user_id = current_setting('t.limited')::uuid;
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.pending')::uuid;

-- visibility is nationwide for verified drivers, near or far
select tests.login_as(current_setting('t.far')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 1,
  'a verified driver ~370 km away still sees the job');
select is((select count(*)::int from public.driver_available_jobs() where id = current_setting('t.job')::uuid), 1,
  'and it is in their open-jobs list');
select tests.login_as(current_setting('t.near')::uuid);
select is((select count(*)::int from public.driver_available_jobs() where id = current_setting('t.job')::uuid), 1,
  'a nearby verified driver sees it too');

-- verification still required
select tests.login_as(current_setting('t.pending')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 0,
  'a driver pending verification sees nothing, however close');

-- bidding: nationwide for eligible drivers
select tests.login_as(current_setting('t.far')::uuid);
select lives_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 400, %L)$$,
  current_setting('t.job'), current_setting('t.far'), tests.truck_of(current_setting('t.far')::uuid)),
  'a distant verified driver can still bid');
select tests.as_owner();
select is((select capacity_m3_snapshot from public.bids where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.far')::uuid),
  15::numeric, 'the bid is stamped with the driver''s real truck capacity server-side');

-- bidding: existing gates unchanged
select tests.login_as(current_setting('t.near')::uuid);
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 400, %L)$$,
  current_setting('t.job'), current_setting('t.near'), tests.truck_of(current_setting('t.far')::uuid)),
  null, null, 'a bid cannot use another driver''s truck');
select tests.login_as(current_setting('t.limited')::uuid);
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 400, %L)$$,
  current_setting('t.job'), current_setting('t.limited'), tests.truck_of(current_setting('t.limited')::uuid)),
  null, null, 'a driver with a limited wallet cannot bid');
select tests.login_as(current_setting('t.pending')::uuid);
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 400, %L)$$,
  current_setting('t.job'), current_setting('t.pending'), tests.truck_of(current_setting('t.pending')::uuid)),
  null, null, 'an unverified driver cannot bid');

-- instant dispatch stays geographic: the far driver is NOT eligible for an offer
select tests.as_service();
select is((select count(*)::int from public.eligible_dispatch_drivers(current_setting('t.job')::uuid, 100)
            where driver_id = current_setting('t.far')::uuid), 0,
  'instant dispatch still excludes the distant driver (0089 unchanged)');

select * from finish();
rollback;
