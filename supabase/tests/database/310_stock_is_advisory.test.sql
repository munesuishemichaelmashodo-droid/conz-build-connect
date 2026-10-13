-- 0101 — supplier stock is ADVISORY, never a gate (owner direction 2026-10-12).
-- Unknown (NULL) or lower-than-requested tracked stock must not block quoting, booking or driver acceptance.
-- Unchanged safeguards: verified supplier + active verified exact-coordinate location + material match + radius.
-- Unknown stock is never reported as confirmed (supply_stock_status).

begin;
select plan(24);

select set_config('t.cust', tests.create_user('st_cust')::text, true);
select set_config('t.drv',  tests.create_driver('st_drv', 100, true)::text, true);

select tests.as_owner();
do $$
declare _s uuid; _su uuid; _l100 uuid; _lnull uuid; _lpaused uuid; _lun uuid; _lunv uuid;
begin
  insert into public.suppliers (name, verification_status) values ('Stock Test Supplier', 'verified') returning id into _s;
  insert into public.suppliers (name, verification_status) values ('Stock Unverified Supplier', 'unverified') returning id into _su;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Tracked 100', 'a', -17.80, 31.05, 'active', 'verified', 100, 1, 200, 'exact') returning id into _l100;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Unknown stock', 'b', -17.81, 31.06, 'active', 'verified', null, 2, 200, 'exact') returning id into _lnull;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Paused', 'c', -17.82, 31.07, 'paused', 'verified', null, 3, 200, 'exact') returning id into _lpaused;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_su, 'stones', 'supplier', 'Unverified supplier', 'd', -17.83, 31.08, 'active', 'verified', null, 4, 200, 'exact') returning id into _lun;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Unverified location', 'e', -17.84, 31.09, 'active', 'unverified', null, 5, 200, 'exact') returning id into _lunv;
  perform set_config('t.l100', _l100::text, true);
  perform set_config('t.lnull', _lnull::text, true);
  perform set_config('t.lpaused', _lpaused::text, true);
  perform set_config('t.lun', _lun::text, true);
  perform set_config('t.lunv', _lunv::text, true);
end $$;

-- ---- candidate resolution (customer quote screen)
select is(
  (select count(*)::int from public.resolve_material_source_candidates('stones', 150, -17.82, 31.04)
    where supply_location_id = current_setting('t.lnull')::uuid),
  1, '1: a location with UNKNOWN stock is offered as a candidate');
select is(
  (select count(*)::int from public.resolve_material_source_candidates('stones', 150, -17.82, 31.04)
    where supply_location_id = current_setting('t.l100')::uuid),
  1, '2: a location whose tracked stock (100) is below the request (150) is still offered');
select is(
  (select count(*)::int from public.resolve_material_source_candidates('stones', 12, -17.82, 31.04)
    where supply_location_id in (current_setting('t.lpaused')::uuid, current_setting('t.lun')::uuid, current_setting('t.lunv')::uuid)),
  0, '3: paused / unverified-supplier / unverified locations are still never offered');

-- ---- stock status labelling: unknown is never "confirmed"
select is(public.supply_stock_status(current_setting('t.lnull')::uuid, 12), 'unknown', '4: NULL stock -> unknown');
select is(public.supply_stock_status(current_setting('t.l100')::uuid, 12), 'confirmed', '5: tracked >= request -> confirmed');
select is(public.supply_stock_status(current_setting('t.l100')::uuid, 150), 'below_requested', '6: tracked < request -> below_requested');
select is(public.supply_stock_status(gen_random_uuid(), 12), 'unknown', '7: a missing location is unknown, never confirmed');
select ok(not has_function_privilege('anon', 'public.supply_stock_status(uuid,numeric)', 'execute'), '8: anon cannot call supply_stock_status');

