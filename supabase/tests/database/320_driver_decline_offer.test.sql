-- 0102 — a driver can decline a dispatch offer; the decision is recorded server-side and the next
-- progressive wave goes out immediately instead of waiting for the offer to time out.
-- Job site Marondera (-18.18, 31.55). near ~8 km, mid ~40 km. Stages 25/50/100 km after 0/3/6 min.

begin;
select plan(14);

select set_config('t.cust', tests.create_user('dc_cust')::text, true);
select set_config('t.near', tests.create_driver('dc_near', 100)::text, true);
select set_config('t.mid',  tests.create_driver('dc_mid', 100)::text, true);
select set_config('t.other', tests.create_driver('dc_other', 100)::text, true);

select tests.as_owner();
create function pg_temp.place(_drv text, _lat numeric, _lng numeric) returns void language sql as $$
  insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at)
  values (current_setting('t.' || _drv)::uuid, _lat, _lng, true, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, is_available = true, updated_at = now();
$$;
create function pg_temp.new_job(_age interval) returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, delivery_lat, delivery_lng, pickup_lat, pickup_lng)
  values (current_setting('t.cust')::uuid, 'custom', 12, 'Marondera', 400, -18.18, 31.55, -18.18, 31.55)
  returning id into _id;
  delete from public.job_dispatch_offers where job_id = _id;
  delete from public.notifications where job_id = _id;
  update public.jobs set created_at = now() - _age where id = _id;
  return _id;
end $$;
select pg_temp.place('near', -18.25, 31.55);
select pg_temp.place('mid', -18.54, 31.55);
select pg_temp.place('other', -18.25, 31.56);

-- job is 4 minutes old (stage 2, 50 km); the first wave went to the near driver only
select set_config('t.job', pg_temp.new_job(interval '4 minutes')::text, true);
insert into public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
values (current_setting('t.job')::uuid, current_setting('t.near')::uuid, 1, now() + interval '5 minutes');
select set_config('t.off', (select id::text from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid), true);

select ok(has_function_privilege('authenticated', 'public.decline_dispatch_offer(uuid)', 'execute'), '1: signed-in drivers can call decline_dispatch_offer');
select ok(not has_function_privilege('anon', 'public.decline_dispatch_offer(uuid)', 'execute'), '2: anonymous cannot');

-- another driver cannot decline someone else's offer
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format('select public.decline_dispatch_offer(%L)', current_setting('t.off')), '42501', null, '3: a different driver cannot decline my offer');
select tests.as_owner();
select is((select status::text from public.job_dispatch_offers where id = current_setting('t.off')::uuid), 'pending', '4: the offer is untouched by the refused attempt');

-- a customer cannot either
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format('select public.decline_dispatch_offer(%L)', current_setting('t.off')), '42501', null, '5: the customer cannot decline a driver''s offer');
select tests.as_owner();

-- the near driver declines: recorded, and the next wave is offered immediately (stage 2 reaches other + mid)
select tests.login_as(current_setting('t.near')::uuid);
select is(public.decline_dispatch_offer(current_setting('t.off')::uuid), true, '6: decline returns true');
select tests.as_owner();
select is((select status::text from public.job_dispatch_offers where id = current_setting('t.off')::uuid), 'rejected', '7: the offer is recorded as rejected');
select ok((select responded_at is not null from public.job_dispatch_offers where id = current_setting('t.off')::uuid), '8: response time is stamped');
select is((select count(*)::int from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid and wave = 2), 2,
  '9: the next wave (2 drivers: other + mid) went out immediately, without waiting for a timeout');
select is((select count(*)::int from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.near')::uuid), 1,
  '10: the decliner is never offered the same job again');

-- idempotent
select tests.login_as(current_setting('t.near')::uuid);
select is(public.decline_dispatch_offer(current_setting('t.off')::uuid), false, '11: declining again is a harmless no-op');
select tests.as_owner();
select is((select count(*)::int from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid), 3, '12: the repeat decline created no extra offers');

-- a decline after the job was taken does nothing
select tests.login_as(current_setting('t.other')::uuid);
select is(public.accept_dispatch_offer((select id from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.other')::uuid)), current_setting('t.job')::uuid, '13: another driver accepts the job');
select tests.login_as(current_setting('t.mid')::uuid);
select is(public.decline_dispatch_offer((select id from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.mid')::uuid)), false, '14: declining an offer for a job that is no longer open is a no-op');
select tests.as_owner();

select * from finish();
rollback;
