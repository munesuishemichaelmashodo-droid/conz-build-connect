-- 0183 (revised 27/11): "Transport only" works whatever transport_pricing_enabled says. With pricing OFF a transport
-- request is posted with the customer's own offer (pricing_basis 'transport_request'): no material, no material
-- quote, no supply location, no Con Z price or guide range stored. The materials journey keeps its own rules.
-- Then a transport request end to end: driver offer -> accept (7% reserved) -> pickup -> delivery -> completion
-- (7% charged once), and a cancelled one (reserve released). Manipulated and contradictory rows are refused.
begin;
select plan(44);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
update public.system_settings set value = 'false'::jsonb where key = 'transport_pricing_enabled';

select set_config('t.cust',  tests.create_user('tr_cust')::text, true);
select set_config('t.cust2', tests.create_user('tr_cust2')::text, true);
select set_config('t.d',     tests.create_driver('tr_drv', 100, true)::text, true);
select set_config('t.other', tests.create_driver('tr_other', 100, true)::text, true);

-- The row the app sends for a transport request (customer.book.tsx: transportRequestJobFields + journeyJobFields).
create or replace function pg_temp.req(_over jsonb default '{}'::jsonb, _who text default 't.cust') returns uuid
language plpgsql as $$
declare _r jsonb; _id uuid := gen_random_uuid(); _cols text;
begin
  _r := jsonb_build_object(
    'id', _id, 'customer_id', current_setting(_who), 'material', 'custom', 'custom_material', 'Roof sheets and timber',
    'quantity_m3', 8, 'delivery_address', '12 Acacia Rd, Borrowdale, Harare', 'delivery_lat', -17.93, 'delivery_lng', 31.10,
    'pickup_address', '45 Kenmure Rd, Highlands, Harare', 'pickup_lat', -17.80123, 'pickup_lng', 31.05456,
    'pricing_basis', 'transport_request', 'job_kind', 'transport_only', 'truck_requirement', 'flatbed',
    'preferred_time', 'morning', 'load_details', 'About 3 tonnes, sheets 3.6 m long', 'budget', 150,
    'payment_method', 'direct') || _over;
  _id := (_r ->> 'id')::uuid;
  select string_agg(quote_ident(k), ', ') into _cols from jsonb_object_keys(_r) k;
  perform tests.login_as(current_setting(_who)::uuid);
  execute format('insert into public.jobs (%s) select %s from jsonb_populate_record(null::public.jobs, $1)', _cols, _cols) using _r;
  return _id;
end $$;

-- ================================================================ A. transport only with pricing OFF
select lives_ok($$select set_config('t.j', pg_temp.req()::text, true)$$, 'A1: transport only can be posted while transport pricing is off');
select tests.as_owner();
select is((select row(material, pricing_basis, job_kind, budget, quote_id, transport_quote_id, supply_location_id)::text
             from public.jobs where id = current_setting('t.j')::uuid),
          '(custom,transport_request,transport_only,150.00,,,)', 'A2: saved as a transport request: no material, quotes or supply location');
select ok((select pricing_breakdown is null and pricing_version is null from public.jobs where id = current_setting('t.j')::uuid),
          'A3: no Con Z price or guide range is stored');
select is((select custom_material from public.jobs where id = current_setting('t.j')::uuid), 'Roof sheets and timber',
          'A4: the customer''s own description is the load label');
select lives_ok($$select pg_temp.req(jsonb_build_object('job_kind', 'collect_and_deliver', 'collection_name', 'Halsted Builders',
                                     'collection_contact', 'Counter, 0772000111', 'collection_reference', 'INV-9'))$$,
                'A5: shop collection works as a request too');

