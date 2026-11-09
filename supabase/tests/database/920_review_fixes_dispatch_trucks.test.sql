-- 0156: revived dispatch offer gets a fresh expiry; a final response is refused; the customer reads only the accepted
-- offer's truck; declared truck facts cannot carry a phone number.
begin;
select plan(7);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust', tests.create_user('rf_cust')::text, true);
select set_config('t.d',    tests.create_driver('rf_d', 200, true)::text, true);
select tests.as_owner();
insert into public.trucks (driver_id, registration, capacity_m3) values (current_setting('t.d')::uuid, 'ZZZ 9999', 30);
insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at)
values (current_setting('t.d')::uuid, -18.25, 31.55, true, now())
on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, is_available = true, updated_at = now();
insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, delivery_lat, delivery_lng, pickup_lat, pickup_lng)
values (current_setting('t.cust')::uuid, 'custom', 12, 'Marondera', 100, -18.18, 31.55, -18.18, 31.55);
select set_config('t.job', (select id::text from public.jobs where customer_id = current_setting('t.cust')::uuid order by created_at desc limit 1), true);
delete from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid;
-- the driver already has an old, withdrawn, expired offer
insert into public.bids (job_id, driver_id, price, truck_id, status)
values (current_setting('t.job')::uuid, current_setting('t.d')::uuid, 100, tests.truck_of(current_setting('t.d')::uuid), 'withdrawn');
update public.bids set expires_at = now() - interval '1 hour' where job_id = current_setting('t.job')::uuid;
insert into public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
values (current_setting('t.job')::uuid, current_setting('t.d')::uuid, 1, now() + interval '5 minutes');
select set_config('t.off', (select id::text from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid), true);

select tests.login_as(current_setting('t.d')::uuid);
select lives_ok(format($$select public.accept_dispatch_offer(%L)$$, current_setting('t.off')), 'the driver answers the request');
select tests.as_owner();
select is((select status::text from public.bids where job_id = current_setting('t.job')::uuid), 'pending', 'the old offer is live again');
select ok((select expires_at > now() + interval '25 minutes' from public.bids where job_id = current_setting('t.job')::uuid), 'with a fresh 30-minute expiry');

-- a final (rejected) response is refused, not silently ignored
update public.bids set status = 'rejected' where job_id = current_setting('t.job')::uuid;
update public.job_dispatch_offers set status = 'pending', responded_at = null, expires_at = now() + interval '5 minutes' where id = current_setting('t.off')::uuid;
select tests.login_as(current_setting('t.d')::uuid);
select throws_ok(format($$select public.accept_dispatch_offer(%L)$$, current_setting('t.off')), null, 'You already have a response on this job.', 'a rejected response cannot be revived');

-- trucks: customer reads only the accepted offer's truck
select tests.as_owner();
update public.bids set status = 'pending' where job_id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid((select id from public.bids where job_id = current_setting('t.job')::uuid));
select is((select count(*)::int from public.trucks where driver_id = current_setting('t.d')::uuid), 1, 'the customer reads only the truck on the accepted offer, not every truck the driver has');

-- declared facts: no phone numbers
select tests.as_owner();
select throws_ok(format($$update public.trucks set make = 'call 0771234567' where driver_id = %L$$, current_setting('t.d')), '23514', null, 'a phone number in the make is refused');
select lives_ok(format($$update public.trucks set make = 'Isuzu', model = 'FVZ 1400', colour = 'white' where driver_id = %L$$, current_setting('t.d')), 'ordinary make, model and colour are fine');

select * from finish();
rollback;
