-- 0154: a dispatch "yes" is an offer. The customer then chooses with accept_bid, which assigns the driver
-- and reserves commission exactly once. Before that, no job state and no money changes.
begin;
select plan(11);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust', tests.create_user('da_cust')::text, true);
select set_config('t.d',    tests.create_driver('da_d', 200, false)::text, true);

select tests.as_owner();
insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at)
values (current_setting('t.d')::uuid, -18.25, 31.55, true, now())
on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, is_available = true, updated_at = now();
insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget,
                         delivery_lat, delivery_lng, pickup_lat, pickup_lng)
values (current_setting('t.cust')::uuid, 'custom', 12, 'Marondera', 100, -18.18, 31.55, -18.18, 31.55);
select set_config('t.job', (select id::text from public.jobs where customer_id = current_setting('t.cust')::uuid order by created_at desc limit 1), true);
delete from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid;
insert into public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
values (current_setting('t.job')::uuid, current_setting('t.d')::uuid, 1, now() + interval '5 minutes');
select set_config('t.off', (select id::text from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid), true);

create or replace function pg_temp.money() returns text language sql as $$
  select coalesce((select string_agg(user_id::text || ':' || balance::text || ':' || coalesce(held, 0)::text, ',' order by user_id) from public.wallets), '')
         || '|' || (select count(*) from public.wallet_transactions)::text
$$;
select set_config('t.money', pg_temp.money(), true);

select tests.login_as(current_setting('t.d')::uuid);
select lives_ok(format($$select public.accept_dispatch_offer(%L)$$, current_setting('t.off')), 'the driver answers the request');
select tests.as_owner();
select is((select status from public.jobs where id = current_setting('t.job')::uuid), 'open', 'the job is still open');
select is((select driver_id from public.jobs where id = current_setting('t.job')::uuid), null, 'no driver is assigned');
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), null, 'no commission is reserved');
select is(pg_temp.money(), current_setting('t.money'), 'no wallet or ledger row changed');
select is((select price from public.bids where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.d')::uuid), 100::numeric, 'the customer sees an offer at their own price');
select ok((select truck_id is not null from public.bids where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.d')::uuid), 'with the driver''s truck');

-- the customer chooses: now it is assigned and the reserve is taken once
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, (select id from public.bids where job_id = current_setting('t.job')::uuid)), 'the customer chooses the driver');
select tests.as_owner();
select is((select driver_id from public.jobs where id = current_setting('t.job')::uuid), current_setting('t.d')::uuid, 'now the driver is assigned');

-- answering twice does not duplicate the offer
select tests.login_as(current_setting('t.d')::uuid);
select throws_ok(format($$select public.accept_dispatch_offer(%L)$$, current_setting('t.off')), null, 'Offer no longer available', 'the same request cannot be answered twice');
select tests.as_owner();
select is((select count(*)::int from public.bids where job_id = current_setting('t.job')::uuid), 1, 'still exactly one offer');

select * from finish();
rollback;
