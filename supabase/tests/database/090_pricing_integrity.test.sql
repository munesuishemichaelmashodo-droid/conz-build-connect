-- Phase 11 — pricing integrity: server-only quotes, server-derived pickup,
-- quote binding (customer / material / quantity / expiry / single use),
-- coordinate sanity, preferred-driver validation.

begin;
select plan(24);

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.other', tests.create_user('other')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 100)::text, true);
select set_config('t.nodrv', tests.create_user('notadriver')::text, true);
select set_config('t.other_supply', (select id::text from public.material_supply_locations where material::text <> 'river_sand' limit 1), true);

-- Delivery ~14 km north of the Harare default pickup; quoted road distance 20 km.
create or replace function pg_temp.quote(_customer text, _qty numeric default 12, _km numeric default 20, _supply uuid default null)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  perform tests.as_service();
  _id := public.create_price_quote_for(nullif(_customer, '')::uuid, 'river_sand', _qty, _km, 'osrm', _supply);
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
select throws_ok($$select public.create_price_quote_for(null, 'river_sand', 12, 'NaN', 'osrm', null)$$, null, null, 'NaN distance rejected');
select throws_ok($$select public.create_price_quote_for(null, 'river_sand', 12, 20, 'client_provided', null)$$, null, null,
  'A client-provided distance can never become a quote');
select throws_ok(format($$select public.create_price_quote_for(null, 'river_sand', 12, 20, 'osrm', %L)$$, current_setting('t.other_supply')),
  null, null, 'Supply location must belong to the quoted material');
select ok(public.create_price_quote_for(null, 'river_sand', 12, 20, 'osrm', null) is not null,
  'The 4-argument quote call is no longer ambiguous (was failing live)');

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
select is((select pickup_lat from public.jobs where id = current_setting('t.job1')::uuid), -17.8292::double precision,
  'P: client pickup coordinate ignored — server pickup used');
select is((select (pricing_breakdown->>'distance_km')::numeric from public.jobs where id = current_setting('t.job1')::uuid), 20.0,
  'P: priced on the server quote''s road distance');
select ok((select consumed_at is not null from public.price_quotes where id = current_setting('t.q1')::uuid), 'Quote consumed');

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
select throws_like(pg_temp.book(current_setting('t.q4')::uuid, 230, -20.15, 28.58), '%changed after your quote%',
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
