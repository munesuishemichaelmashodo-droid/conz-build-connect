-- 0112 — owner decision 24/10/2026: know where every load came from and how the trip
-- went, without asking the customer for anything.
--   * First pickup photo: compared with the expected pickup point; more than 2 km away
--     or no location -> flagged for admins (and admins are notified).
--   * "Driver arranges pickup" jobs: the driver names where they loaded.
--   * Route trail: one point at most every 2 minutes while the trip is active, admins
--     only, kept 90 days.
begin;
select plan(27);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('pc_cust')::text, true);
select set_config('t.adm',  tests.create_user('pc_adm', array['admin'])::text, true);
select set_config('t.drv',  tests.create_driver('pc_drv', 500)::text, true);
select set_config('t.stranger', tests.create_user('pc_stranger')::text, true);

create function pg_temp.job(_pickup boolean) returns uuid language plpgsql as $$
declare _j uuid; _b uuid;
begin
  _j := tests.create_job(current_setting('t.cust')::uuid, 400);
  update public.jobs set delivery_lat = -17.80, delivery_lng = 31.05,
         pickup_lat = case when _pickup then -17.70 end, pickup_lng = case when _pickup then 31.00 end
   where id = _j;
  _b := tests.create_bid(_j, current_setting('t.drv')::uuid, 380);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_b);
  perform tests.as_owner();
  insert into storage.objects (bucket_id, name) values
    ('job-proof-photos', _j || '/pickup-1.jpg'), ('job-proof-photos', _j || '/pickup-2.jpg');
  return _j;
end $$;

create function pg_temp.pickup(_j uuid, _lat double precision, _lng double precision, _file text default 'pickup-1.jpg')
returns void language plpgsql as $$
begin
  perform tests.login_as(current_setting('t.drv')::uuid);
  perform public.record_job_evidence(_j, 'pickup', _j || '/' || _file, null, 'image/jpeg', _lat, _lng, 10,
    case when _lat is null then 'denied' else 'captured' end);
  perform tests.as_owner();
end $$;

create function pg_temp.check_of(_j uuid) returns public.job_pickup_checks language sql as $$
  select * from public.job_pickup_checks where job_id = _j $$;
create function pg_temp.admin_alerts(_j uuid) returns int language sql as $$
  select count(*)::int from public.notifications
   where job_id = _j and type = 'pickup_check' and user_id = current_setting('t.adm')::uuid $$;

-- ================================================================ pickup checks
select set_config('t.near', pg_temp.job(true)::text, true);
select pg_temp.pickup(current_setting('t.near')::uuid, -17.709, 31.00);        -- about 1 km away
select is((pg_temp.check_of(current_setting('t.near')::uuid)).status, 'ok', '1: a pickup photo within 2 km is fine');
select ok((pg_temp.check_of(current_setting('t.near')::uuid)).distance_m between 900 and 1100, '2: the distance is recorded (about 1 km)');
select is(pg_temp.admin_alerts(current_setting('t.near')::uuid), 0, '3: no admin alert for a normal pickup');

select set_config('t.far', pg_temp.job(true)::text, true);
select pg_temp.pickup(current_setting('t.far')::uuid, -17.75, 31.02);          -- about 6 km away
select is((pg_temp.check_of(current_setting('t.far')::uuid)).status, 'far', '4: more than 2 km away is flagged');
select ok((pg_temp.check_of(current_setting('t.far')::uuid)).distance_m between 5500 and 6500, '5: with the real distance');
select is(pg_temp.admin_alerts(current_setting('t.far')::uuid), 1, '6: admins are told once');
select pg_temp.pickup(current_setting('t.far')::uuid, -17.70, 31.00, 'pickup-2.jpg');
select is((pg_temp.check_of(current_setting('t.far')::uuid)).status, 'far', '7: a later pickup photo does not overwrite the first check');

select set_config('t.nogps', pg_temp.job(true)::text, true);
select pg_temp.pickup(current_setting('t.nogps')::uuid, null, null);
select is((pg_temp.check_of(current_setting('t.nogps')::uuid)).status, 'no_location', '8: a pickup photo without location is flagged');
select is(pg_temp.admin_alerts(current_setting('t.nogps')::uuid), 1, '9: admins are told');

-- "Driver arranges pickup": no expected point, the driver names the source.
select set_config('t.open', pg_temp.job(false)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.set_job_loaded_at(%L, 'Somewhere')$$, current_setting('t.open')),
  '42501', null, '10: the customer cannot say where the load came from');
