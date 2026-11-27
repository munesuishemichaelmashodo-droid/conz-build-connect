-- 0183: two booking journeys on the transport-only pricing path. Server-side validation, no hidden data left
-- by switching journeys, privacy for drivers who were not selected, who may change what, commission unchanged.
begin;
select plan(28);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
update public.system_settings set value = '1.87'::jsonb where key = 'diesel_price_per_liter';
update public.system_settings set value = 'true'::jsonb where key = 'transport_pricing_enabled';

select set_config('t.cust',  tests.create_user('bj_cust')::text, true);
select set_config('t.d',     tests.create_driver('bj_drv', 200, true)::text, true);
select set_config('t.other', tests.create_driver('bj_other', 200, true)::text, true);

create or replace function pg_temp.quote() returns uuid language sql as $$
  select public.create_transport_quote_for(current_setting('t.cust')::uuid, 12, -17.80123, 31.05456, -17.93, 31.10, 24.0) $$;
create or replace function pg_temp.mkjob(_kind text, _name text default null, _contact text default null, _ref text default null,
                                        _truck text default null, _basis text default 'transport_only') returns uuid language plpgsql as $$
declare _id uuid; _q uuid;
begin
  perform tests.as_service();
  _q := case when _basis = 'transport_only' then pg_temp.quote() end;
  perform tests.login_as(current_setting('t.cust')::uuid);
  insert into public.jobs (customer_id, material, custom_material, quantity_m3, delivery_address, pickup_address, budget,
                           delivery_lat, delivery_lng, pickup_lat, pickup_lng, pricing_basis, transport_quote_id,
                           job_kind, collection_name, collection_contact, collection_reference, truck_requirement,
                           preferred_time, load_details)
  values (current_setting('t.cust')::uuid, 'custom', '2,000 bricks', 12, '12 Acacia Rd, Borrowdale, Harare',
          '45 Kenmure Rd, Highlands, Harare', 40, -17.93, 31.10, -17.80123, 31.05456, _basis, _q,
          _kind, _name, _contact, _ref, _truck, 'morning', 'About 6 tonnes; call 0771234567 at the gate')
  returning id into _id;
  return _id;
end $$;

-- ================================================================ A. transport only
select lives_ok($$select pg_temp.mkjob('transport_only', null, null, null, 'flatbed')$$, '1: transport only books with truck type and load details');
select set_config('t.ja', (select id::text from public.jobs where job_kind = 'transport_only' limit 1), true);
select tests.as_owner();
select is((select row(job_kind, truck_requirement, preferred_time, custom_material)::text from public.jobs where id = current_setting('t.ja')::uuid),
          '(transport_only,flatbed,morning,"2,000 bricks")', '2: what the customer entered is saved');
select throws_ok($$select pg_temp.mkjob('transport_only', 'Halsted Builders')$$, '22023', null,
                 '3: a transport-only booking cannot carry shop collection details');

-- ================================================================ B. collect and deliver
select throws_ok($$select pg_temp.mkjob('collect_and_deliver')$$, '22023', null, '4: a customer-arranged collection needs the shop or place name');
select lives_ok($$select pg_temp.mkjob('collect_and_deliver', '  Halsted Builders Express  ', 'Store manager, 0772000111', 'INV-4471', 'tipper')$$,
                '5: a customer-arranged collection books with shop name, contact and order reference');
select set_config('t.jb', (select id::text from public.jobs where job_kind = 'collect_and_deliver' limit 1), true);
select tests.as_owner();
select is((select collection_name from public.jobs where id = current_setting('t.jb')::uuid), 'Halsted Builders Express',
          '6: names are trimmed');

-- ================================================================ C. server-side validation
select throws_ok($$select pg_temp.mkjob('transport_only', null, null, null, null, 'legacy_material_plus_transport')$$, null, null,
                 '7: a booking type cannot use the legacy material pricing');
select throws_ok($$select pg_temp.mkjob('collect_and_deliver', 'Shop', null, null, 'crane')$$, '23514', null, '8: unknown truck type refused');
select throws_ok(format($$select pg_temp.mkjob('collect_and_deliver', 'Shop', null, %L)$$, E'INV\n1'), '23514', null,
                 '9: control characters refused');
select throws_ok($$select pg_temp.mkjob('lorry')$$, '23514', null, '10: unknown booking type refused');

