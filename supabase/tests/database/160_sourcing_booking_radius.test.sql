-- 0090 — a customer can book an admin-issued sourcing quote whose supplier is
-- outside every automatic service radius, but ONLY through that request.
-- Bulawayo site (service radius 50 km) -> Marondera delivery (~380 km by air).
-- The booking runs as the CUSTOMER (authenticated): the radius gate in
-- tg_validate_job_budget only applies to client inserts.

begin;
select plan(8);
select tests.enable_launch_features();

select set_config('t.c1',    tests.create_user('rad_c1')::text, true);
select set_config('t.c2',    tests.create_user('rad_c2')::text, true);
select set_config('t.admin', tests.create_user('rad_admin', array['admin'])::text, true);

select tests.as_owner();
do $$
declare _sup uuid; _loc uuid;
begin
  insert into public.suppliers (name, verification_status) values ('Radius Test Supplier', 'verified') returning id into _sup;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status,
     available_quantity_m3, priority, service_radius_km, location_precision)
  values (_sup, 'river_sand', 'supplier', 'Bulawayo site', 'Bulawayo', -20.15, 28.58, 'active', 'verified', 500, 1, 50, 'exact')
  returning id into _loc;
  perform set_config('t.loc', _loc::text, true);
end $$;

create function pg_temp.book(_who text, _quote uuid, _lat double precision default -18.18, _lng double precision default 31.55)
returns void language plpgsql as $$
begin
  perform tests.login_as(current_setting(_who)::uuid);
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, quote_id, delivery_lat, delivery_lng)
  values (auth.uid(), 'river_sand', 12, 'Marondera CBD',
          (public.compute_material_offer('river_sand', 12, 400)->>'offer')::numeric, _quote, _lat, _lng);
end $$;

-- Control: an ORDINARY quote for the out-of-radius site is still refused.
select tests.as_service();
select set_config('t.q_plain', public.create_price_quote_for(current_setting('t.c1')::uuid, 'river_sand', 12, 400, 'osrm', current_setting('t.loc')::uuid)::text, true);
select tests.as_owner();
select throws_ok(format($$select pg_temp.book('t.c1', %L)$$, current_setting('t.q_plain')),
  '22023', null, 'A normal (non-sourcing) quote outside the supplier radius is still rejected');

-- Sourcing request -> admin quote
select tests.login_as(current_setting('t.c1')::uuid);
select set_config('t.r1', public.create_material_sourcing_request('river_sand', null, 12, 'Marondera CBD', -18.18, 31.55, null, null, 'radius-key-0001')::text, true);
select tests.as_service();
select set_config('t.q1', public.issue_sourcing_quote(current_setting('t.r1')::uuid, current_setting('t.admin')::uuid, current_setting('t.loc')::uuid, 400, 'osrm', 48, 'Pay on booking')::text, true);
select tests.as_owner();

-- Another customer cannot use it; a moved pin is refused; booking by the owner works.
select throws_ok(format($$select pg_temp.book('t.c2', %L)$$, current_setting('t.q1')),
  null, null, 'Another customer cannot book the sourcing quote');
select throws_ok(format($$select pg_temp.book('t.c1', %L, -18.25, 31.55)$$, current_setting('t.q1')),
  '22023', null, 'Moving the delivery pin ~8 km away from the sourced one is rejected');
select lives_ok(format($$select pg_temp.book('t.c1', %L)$$, current_setting('t.q1')),
  'The customer books their sourcing quote although the supplier radius does not cover the delivery');
select tests.as_owner();
select is((select status from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 'converted', 'The request converts on that booking');
select is((select count(*)::int from public.jobs where quote_id = current_setting('t.q1')::uuid), 1, 'Exactly one job exists for the quote');
select isnt((select consumed_at from public.price_quotes where id = current_setting('t.q1')::uuid), null, 'The quote is consumed (single use)');
select throws_ok(format($$select pg_temp.book('t.c1', %L)$$, current_setting('t.q1')),
  null, null, 'The consumed sourcing quote cannot be booked twice');

select * from finish();
rollback;
