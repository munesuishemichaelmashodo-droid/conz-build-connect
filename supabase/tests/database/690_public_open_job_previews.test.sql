-- 0137: signed-out visitors see a safe, area-only preview of real open requests, and nothing else.
begin;
select plan(8);

select set_config('t.cust', tests.create_user('pp_cust')::text, true);
select set_config('t.drv', tests.create_driver('pp_drv', 100)::text, true);

select set_config('t.open', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct', 'custom', 12)::text, true);
select set_config('t.cancelled', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct', 'custom', 8)::text, true);
update public.jobs set delivery_address = 'Plot 12 Harward Road, Belvedere, Harare, Zimbabwe', delivery_lat = -17.8123, delivery_lng = 31.0456,
       notes = 'Call 0771234567', receiver_name = 'Mr Moyo' where id = current_setting('t.open')::uuid;
update public.jobs set status = 'cancelled' where id = current_setting('t.cancelled')::uuid;

select tests.as_anon();
select is((select count(*)::int from public.public_open_job_previews()), 1, 'a signed-out visitor sees the one real open request');
select is((select area from public.public_open_job_previews() limit 1), 'Belvedere, Harare', 'with the area only');
select is((select quantity_m3 from public.public_open_job_previews() limit 1), 12::numeric, 'and the material details a driver needs to judge it');
select is((select count(*)::int from jsonb_object_keys((select to_jsonb(p) from public.public_open_job_previews() p limit 1))
            where jsonb_object_keys ~* 'lat|lng|address|note|phone|receiver|token|customer|id$'), 0,
  'the preview exposes no coordinates, address, notes, contact, token or ids');
select is((select count(*)::int from public.jobs), 0, 'the jobs table itself stays closed to visitors');

select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.public_open_job_previews()), 1, 'signed-in drivers can call it too');

select tests.as_owner();
update public.jobs set expires_at = now() - interval '1 hour' where id = current_setting('t.open')::uuid;
select tests.as_anon();
select is((select count(*)::int from public.public_open_job_previews()), 0, 'expired requests are not shown');

select tests.as_owner();
select tests.create_job(current_setting('t.cust')::uuid, 200, 'direct', 'custom', 5) from generate_series(1, 25);
select tests.as_anon();
select is((select count(*)::int from public.public_open_job_previews(1000)), 20, 'the list is capped at 20, never a bulk export');

select * from finish();
rollback;