-- ================================================================ B. manipulated or contradictory submissions
select throws_ok($$select pg_temp.req('{"material":"river_sand"}')$$, '22023', null, 'B1: a catalogue material on a transport-only job is refused');
select throws_ok($$select pg_temp.req('{"custom_material":" "}')$$, '22023', null, 'B2: a description of the load is required');
select throws_ok($$select pg_temp.req('{"budget":0}')$$, null, null, 'B3: a $0 offer is refused');
select throws_ok($$select pg_temp.req('{"budget":100001}')$$, null, null, 'B4: an offer over $100,000 is refused');
select throws_ok($$select pg_temp.req('{"pickup_lat":-26.2,"pickup_lng":28.04}')$$, '22023', null, 'B5: a collection point outside Zimbabwe is refused');
select throws_ok($$select pg_temp.req('{"pickup_lat":null}')$$, '22023', null, 'B6: a collection point is required');
select throws_ok($$select pg_temp.req('{"job_kind":null}')$$, '22023', null, 'B7: a transport request without a booking type is refused');
select throws_ok($$select pg_temp.req('{"pricing_basis":"legacy_material_plus_transport"}')$$, '22023', null,
                 'B8: a transport-only job cannot use the material pricing path');
select throws_ok($$select pg_temp.req('{"pricing_basis":"transport_only"}')$$, '22023', null,
                 'B9: claiming a Con Z transport price while pricing is off is refused');
select throws_ok($$select pg_temp.req('{"pricing_basis":"made_up"}')$$, null, null, 'B10: unknown pricing basis refused');
select throws_ok($$select pg_temp.req(jsonb_build_object('customer_id', current_setting('t.cust2')))$$, null, null,
                 'B11: a customer cannot post a job for someone else');
select tests.as_service();
select set_config('t.q', public.create_transport_quote_for(current_setting('t.cust')::uuid, 8, -17.80123, 31.05456, -17.93, 31.10, 20)::text, true);
select throws_ok(format($$select pg_temp.req(jsonb_build_object('transport_quote_id', %L))$$, current_setting('t.q')), '22023', null,
                 'B12: a transport request cannot carry a Con Z price quote');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$update public.jobs set pricing_basis = 'transport_only' where id = current_setting('t.j')::uuid$$, '42501', null,
                 'B13: the customer cannot change how the job is priced');
select throws_ok($$update public.jobs set job_kind = 'collect_and_deliver' where id = current_setting('t.j')::uuid$$, '42501', null,
                 'B14: the booking type cannot change after posting');
-- A retry after a lost reply re-sends the same id: no second job (the app then opens the first one).
select throws_ok(format($$select pg_temp.req(jsonb_build_object('id', %L))$$, current_setting('t.j')), '23505', null,
                 'B15: a retried submission cannot create a duplicate job');
select tests.as_owner();
select is((select count(*)::int from public.jobs where customer_id = current_setting('t.cust')::uuid), 2, 'B16: still exactly the two jobs posted');

-- ================================================================ C. materials journey unchanged, both switch states
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, pricing_basis)
                   values (auth.uid(), 'custom', 5, 'Somewhere', 100, 'transport_only')$$, '22023', null,
                 'C1: a materials order cannot be priced as transport-only');
select lives_ok($$select tests.create_job(auth.uid(), 300, 'direct')$$, 'C2: materials and transport still posts (pricing off)');
select tests.as_owner();
update public.system_settings set value = 'true'::jsonb where key = 'transport_pricing_enabled';
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select tests.create_job(auth.uid(), 300, 'direct')$$, 'C3: materials and transport still posts (pricing on)');
select lives_ok($$select pg_temp.req()$$, 'C4: a transport request is still allowed with pricing on (e.g. no road distance)');
select tests.as_owner();
update public.system_settings set value = 'false'::jsonb where key = 'transport_pricing_enabled';
select ok(not exists (select 1 from public.jobs where pricing_basis in ('transport_only', 'transport_request') and job_kind is null),
          'C5: no transport-priced job exists without a booking type');

-- ================================================================ D. drivers
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.j')::uuid), 0, 'D1: a driver cannot read the job row before selection');
select is((select row(job_kind, truck_requirement, custom_material, budget)::text from public.driver_open_job(current_setting('t.j')::uuid)),
          '(transport_only,flatbed,"Roof sheets and timber",150.00)', 'D2: the driver sees what is moved, the truck needed and the offer');