-- ================================================================ D. drivers who were not selected
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.jb')::uuid), 0, '11: an unselected driver cannot read the job row');
select is((select collection_contact from public.driver_open_job(current_setting('t.jb')::uuid)), null, '12: nor the collection contact');
select is((select collection_reference from public.driver_open_job(current_setting('t.jb')::uuid)), null, '13: nor the order reference');
select is((select pickup_lat from public.driver_open_job(current_setting('t.jb')::uuid)), -17.80::double precision,
          '14: the collection point is shown to about 1 km only');
select ok((select pickup_address not like '%45 Kenmure%' from public.driver_open_job(current_setting('t.jb')::uuid)),
          '15: and as an area, not the street address');
select ok((select load_details not like '%0771234567%' from public.driver_open_job(current_setting('t.jb')::uuid)),
          '16: phone numbers are removed from load details');
select is((select row(job_kind, truck_requirement, collection_name)::text from public.driver_open_job(current_setting('t.jb')::uuid)),
          '(collect_and_deliver,tipper,"Halsted Builders Express")', '17: the driver can see the booking type, truck needed and collection place name to decide');

-- free text typed by the customer is contact-redacted too
select lives_ok($$select pg_temp.mkjob('collect_and_deliver', 'Joe Hardware 0779998888')$$, '17a: a shop name with a phone number books');
select tests.login_as(current_setting('t.other')::uuid);
select ok((select bool_and(collection_name not like '%0779998888%' and custom_material is not null)
             from public.driver_open_jobs(50, 0) where job_kind = 'collect_and_deliver'),
          '17b: unselected drivers never see a phone number in the shop name');

-- next-loads suggestions (find_next_loads_for_driver) show a customer's collection point as an area only
select tests.as_owner();
select set_config('t.cur', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct')::text, true);
update public.jobs set status = 'completed', driver_id = current_setting('t.other')::uuid, completed_at = now(),
       delivery_lat = -17.8050, delivery_lng = 31.0500, pickup_lat = -17.95, pickup_lng = 31.20
 where id = current_setting('t.cur')::uuid;
select tests.login_as(current_setting('t.other')::uuid);
select is((select pickup_lat from public.find_next_loads_for_driver(current_setting('t.other')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.jb')::uuid), -17.80::double precision,
          '17c: a next-load suggestion shows the collection point to about 1 km');
select ok((select pickup_address not like '%45 Kenmure%' from public.find_next_loads_for_driver(current_setting('t.other')::uuid, current_setting('t.cur')::uuid)
            where job_id = current_setting('t.jb')::uuid), '17d: and as an area, not the street address');

-- ================================================================ E. who may change what
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$update public.jobs set collection_contact = 'Yard foreman, 0773000222' where id = %L$$, current_setting('t.jb')),
                '18: the customer corrects the collection contact while the job is open');
select throws_ok(format($$update public.jobs set job_kind = 'transport_only' where id = %L$$, current_setting('t.jb')), '42501', null,
                 '19: the booking type cannot change after posting');

-- assign the job through the normal offer flow
select tests.as_owner();
select set_config('t.bid', tests.create_bid(current_setting('t.jb')::uuid, current_setting('t.d')::uuid, 40)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.jb')::uuid), 2.80::numeric,
          '20: commission is unchanged: 7% of the $40 transport fare');

select tests.login_as(current_setting('t.d')::uuid);
select is((select row(collection_contact, collection_reference, pickup_address)::text from public.jobs where id = current_setting('t.jb')::uuid),
          '("Yard foreman, 0773000222",INV-4471,"45 Kenmure Rd, Highlands, Harare")', '21: the selected driver sees the full collection details');
select throws_ok(format($$update public.jobs set collection_reference = 'X' where id = %L$$, current_setting('t.jb')), '42501', null,
                 '22: the driver cannot change collection details');

select tests.as_owner();
update public.jobs set status = 'in_progress' where id = current_setting('t.jb')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$update public.jobs set collection_contact = 'someone else' where id = %L$$, current_setting('t.jb')), '42501', null,
                 '23: nor can the customer once the load is on the way');

-- ================================================================ F. legacy jobs untouched
select tests.as_owner();
select is((select count(*)::int from public.jobs where job_kind is null and customer_id = current_setting('t.cust')::uuid
              and pricing_basis is distinct from 'transport_only' and status = 'completed'), 1,
          '24: a legacy job (no booking type) is created and completed as before');

select * from finish();
rollback;