-- ---- quote issuing (service role, as the app does)
select tests.as_service();
select set_config('t.q_null', public.create_price_quote_for(current_setting('t.cust')::uuid, 'stones', 12, 20, 'osrm', current_setting('t.lnull')::uuid)::text, true);
select set_config('t.q_low',  public.create_price_quote_for(current_setting('t.cust')::uuid, 'stones', 150, 20, 'osrm', current_setting('t.l100')::uuid)::text, true);
select tests.as_owner();
select ok(current_setting('t.q_null') <> '', '9: a quote can be issued for an UNKNOWN-stock location');
select ok(current_setting('t.q_low')  <> '', '10: a quote can be issued when tracked stock is below the request');

select tests.as_service();
select throws_ok(format('select public.create_price_quote_for(%L,''stones'',12,20,''osrm'',%L)', current_setting('t.cust'), current_setting('t.lpaused')), 'P0001', 'invalid_supply_location', '11: paused location still rejected');
select throws_ok(format('select public.create_price_quote_for(%L,''stones'',12,20,''osrm'',%L)', current_setting('t.cust'), current_setting('t.lun')), 'P0001', 'invalid_supply_location', '12: unverified supplier still rejected');
select throws_ok(format('select public.create_price_quote_for(%L,''stones'',12,20,''osrm'',%L)', current_setting('t.cust'), current_setting('t.lunv')), 'P0001', 'invalid_supply_location', '13: unverified location still rejected');
select throws_ok(format('select public.create_price_quote_for(%L,''crusher_run'',12,20,''osrm'',%L)', current_setting('t.cust'), current_setting('t.lnull')), 'P0001', 'invalid_supply_location', '14: material mismatch still rejected');
select tests.as_owner();

-- ---- booking-time supply check (used by the job trigger)
select is(
  (select count(*)::int from public.verified_quote_supply_for_job(current_setting('t.q_null')::uuid, current_setting('t.cust')::uuid, 'stones', 12)),
  1, '15: the booking check accepts the unknown-stock quote');
select is(
  (select count(*)::int from public.verified_quote_supply_for_job(current_setting('t.q_low')::uuid, current_setting('t.cust')::uuid, 'stones', 150)),
  1, '16: the booking check accepts the below-tracked-stock quote');

-- ---- driver acceptance and cancellation never gate on, or rewrite, stock
select set_config('t.jobLow', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set supply_location_id = current_setting('t.l100')::uuid, quantity_m3 = 150 where id = current_setting('t.jobLow')::uuid;
select set_config('t.bidLow', tests.create_bid(current_setting('t.jobLow')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format('select public.accept_bid(%L)', current_setting('t.bidLow')), '17: accepting a bid is not blocked when tracked stock (100) < job quantity (150)');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.jobLow')::uuid), 'accepted', '18: the job is accepted');
select is((select available_quantity_m3 from public.material_supply_locations where id = current_setting('t.l100')::uuid), 100::numeric, '19: accepting does not rewrite the supplier stock figure');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format('select public.cancel_job(%L, ''changed my mind'')', current_setting('t.jobLow')), '20: cancelling works');
select tests.as_owner();
select is((select available_quantity_m3 from public.material_supply_locations where id = current_setting('t.l100')::uuid), 100::numeric, '21: cancelling does not inflate the stock figure');

select set_config('t.jobNull', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set supply_location_id = current_setting('t.lnull')::uuid where id = current_setting('t.jobNull')::uuid;
select set_config('t.bidNull', tests.create_bid(current_setting('t.jobNull')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format('select public.accept_bid(%L)', current_setting('t.bidNull')), '22: accepting works for an unknown-stock location');
select tests.as_owner();
select is((select available_quantity_m3 from public.material_supply_locations where id = current_setting('t.lnull')::uuid), null::numeric, '23: unknown stock stays unknown (never turned into a number)');
select is((select held_commission from public.jobs where id = current_setting('t.jobNull')::uuid), 28.00::numeric, '24: the 7% commission hold is unchanged by the stock change');

select * from finish();
rollback;
