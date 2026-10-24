-- 0110 — recording a photo must not move the job's own pickup point or delivery
-- address. The live function copied the photo's GPS over jobs.pickup_lat/lng and
-- delivery_lat/lng, so the admin's "metres from the delivery address" always came out
-- near 0 and the supplier's pickup point was lost. The photo's GPS stays on the
-- evidence row; the job keeps the points the customer and the quote set.
-- Exception: a job with no pickup point ("driver arranges pickup") takes it from the
-- pickup photo, so the place the load came from is still recorded.
begin;
select plan(7);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('loc_cust')::text, true);
select set_config('t.drv',  tests.create_driver('loc_drv', 100)::text, true);

-- Job 1: a supplier pickup point and a pinned delivery address.
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set pickup_lat = -17.70, pickup_lng = 31.00, delivery_lat = -17.80, delivery_lng = 31.05
 where id = current_setting('t.job')::uuid;
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 380)::text, true);

-- Job 2: no pickup point (the driver arranges the pickup).
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set delivery_lat = -17.80, delivery_lng = 31.05 where id = current_setting('t.job2')::uuid;
select set_config('t.bid2', tests.create_bid(current_setting('t.job2')::uuid, current_setting('t.drv')::uuid, 380)::text, true);

select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_owner();
insert into storage.objects (bucket_id, name) values
  ('job-proof-photos', current_setting('t.job') || '/pickup-1.jpg'),
  ('job-proof-photos', current_setting('t.job') || '/delivery-1.jpg');

-- Photos taken about 6 km from the supplier and about 1.1 km from the delivery pin.
select tests.login_as(current_setting('t.drv')::uuid);
select public.record_job_evidence(current_setting('t.job')::uuid, 'pickup', current_setting('t.job') || '/pickup-1.jpg',
  null, 'image/jpeg', -17.75, 31.02, 10, 'captured');
select public.start_trip(current_setting('t.job')::uuid);
select public.record_job_evidence(current_setting('t.job')::uuid, 'delivery', current_setting('t.job') || '/delivery-1.jpg',
  null, 'image/jpeg', -17.81, 31.05, 10, 'captured');

select tests.as_owner();
select is((select round(pickup_lat::numeric, 2) || ',' || round(pickup_lng::numeric, 2) from public.jobs where id = current_setting('t.job')::uuid),
  '-17.70,31.00', '1: the supplier pickup point is not replaced by the photo''s GPS');
select is((select round(delivery_lat::numeric, 2) || ',' || round(delivery_lng::numeric, 2) from public.jobs where id = current_setting('t.job')::uuid),
  '-17.80,31.05', '2: the delivery address is not replaced by the photo''s GPS');
select is((select round(device_lat::numeric, 2) || ',' || round(device_lng::numeric, 2) from public.job_evidence
            where job_id = current_setting('t.job')::uuid and kind = 'delivery'),
  '-17.81,31.05', '3: the photo''s own GPS is kept on the evidence row');

select tests.login_as(current_setting('t.cust')::uuid);
select ok(public.evidence_distance_m(current_setting('t.job')::uuid, 'delivery') between 1000 and 1250,
  '4: the admin''s "metres from the delivery address" is now the real distance (about 1.1 km), not 0');
select is((select pickup_photo_url from public.jobs where id = current_setting('t.job')::uuid),
  current_setting('t.job') || '/pickup-1.jpg', '5: the photo itself is still linked to the job');

-- Job 2: the pickup point comes from the pickup photo.
select public.accept_bid(current_setting('t.bid2')::uuid);
select tests.as_owner();
insert into storage.objects (bucket_id, name) values ('job-proof-photos', current_setting('t.job2') || '/pickup-1.jpg');
select tests.login_as(current_setting('t.drv')::uuid);
select public.record_job_evidence(current_setting('t.job2')::uuid, 'pickup', current_setting('t.job2') || '/pickup-1.jpg',
  null, 'image/jpeg', -17.66, 30.95, 10, 'captured');
select tests.as_owner();
select is((select round(pickup_lat::numeric, 2) || ',' || round(pickup_lng::numeric, 2) from public.jobs where id = current_setting('t.job2')::uuid),
  '-17.66,30.95', '6: a job with no pickup point records where the driver loaded');
select is((select round(delivery_lat::numeric, 2) || ',' || round(delivery_lng::numeric, 2) from public.jobs where id = current_setting('t.job2')::uuid),
  '-17.80,31.05', '7: and its delivery address is untouched');

select * from finish();
rollback;
