-- 0110 — delivery evidence follows the stages, and only the driver can file it.
--
-- Full-stack version (real RLS, triggers and storage schema) of
-- scripts/dev/fn-tests/record_job_evidence.sql. Run on the local Supabase stack
-- (node scripts/db-test.mjs test).
begin;
select plan(15);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('ev_cust')::text, true);
select set_config('t.adm',  tests.create_user('ev_adm', array['admin'])::text, true);
select set_config('t.drv',  tests.create_driver('ev_drv', 100)::text, true);
select set_config('t.job',  tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid',  tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 380)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);

select tests.as_owner();
insert into storage.objects (bucket_id, name) values
  ('job-proof-photos', current_setting('t.job') || '/pickup-1.jpg'),
  ('job-proof-photos', current_setting('t.job') || '/delivery-1.jpg');

-- Nobody but the driver can file stage photos, and never ahead of the stage.
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'delivery', %L)$$, current_setting('t.job'), current_setting('t.job') || '/fake.jpg'),
  '42501', null, '1: the customer cannot file a delivery photo');
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'delivery', %L)$$, current_setting('t.job'), current_setting('t.job') || '/delivery-1.jpg'),
  '42501', null, '2: an admin cannot file a delivery photo');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'delivery', %L)$$, current_setting('t.job'), current_setting('t.job') || '/delivery-1.jpg'),
  null, 'Confirm pickup and start the trip before taking the delivery photo.', '3: the driver cannot skip pickup');
select throws_ok(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job'), current_setting('t.job') || '/missing.jpg'),
  null, 'The photo was not uploaded. Take or choose it again.', '4: a photo that was never uploaded is refused');
select throws_ok(format($$select public.start_trip(%L)$$, current_setting('t.job')),
  null, null, '5: the trip cannot start without the pickup photo');

-- More people who must not file stage photos, and a file in the wrong bucket.
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job'), current_setting('t.job') || '/pickup-1.jpg'),
  '42501', null, '5a: the customer cannot file the pickup photo either, even a real uploaded one');
select tests.as_owner();
select set_config('t.stranger', tests.create_user('ev_stranger')::text, true);
select tests.login_as(current_setting('t.stranger')::uuid);
select throws_like(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job'), current_setting('t.job') || '/pickup-1.jpg'),
  '%Not part of this job%', '5b: someone who is not part of the job cannot file anything');
select tests.as_owner();
insert into storage.buckets (id, name, public) values ('ev-other-bucket', 'ev-other-bucket', true) on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('ev-other-bucket', current_setting('t.job') || '/pickup-other.jpg');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job'), current_setting('t.job') || '/pickup-other.jpg'),
  null, 'The photo was not uploaded. Take or choose it again.', '5c: a file in any other bucket does not count, only the private job-proof-photos bucket');

-- The real sequence works.
select lives_ok(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job'), current_setting('t.job') || '/pickup-1.jpg'),
  '6: the driver files the uploaded pickup photo');
-- The state a failed "start trip" leaves behind: pickup photo in, trip not started.
-- The delivery photo is refused; the app's "Start trip" retry is the way forward.
select throws_ok(format($$select public.record_job_evidence(%L, 'delivery', %L)$$, current_setting('t.job'), current_setting('t.job') || '/delivery-1.jpg'),
  null, 'Confirm pickup and start the trip before taking the delivery photo.', '6a: after the pickup photo but before the trip starts, the delivery photo is refused');
select lives_ok(format($$select public.start_trip(%L)$$, current_setting('t.job')), '7: the trip starts after the pickup photo (also on a retry)');
select lives_ok(format($$select public.record_job_evidence(%L, 'delivery', %L)$$, current_setting('t.job'), current_setting('t.job') || '/delivery-1.jpg'),
  '8: the driver files the delivery photo once the trip has started');

select tests.as_owner();
select is((select pickup_photo_url || '|' || delivery_photo_url from public.jobs where id = current_setting('t.job')::uuid),
  current_setting('t.job') || '/pickup-1.jpg|' || current_setting('t.job') || '/delivery-1.jpg',
  '9: the job points at the driver''s real photos');
select is(public.job_has_delivery_evidence(current_setting('t.job')::uuid), true,
  '10: completion sees valid delivery evidence');
select is((select count(*)::int from public.job_evidence where job_id = current_setting('t.job')::uuid and uploaded_by <> current_setting('t.drv')::uuid),
  0, '11: no evidence row was created by anyone else');

select * from finish();
rollback;