select tests.login_as(current_setting('t.stranger')::uuid);
select throws_ok(format($$select public.set_job_loaded_at(%L, 'Somewhere')$$, current_setting('t.open')),
  '42501', null, '11: nor can anyone outside the job');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.set_job_loaded_at(%L, '  ')$$, current_setting('t.open')),
  '%name%', '12: an empty answer is refused');
select lives_ok(format($$select public.set_job_loaded_at(%L, 'Mazowe river sand pit')$$, current_setting('t.open')),
  '13: the assigned driver names where they loaded');
select tests.as_owner();
select pg_temp.pickup(current_setting('t.open')::uuid, -17.66, 30.95);
select is((pg_temp.check_of(current_setting('t.open')::uuid)).status, 'no_expected_point', '14: an open-request pickup has no expected point to compare');
select is((pg_temp.check_of(current_setting('t.open')::uuid)).loaded_at_name, 'Mazowe river sand pit', '15: the named source is kept with the check');
select is(pg_temp.admin_alerts(current_setting('t.open')::uuid), 0, '16: named and located, so no alert');

select set_config('t.open2', pg_temp.job(false)::text, true);
select pg_temp.pickup(current_setting('t.open2')::uuid, -17.66, 30.95);
select is(pg_temp.admin_alerts(current_setting('t.open2')::uuid), 1, '17: an open-request pickup with no named source alerts admins');

-- A broken alert never stops the driver recording the photo.
select set_config('t.far2', pg_temp.job(true)::text, true);
alter table public.notifications add constraint t_block_pickup_alerts check (type <> 'pickup_check') not valid;
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$select public.record_job_evidence(%L, 'pickup', %L, null, 'image/jpeg', -17.75, 31.02, 10, 'captured')$$,
  current_setting('t.far2'), current_setting('t.far2') || '/pickup-1.jpg'), '17a: a failing alert does not block the pickup photo');
select tests.as_owner();
alter table public.notifications drop constraint t_block_pickup_alerts;

-- Who can read checks.
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.job_pickup_checks), 0, '18: drivers cannot read pickup checks');
select tests.login_as(current_setting('t.adm')::uuid);
select ok((select count(*) from public.job_pickup_checks) >= 5, '19: admins can');

-- ================================================================ route trail
select tests.as_owner();
-- driver_locations_touch stamps every UPDATE with now(), so within this test every
-- update happens "now": a first point 10 minutes ago, then updates now.
insert into public.driver_locations (job_id, driver_id, lat, lng, updated_at)
values (current_setting('t.far')::uuid, current_setting('t.drv')::uuid, -17.700, 31.000, now() - interval '10 minutes');
update public.driver_locations set lat = -17.705 where job_id = current_setting('t.far')::uuid;
select is((select count(*)::int from public.job_route_points where job_id = current_setting('t.far')::uuid), 2,
  '20: a new point once 2 minutes have passed since the last one');
update public.driver_locations set lat = -17.706 where job_id = current_setting('t.far')::uuid;
update public.driver_locations set lat = -17.707 where job_id = current_setting('t.far')::uuid;
select is((select count(*)::int from public.job_route_points where job_id = current_setting('t.far')::uuid), 2,
  '21: updates less than 2 minutes after the last point add nothing');

update public.jobs set status = 'cancelled' where id = current_setting('t.near')::uuid;
insert into public.driver_locations (job_id, driver_id, lat, lng, updated_at)
values (current_setting('t.near')::uuid, current_setting('t.drv')::uuid, -17.70, 31.00, now());
select is((select count(*)::int from public.job_route_points where job_id = current_setting('t.near')::uuid), 0,
  '22: nothing is recorded for a job that is not active');

select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.job_route_points), 0, '23: drivers cannot read route trails');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.job_route_points), 0, '24: customers cannot read route trails');
select tests.login_as(current_setting('t.adm')::uuid);
select ok((select count(*) from public.job_route_points) >= 2, '25: admins can');

select tests.as_owner();
insert into public.job_route_points (job_id, driver_id, lat, lng, recorded_at)
values (current_setting('t.far')::uuid, current_setting('t.drv')::uuid, -17.7, 31.0, now() - interval '91 days');
select public.prune_job_route_points();
select is((select count(*)::int from public.job_route_points where recorded_at < now() - interval '90 days'), 0,
  '26: points older than 90 days are removed');

select * from finish();
rollback;
