-- Backhaul (find_next_loads_for_driver, 0056/0057/0079): regression coverage for existing behaviour.
-- A driver on an active job sees nearby OPEN jobs near the delivery point as suggestions; it never
-- touches the active assignment, never lists the current/assigned/far jobs, and respects authorisation.

begin;
select plan(12);

select set_config('t.cust',  tests.create_user('bh_cust')::text, true);
select set_config('t.drv',   tests.create_driver('bh_drv', 100, true)::text, true);
select set_config('t.other', tests.create_driver('bh_other', 100, true)::text, true);
select set_config('t.unver', tests.create_driver('bh_unver', 100, true)::text, true);
select tests.as_owner();
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.unver')::uuid;

do $$
declare _cur uuid; _near uuid; _far uuid; _taken uuid;
begin
  -- active job: pickup Harare, delivery Marondera (-18.18, 31.55) = the driver's anchor
  insert into public.jobs (customer_id, driver_id, material, quantity_m3, delivery_address, budget, status,
                           pickup_lat, pickup_lng, delivery_lat, delivery_lng)
  values (current_setting('t.cust')::uuid, current_setting('t.drv')::uuid, 'custom', 10, 'Marondera', 300, 'in_progress',
          -17.83, 31.05, -18.18, 31.55) returning id into _cur;
  -- open job whose pickup is ~25 km from the anchor (Wedza direction)
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, status,
                           pickup_lat, pickup_lng, delivery_lat, delivery_lng)
  values (current_setting('t.cust')::uuid, 'custom', 8, 'Harare', 250, 'open', -18.20, 31.78, -17.83, 31.05) returning id into _near;
  -- open job ~350 km away (Bulawayo): beyond the 150 km window
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, status,
                           pickup_lat, pickup_lng, delivery_lat, delivery_lng)
  values (current_setting('t.cust')::uuid, 'custom', 8, 'Gweru', 250, 'open', -20.15, 28.58, -19.45, 29.82) returning id into _far;
  -- near but already assigned to someone else
  insert into public.jobs (customer_id, driver_id, material, quantity_m3, delivery_address, budget, status,
                           pickup_lat, pickup_lng, delivery_lat, delivery_lng)
  values (current_setting('t.cust')::uuid, current_setting('t.other')::uuid, 'custom', 8, 'Harare', 250, 'accepted', -18.20, 31.60, -17.83, 31.05) returning id into _taken;
  perform set_config('t.cur', _cur::text, true);
  perform set_config('t.near_job', _near::text, true);
  perform set_config('t.far_job', _far::text, true);
  perform set_config('t.taken_job', _taken::text, true);
end $$;

-- the assigned driver sees the nearby open job only
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.drv')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.near_job')::uuid), 1, '1: a nearby open job is suggested');
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.drv')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.far_job')::uuid), 0, '2: a job ~350 km away is not suggested');
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.drv')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.taken_job')::uuid), 0, '3: a job already assigned to another driver is not suggested');
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.drv')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.cur')::uuid), 0, '4: the current job is never suggested to itself');
select ok((select repositioning_km from public.find_next_loads_for_driver(current_setting('t.drv')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.near_job')::uuid) between 15 and 40, '5: repositioning distance is a real computed figure (not invented)');

-- a lookup never changes anything
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.cur')::uuid), 'in_progress', '6: the active assignment is untouched');
select is((select status::text from public.jobs where id = current_setting('t.near_job')::uuid), 'open', '7: the suggested job stays open');
select is((select count(*)::int from public.job_dispatch_offers where job_id = current_setting('t.near_job')::uuid and driver_id = current_setting('t.drv')::uuid), 0,
  '8: suggesting a job creates no offer and no claim');

-- authorisation and eligibility
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format('select * from public.find_next_loads_for_driver(%L, %L)', current_setting('t.drv'), current_setting('t.cur')), '42501', null, '9: another driver cannot read my suggestions');
select tests.login_as(current_setting('t.unver')::uuid);
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.unver')::uuid, current_setting('t.cur')::uuid)), 0, '10: an unverified driver gets no suggestions');
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.drv')::uuid, gen_random_uuid())), 0, '11: without a current active job there is no anchor, so no suggestions');
select tests.as_owner();
select ok(not has_function_privilege('anon', 'public.find_next_loads_for_driver(uuid,uuid)', 'execute'), '12: anonymous cannot call it');

select * from finish();
rollback;