select is((select pickup_lat from public.driver_open_job(current_setting('t.j')::uuid)), -17.80::double precision,
          'D3: the collection point is shown to about 1 km only');
select ok((select pickup_address not like '%45 Kenmure%' from public.driver_open_job(current_setting('t.j')::uuid)), 'D4: and as an area');

-- ================================================================ E. end to end: offer, accept, deliver, complete
select tests.login_as(current_setting('t.d')::uuid);
select lives_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 180, %L)$$,
                       current_setting('t.j'), current_setting('t.d'), tests.truck_of(current_setting('t.d')::uuid)),
                'E1: a verified driver sends their own price');
select tests.as_owner();
select set_config('t.b', (select id::text from public.bids where job_id = current_setting('t.j')::uuid), true);
select tests.login_as(current_setting('t.cust')::uuid);
select is((select price from public.bids where id = current_setting('t.b')::uuid), 180.00::numeric, 'E2: the customer sees the offer');
select lives_ok($$select public.accept_bid(current_setting('t.b')::uuid)$$, 'E3: the customer accepts it');
select tests.as_owner();
select is((select row(status, final_price, driver_id = current_setting('t.d')::uuid)::text from public.jobs where id = current_setting('t.j')::uuid),
          '(accepted,180.00,t)', 'E4: the accepted price is the agreed price');
select is((select held_commission from public.jobs where id = current_setting('t.j')::uuid), 12.60::numeric,
          'E5: 7% of the agreed delivery price is reserved ($12.60)');
select tests.login_as(current_setting('t.d')::uuid);
select is((select pickup_address from public.jobs where id = current_setting('t.j')::uuid), '45 Kenmure Rd, Highlands, Harare',
          'E6: once selected, the driver sees the exact collection address');
select tests.as_owner();
insert into storage.objects (bucket_id, name) values ('job-proof-photos', current_setting('t.j') || '/pickup.jpg');
select tests.login_as(current_setting('t.d')::uuid);
select lives_ok($$select public.record_job_evidence(current_setting('t.j')::uuid, 'pickup', current_setting('t.j') || '/pickup.jpg', 1000, 'image/jpeg', -17.801, 31.055, 10, 'captured')$$,
                'E7: pickup photo at the collection point');
select is((public.start_trip(current_setting('t.j')::uuid)).status::text, 'in_progress', 'E8: the trip starts');
select tests.as_owner();
select tests.deliver(current_setting('t.j')::uuid);
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.j')::uuid)) ->> 'ok', 'true', 'E9: the customer confirms with the delivery code');
select tests.as_owner();
select is((select balance from public.wallets where user_id = current_setting('t.d')::uuid), 87.40::numeric, 'E10: $12.60 charged once ($100 - $12.60)');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.j')::uuid and type = 'commission'), 1,
          'E11: one commission line');

-- ================================================================ F. cancellation releases the reserve
select set_config('t.j2', pg_temp.req('{"budget":90}')::text, true);
select tests.login_as(current_setting('t.other')::uuid);
insert into public.bids (job_id, driver_id, price, truck_id)
  values (current_setting('t.j2')::uuid, current_setting('t.other')::uuid, 100, tests.truck_of(current_setting('t.other')::uuid));
select tests.as_owner();
select set_config('t.b2', (select id::text from public.bids where job_id = current_setting('t.j2')::uuid), true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b2')::uuid);
select lives_ok($$select public.cancel_job(current_setting('t.j2')::uuid, 'Load not ready')$$, 'F1: the customer cancels before loading');
select tests.as_owner();
select is((select row(balance, held)::text from public.wallets where user_id = current_setting('t.other')::uuid), '(100.00,0.00)',
          'F2: the reserve is released in full and nothing is charged');
select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'held_commission_matches_jobs') and not ok), 0,
          'F3: ledger and reserve checks pass');

select * from finish();
rollback;
