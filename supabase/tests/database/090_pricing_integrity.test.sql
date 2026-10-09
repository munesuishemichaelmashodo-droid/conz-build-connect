-- Phase 11 — pricing integrity: server-only quotes, server-derived pickup,
-- quote binding (customer / material / quantity / expiry / single use),
-- coordinate sanity, preferred-driver validation.

begin;
select plan(29);

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.other', tests.create_user('other')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 100)::text, true);
select set_config('t.nodrv', tests.create_user('notadriver')::text, true);
select set_config('t.other_supply', (select id::text from public.material_supply_locations where material::text <> 'river_sand' limit 1), true);

-- Quote fixtures need an explicit verified, in-stock supplier site.
select tests.as_owner();
do $$
declare _supplier uuid; _location uuid;
begin
  insert into public.suppliers (name, verification_status)
  values ('Pricing Integrity Test Supplier', 'verified') returning id into _supplier;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status,
     verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_supplier, 'river_sand', 'supplier', 'Test supplier site', 'Test address',
          -17.80, 31.05, 'active', 'verified', 100, 1, 100, 'exact')
  returning id into _location;
  perform set_config('t.supply', _location::text, true);
end $$;

-- Delivery is ~11 km north of the test supplier; quoted road distance 20 km.
create or replace function pg_temp.quote(_customer text, _qty numeric default 12, _km numeric default 20, _supply uuid default null)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  perform tests.as_service();
  _id := public.create_price_quote_for(nullif(_customer, '')::uuid, 'river_sand', _qty, _km, 'osrm',
    coalesce(_supply, nullif(current_setting('t.supply', true), '')::uuid));
  perform tests.as_owner();
  return _id;
end $$;

create or replace function pg_temp.book(_quote uuid, _budget numeric default 230, _lat double precision default -17.70,
                                        _lng double precision default 31.05, _qty numeric default 12,
                                        _pickup_lat double precision default -17.70, _pickup_lng double precision default 31.05,
                                        _preferred uuid default null)
returns text language sql as $$
  select format($f$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, quote_id,
                    delivery_lat, delivery_lng, pickup_lat, pickup_lng, preferred_driver_id)
                  values (auth.uid(), 'river_sand', %s, 'Site', %s, %L, %s, %s, %s, %s, %L)$f$,
                _qty, _budget, _quote, _lat, _lng, _pickup_lat, _pickup_lng, _preferred)
$$;

-- ---------------------------------------------------------------------------
-- Quotes are server-only
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.create_price_quote('river_sand', 12, 0, 'osrm', null)$$, '42501', null,
  'Clients cannot create their own quote (any distance)');
select throws_ok($$select public.create_price_quote_for(auth.uid(), 'river_sand', 12, 0, 'osrm', null)$$, '42501', null,
  'Clients cannot call the server quote function');
select tests.as_service();
select is((select count(*)::int from public.resolve_material_source_candidates('river_sand', 12, -17.70, 31.05)), 1,
  'Only an exact, verified source with tracked stock is eligible');
select is((select count(*)::int from public.resolve_material_source_candidates('river_sand', 101, -17.70, 31.05)), 0,
  'A source with less stock than the order is excluded');
select throws_ok($$select public.create_price_quote_for(null, 'river_sand', 12, 'NaN', 'osrm', null)$$, null, null, 'NaN distance rejected');
select throws_ok($$select public.create_price_quote_for(null, 'river_sand', 12, 20, 'client_provided', null)$$, null, null,
  'A client-provided distance can never become a quote');
select throws_ok(format($$select public.create_price_quote_for(null, 'river_sand', 12, 20, 'osrm', %L)$$, current_setting('t.other_supply')),
  null, null, 'Supply location must belong to the quoted material');
select ok(public.create_price_quote_for(null, 'river_sand', 12, 20, 'osrm', current_setting('t.supply')::uuid) is not null,
  'Quote can be created with its verified supplier location');
select throws_ok($$select public.create_price_quote_for(null, 'river_sand', 12, 20, 'osrm', null)$$, null, null,
  'A quote without a supplier location is rejected');
select throws_ok(format($$select public.create_price_quote_for(null, 'river_sand', 101, 20, 'osrm', %L)$$, current_setting('t.supply')),
  null, null, 'A quote exceeding the source stock is rejected');

