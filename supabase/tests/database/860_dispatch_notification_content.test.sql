-- 0151: the dispatch offer notification tells a driver what they need to decide (load, area, distance, budget)
-- without exposing the street address, coordinates or any contact detail, and never invents a value.
begin;
select plan(9);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('dn_cust')::text, true);
select set_config('t.drv',  tests.create_driver('dn_drv', 100)::text, true);
select tests.as_owner();

insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at)
values (current_setting('t.drv')::uuid, -18.25, 31.55, true, now())
on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, is_available = true, updated_at = now();

insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, delivery_lat, delivery_lng, pickup_lat, pickup_lng)
values (current_setting('t.cust')::uuid, 'river_sand', 12, '12 Secret Street, Marondera', 200, -18.18, 31.55, -18.18, 31.55);
select set_config('t.job', (select id::text from public.jobs where delivery_address like '12 Secret%'), true);
delete from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid;
delete from public.notifications where job_id = current_setting('t.job')::uuid;

select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 1, 'the nearby driver is offered the job');
select tests.as_owner();

create or replace function pg_temp.n() returns public.notifications language sql as $$
  select n from public.notifications n where n.job_id = current_setting('t.job')::uuid and n.type = 'dispatch_offer' $$;

select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid and type = 'dispatch_offer'), 1, 'one dispatch_offer notification');
select ok((pg_temp.n()).body like '%12 m³%', 'it states the load');
select ok((pg_temp.n()).body like '%River sand%', 'it names the material');
select ok((pg_temp.n()).body like '%Marondera%', 'it names the area');
select ok((pg_temp.n()).body like '%$200%', 'it states the budget the customer entered');
select ok((pg_temp.n()).body ~ 'about \d+ km', 'it gives a straight-line distance from the driver, in kilometres');
select ok(((pg_temp.n()).title || ' ' || (pg_temp.n()).body) not like '%Secret Street%', 'it never contains the street address');
select ok((pg_temp.n()).body !~ '-18\.\d|31\.\d|\+?263|@', 'it contains no coordinates or contact details');

select * from finish();
rollback;
