-- 0126 — shared tracking link shows more without exposing more:
--   * step times (loaded, arrived at the site, delivered)
--   * the truck's direction, rounded to 15 degrees, only with a live position
--   * the line driven since loading (thinned to at most ~200 points, ~11 m precision),
--     only while the trip is in progress
--   * a cancelled job's link says "cancelled" and nothing else
begin;
select plan(16);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('pt_cust')::text, true);
select set_config('t.drv',  tests.create_driver('pt_drv', 500)::text, true);

select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set delivery_lat = -17.83, delivery_lng = 31.02, pickup_lat = -17.75, pickup_lng = 31.08
 where id = current_setting('t.job')::uuid;
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 380)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_owner();
select set_config('t.tok', (select tracking_token::text from public.jobs where id = current_setting('t.job')::uuid), true);

create function pg_temp.track() returns jsonb language sql as $$
  select public.get_public_tracking(current_setting('t.tok')::uuid)::jsonb
$$;

-- Accepted, not loaded yet
insert into public.driver_locations (job_id, driver_id, lat, lng, heading, accuracy, updated_at)
values (current_setting('t.job')::uuid, current_setting('t.drv')::uuid, -17.76, 31.07, 227, 10, now());
select tests.as_anon();
select is(pg_temp.track() -> 'times' ->> 'loaded_at', null, 'Not loaded yet: no loaded time');
select is((pg_temp.track() -> 'live' ->> 'heading')::int, 225, 'Direction is rounded to 15 degrees');
select is(pg_temp.track() -> 'trail', 'null'::jsonb, 'No trail before the trip starts');
select ok(not (pg_temp.track() ? 'pickup_lat') and not (pg_temp.track() ? 'pickup_address'),
  'The link never shows the pickup point');

-- Loaded and on the way: points before loading stay hidden
select tests.as_owner();
update public.jobs set status = 'in_progress', pickup_photo_taken_at = now() - interval '30 minutes'
 where id = current_setting('t.job')::uuid;
delete from public.job_route_points where job_id = current_setting('t.job')::uuid;
insert into public.job_route_points (job_id, driver_id, lat, lng, accuracy, recorded_at)
select current_setting('t.job')::uuid, current_setting('t.drv')::uuid, -17.70, 31.10, 10, now() - interval '40 minutes';
insert into public.job_route_points (job_id, driver_id, lat, lng, accuracy, recorded_at)
select current_setting('t.job')::uuid, current_setting('t.drv')::uuid,
       -17.75 - g * 0.0001, 31.08 - g * 0.0001, 10, now() - interval '29 minutes' + g * interval '1 second'
from generate_series(1, 450) g;
select tests.as_anon();
select ok(pg_temp.track() -> 'times' ->> 'loaded_at' is not null, 'Loaded time is shown');
select ok(jsonb_array_length(pg_temp.track() -> 'trail') between 100 and 200,
  'The trail is thinned to at most 200 points');
select is(pg_temp.track() -> 'trail' -> 0, '[-17.7501, 31.0799]'::jsonb,
  'The trail starts at the first point after loading (rounded to 4 decimals)');
select is(pg_temp.track() -> 'trail' -> -1, '[-17.795, 31.035]'::jsonb,
  'The trail always ends at the latest point');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.track() -> 'trail') e where e = '[-17.7, 31.1]'::jsonb),
  'Points from before loading are not shown');

-- Old position: no direction
select tests.as_owner();
update public.driver_locations set updated_at = now() - interval '20 minutes', heading = 90
 where job_id = current_setting('t.job')::uuid;
select tests.as_anon();
select is(pg_temp.track() -> 'live' ->> 'heading', '90', 'Direction is shown with the position it came with');

-- Arrived, then delivered
select tests.as_owner();
update public.jobs set driver_arrived_dropoff_at = now() - interval '5 minutes' where id = current_setting('t.job')::uuid;
select tests.as_anon();
select ok(pg_temp.track() -> 'times' ->> 'arrived_at' is not null, 'Arrival time is shown');
select tests.as_owner();
update public.jobs set status = 'completed', completed_at = now() where id = current_setting('t.job')::uuid;
select tests.as_anon();
select ok(pg_temp.track() -> 'times' ->> 'delivered_at' is not null, 'Delivered time is shown');
select is(pg_temp.track() -> 'trail', 'null'::jsonb, 'No trail after delivery');
select is(pg_temp.track() -> 'live', 'null'::jsonb, 'No location after delivery');

-- Cancelled: status only
select tests.as_owner();
update public.jobs set status = 'cancelled' where id = current_setting('t.job')::uuid;
select tests.as_anon();
select is(pg_temp.track(), '{"status": "cancelled"}'::jsonb, 'A cancelled link says cancelled and nothing else');
select ok(public.get_public_tracking(gen_random_uuid()) is null, 'A guessed token still returns nothing');

select * from finish();
rollback;