-- ---------------------------------------------------------------------------
-- Booking a priced material requires a valid quote; pickup is server-set
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(null), '%quote%', 'A priced job without a quote is rejected');
select set_config('t.q1', pg_temp.quote(current_setting('t.cust'))::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(pg_temp.book(current_setting('t.q1')::uuid), 'Booking with a valid quote works');
select tests.as_owner();
select set_config('t.job1', (select id::text from public.jobs where quote_id = current_setting('t.q1')::uuid), true);
select is((select pickup_lat from public.jobs where id = current_setting('t.job1')::uuid), -17.80::double precision,
  'P: client pickup coordinate ignored — verified supplier coordinates used');
select is((select (pricing_breakdown->>'distance_km')::numeric from public.jobs where id = current_setting('t.job1')::uuid), 20.0,
  'P: priced on the server quote''s road distance');
select ok((select consumed_at is not null from public.price_quotes where id = current_setting('t.q1')::uuid), 'Quote consumed');

select set_config('t.qstock', pg_temp.quote(current_setting('t.cust'))::text, true);
select tests.as_owner();
update public.material_supply_locations set available_quantity_m3 = 0 where id = current_setting('t.supply')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(current_setting('t.qstock')::uuid), '%supplier%',
  'A quote is rejected if its source stock is no longer sufficient');
select tests.as_owner();
update public.material_supply_locations set available_quantity_m3 = 100 where id = current_setting('t.supply')::uuid;

select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(current_setting('t.q1')::uuid), '%quote%', 'A quote cannot be used twice');
select set_config('t.q2', pg_temp.quote(current_setting('t.other'))::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(current_setting('t.q2')::uuid), '%quote%', 'Another customer''s quote cannot be used');
select set_config('t.q3', pg_temp.quote(current_setting('t.cust'), 12)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(current_setting('t.q3')::uuid, 120, -17.70, 31.05, 6), '%quote%',
  'A quote for 12 m³ cannot price a 6 m³ job');
select tests.as_owner();
update public.price_quotes set expires_at = now() - interval '1 minute' where id = current_setting('t.q3')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(current_setting('t.q3')::uuid), '%quote%', 'An expired quote is rejected');

select set_config('t.q4', pg_temp.quote(current_setting('t.cust'))::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(pg_temp.book(current_setting('t.q4')::uuid, 230, -20.15, 28.58), '%supplier no longer serves this delivery location%',
  'A 20 km quote cannot price a delivery ~400 km away');
select throws_like(pg_temp.book(current_setting('t.q4')::uuid, 50), '%outside the allowed range%',
  'Budget below the server range is still rejected');
select throws_like(pg_temp.book(current_setting('t.q4')::uuid, 230, 51.5, -0.12), '%Zimbabwe%',
  'Delivery outside Zimbabwe is rejected');
select throws_ok(pg_temp.book(current_setting('t.q4')::uuid, 230, 'NaN', 31.05), null, null, 'NaN coordinates are rejected');

-- ---------------------------------------------------------------------------
-- Preferred driver must be a verified driver
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.book(current_setting('t.q4')::uuid, 230, -17.70, 31.05, 12, -17.70, 31.05, current_setting('t.nodrv')::uuid),
  'Booking with a bogus preferred driver still succeeds');
select tests.as_owner();
select is((select preferred_driver_id from public.jobs where quote_id = current_setting('t.q4')::uuid), null,
  'P: a non-driver preferred_driver_id is dropped');
select set_config('t.q5', pg_temp.quote(current_setting('t.cust'))::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(pg_temp.book(current_setting('t.q5')::uuid, 230, -17.70, 31.05, 12, -17.70, 31.05, current_setting('t.drv')::uuid),
  'Booking with a verified preferred driver');
select tests.as_owner();
select is((select preferred_driver_id from public.jobs where quote_id = current_setting('t.q5')::uuid), current_setting('t.drv')::uuid,
  'A verified preferred driver is kept');

-- Unpriced (custom) material: no quote needed, client pricing fields cleared
select tests.login_as(current_setting('t.cust')::uuid);
insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, delivery_lat, delivery_lng, pricing_breakdown)
values (auth.uid(), 'custom', 5, 'Site', 150, -17.70, 31.05, '{"high": 99999}');
select tests.as_owner();
select is((select pricing_breakdown from public.jobs where material = 'custom' and customer_id = current_setting('t.cust')::uuid), null,
  'Client-supplied pricing_breakdown (used as the raise-budget cap) is discarded');

select * from finish();
rollback;
